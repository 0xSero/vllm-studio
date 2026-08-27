const std = @import("std");
const account_repository = @import("../../accounts/store.zig");
const cloud_store = @import("store.zig");
const cloud_types = @import("types.zig");
const node_credentials = @import("../../topology/credential_store.zig");
const enrollments = @import("../../topology/enrollments.zig");
const model_relay = @import("../harness/model_relay.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 16 * 1024 * 1024;
const controller_port = 8080;
const worker_lease_seconds = 3600;

const Lifecycle = enum { pause, stop, start, delete };

const Credential = struct {
    allocator: std.mem.Allocator,
    endpoint: []u8,
    api_key: []u8,

    fn deinit(credential: *Credential) void {
        credential.allocator.free(credential.endpoint);
        credential.allocator.free(credential.api_key);
        credential.* = undefined;
    }
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []u8,
    environment: *const std.process.Environ.Map,
    head_origin: []u8,
    head_api_key: ?[]u8,
    links: Io.Group = .init,

    pub fn init(allocator: std.mem.Allocator, io: Io, data_dir: []const u8, environment: *const std.process.Environ.Map, head_port: u16, head_api_key: ?[]const u8) !Manager {
        const owned_data_dir = try allocator.dupe(u8, data_dir);
        errdefer allocator.free(owned_data_dir);
        const head_origin = try std.fmt.allocPrint(allocator, "http://127.0.0.1:{d}", .{head_port});
        errdefer allocator.free(head_origin);
        const owned_head_api_key = if (head_api_key) |value| try allocator.dupe(u8, value) else null;
        errdefer if (owned_head_api_key) |value| allocator.free(value);
        return .{
            .allocator = allocator,
            .io = io,
            .data_dir = owned_data_dir,
            .environment = environment,
            .head_origin = head_origin,
            .head_api_key = owned_head_api_key,
        };
    }

    pub fn deinit(manager: *Manager) void {
        manager.links.cancel(manager.io);
        manager.allocator.free(manager.data_dir);
        manager.allocator.free(manager.head_origin);
        if (manager.head_api_key) |value| manager.allocator.free(value);
        manager.* = undefined;
    }

    pub fn provision(manager: *Manager, client: *http.Client, database: *sqlite.Database, worker_id: []const u8, session_id: []const u8, account_id: []const u8, requested_harness: []const u8, snapshot: []const u8, vcpus: u8, memory_gib: u16, storage_gib: u16, checkout: []const u8) !cloud_types.Provisioned {
        _ = vcpus;
        _ = memory_gib;
        _ = storage_gib;
        var account_credential = try manager.loadCredential(account_id);
        defer account_credential.deinit();
        var controller_key_bytes: [32]u8 = undefined;
        manager.io.random(&controller_key_bytes);
        const controller_key = std.fmt.bytesToHex(controller_key_bytes, .lower);
        const create_document = try manager.createDocument(worker_id, session_id, snapshot, controller_key[0..]);
        defer manager.allocator.free(create_document);
        const created = manager.request(client, account_credential.endpoint, account_credential.api_key, "/sandbox", .POST, create_document) catch return error.DaytonaSandboxCreateRejected;
        defer manager.allocator.free(created);
        const provider_id = try requiredResponseString(manager.allocator, created, "id");
        errdefer manager.allocator.free(provider_id);
        errdefer manager.lifecycle(client, &account_credential, provider_id, .delete) catch {};
        try lockedProvider(manager.io, database, worker_id, provider_id);
        try manager.waitForStarted(client, &account_credential, provider_id);
        try manager.waitForToolbox(client, &account_credential, provider_id);
        const preview_path = try std.fmt.allocPrint(manager.allocator, "/sandbox/{s}/ports/{d}/preview-url", .{ provider_id, controller_port });
        defer manager.allocator.free(preview_path);
        const preview = try manager.waitForPreview(client, &account_credential, preview_path);
        defer manager.allocator.free(preview);
        const address = try requiredResponseString(manager.allocator, preview, "url");
        errdefer manager.allocator.free(address);
        const catalog = try manager.waitForCatalog(client, address, controller_key[0..]);
        defer manager.allocator.free(catalog);
        if (!catalogHasHarness(manager.allocator, catalog, requested_harness)) return error.CloudHarnessUnavailable;
        try model_relay.startClient(&manager.links, manager.allocator, manager.io, address, controller_key[0..], manager.head_origin, manager.head_api_key);
        const workspace = try manager.cloneWorkspace(client, &account_credential, provider_id, session_id, checkout);
        errdefer manager.allocator.free(workspace);
        const node_id = try std.fmt.allocPrint(manager.allocator, "daytona-{s}", .{worker_id[0..@min(worker_id.len, 20)]});
        errdefer manager.allocator.free(node_id);
        const enrollment = try enrollmentDocument(manager.allocator, node_id, address, controller_key[0..], catalog);
        defer manager.allocator.free(enrollment);
        const enrolled = try enrollments.upsertPayload(manager.allocator, manager.io, database, enrollment);
        manager.allocator.free(enrolled);
        try lockedAttach(manager.io, database, worker_id, provider_id, node_id, address);
        return .{
            .allocator = manager.allocator,
            .provider_id = provider_id,
            .node_id = node_id,
            .address = address,
            .workspace = workspace,
        };
    }

    pub fn listPayload(manager: *Manager, database: *sqlite.Database) ![]u8 {
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        return cloud_store.listPayload(manager.allocator, database);
    }

    pub fn defaultSnapshot(manager: *Manager, profile_id: []const u8) ![]u8 {
        _ = profile_id;
        if (manager.environment.get("LOCAL_STUDIO_DAYTONA_SNAPSHOT")) |configured| {
            const snapshot = std.mem.trim(u8, configured, " \t\r\n");
            if (!validSnapshot(snapshot)) return error.DaytonaSnapshotRequired;
            return manager.allocator.dupe(u8, snapshot);
        }
        const configured_version = manager.environment.get("LOCAL_STUDIO_VERSION") orelse return error.DaytonaSnapshotRequired;
        const version = std.mem.trim(u8, configured_version, " \t\r\n");
        if (!validVersion(version)) return error.DaytonaSnapshotRequired;
        const marker = if (std.mem.indexOfScalar(u8, version, '-') == null) "v" else "";
        return std.fmt.allocPrint(manager.allocator, "local-studio-worker-{s}{s}", .{ marker, version });
    }

    pub fn runReconciler(manager: *Manager, client: *http.Client, database: *sqlite.Database) Io.Cancelable!void {
        while (true) {
            manager.reconcile(client, database) catch |failure| std.log.warn("Daytona reconciliation failed: {t}", .{failure});
            try manager.io.sleep(.fromSeconds(30), .awake);
        }
    }

    pub fn reconcile(manager: *Manager, client: *http.Client, database: *sqlite.Database) !void {
        var candidates = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk try cloud_store.reconciliationCandidates(manager.allocator, database);
        };
        defer candidates.deinit();
        for (candidates.items.items) |*worker| {
            if (!try manager.ownsAccount(worker.account_id)) continue;
            const provider_id = worker.provider_id orelse {
                try lockedWorkerStatus(manager.io, database, worker.id, "deleted", "Sandbox was never created");
                continue;
            };
            var account_credential = manager.loadCredential(worker.account_id) catch |failure| {
                try lockedWorkerStatus(manager.io, database, worker.id, "failed", @errorName(failure));
                continue;
            };
            defer account_credential.deinit();
            if (std.mem.eql(u8, worker.status, "ready")) {
                try lockedWorkerStatus(manager.io, database, worker.id, "pausing", null);
                const paused = manager.pauseSandbox(client, &account_credential, provider_id) catch |failure| {
                    if (failure == error.DaytonaResourceNotFound) {
                        try manager.removeWorkerEnrollment(database, worker);
                        try lockedWorkerStatus(manager.io, database, worker.id, "deleted", null);
                        continue;
                    }
                    try lockedWorkerStatus(manager.io, database, worker.id, "failed", @errorName(failure));
                    continue;
                };
                try lockedWorkerStatus(manager.io, database, worker.id, if (paused) "paused" else "stopped", null);
                continue;
            }
            manager.lifecycle(client, &account_credential, provider_id, .delete) catch |failure| {
                if (failure != error.DaytonaResourceNotFound) {
                    try lockedWorkerStatus(manager.io, database, worker.id, "failed", @errorName(failure));
                    continue;
                }
            };
            try manager.removeWorkerEnrollment(database, worker);
            try lockedWorkerStatus(manager.io, database, worker.id, "deleted", null);
        }
    }

    pub fn @"resume"(manager: *Manager, client: *http.Client, database: *sqlite.Database, worker: *const cloud_store.Worker) !void {
        const provider_id = worker.provider_id orelse return error.DaytonaSandboxNotCreated;
        const node_id = worker.node_id orelse return error.DaytonaWorkerNotEnrolled;
        const address = worker.address orelse return error.DaytonaWorkerNotEnrolled;
        var account_credential = try manager.loadCredential(worker.account_id);
        defer account_credential.deinit();
        try lockedWorkerStatus(manager.io, database, worker.id, "resuming", null);
        manager.lifecycle(client, &account_credential, provider_id, .start) catch |failure| {
            if (failure == error.DaytonaResourceNotFound) {
                try manager.removeWorkerEnrollment(database, worker);
                try lockedWorkerStatus(manager.io, database, worker.id, "deleted", null);
            } else try lockedWorkerStatus(manager.io, database, worker.id, "failed", @errorName(failure));
            return failure;
        };
        try manager.waitForStarted(client, &account_credential, provider_id);
        try manager.waitForToolbox(client, &account_credential, provider_id);
        const controller_key = try lockedNodeCredential(manager.allocator, manager.io, database, node_id);
        defer manager.allocator.free(controller_key);
        const catalog = try manager.waitForCatalog(client, address, controller_key);
        manager.allocator.free(catalog);
        try model_relay.startClient(&manager.links, manager.allocator, manager.io, address, controller_key, manager.head_origin, manager.head_api_key);
        try lockedWorkerReady(manager.io, database, worker.id, worker_lease_seconds);
    }

    fn removeWorkerEnrollment(manager: *Manager, database: *sqlite.Database, worker: *const cloud_store.Worker) !void {
        if (worker.node_id) |node_id| {
            const removed = enrollments.deletePayload(manager.allocator, manager.io, database, node_id) catch null;
            if (removed) |payload| manager.allocator.free(payload);
        }
    }

    pub fn ownsAccount(manager: *Manager, account_id: []const u8) !bool {
        var accounts = try account_repository.load(manager.allocator, manager.io, manager.data_dir);
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse return false;
        return std.mem.eql(u8, account.provider, "daytona");
    }

    fn loadCredential(manager: *Manager, account_id: []const u8) !Credential {
        var accounts = try account_repository.load(manager.allocator, manager.io, manager.data_dir);
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse return error.SandboxAccountNotFound;
        if (!std.mem.eql(u8, account.provider, "daytona")) return error.DaytonaAccountRequired;
        const stored = try account_repository.resolveSecret(manager.allocator, manager.io, manager.environment, manager.data_dir, &accounts, account.secret_ref, account.secret_provider);
        defer manager.allocator.free(stored);
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, stored, .{}) catch return error.InvalidDaytonaCredential;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidDaytonaCredential;
        const api_key = stringField(parsed.value.object, "apiKey") orelse return error.InvalidDaytonaCredential;
        return .{
            .allocator = manager.allocator,
            .endpoint = try normalizeEndpoint(manager.allocator, account.subject),
            .api_key = try manager.allocator.dupe(u8, api_key),
        };
    }

    fn createDocument(manager: *Manager, worker_id: []const u8, session_id: []const u8, snapshot: []const u8, controller_key: []const u8) ![]u8 {
        if (!validSnapshot(snapshot)) return error.DaytonaSnapshotRequired;
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"snapshot\":");
        try std.json.Stringify.value(snapshot, .{}, &output.writer);
        try output.writer.writeAll(",\"public\":true,\"autoStopInterval\":0,\"ttlMinutes\":0,\"name\":");
        const name = try std.fmt.allocPrint(manager.allocator, "local-studio-{s}", .{worker_id[0..@min(worker_id.len, 20)]});
        defer manager.allocator.free(name);
        try std.json.Stringify.value(name, .{}, &output.writer);
        try output.writer.writeAll(",\"labels\":{\"local-studio\":\"worker\",\"local-studio-session\":");
        try std.json.Stringify.value(session_id, .{}, &output.writer);
        try output.writer.writeAll("},\"env\":{\"LOCAL_STUDIO_CONTROLLER_MODE\":\"worker\",\"LOCAL_STUDIO_HOST\":\"0.0.0.0\",\"LOCAL_STUDIO_PORT\":\"8080\",\"LOCAL_STUDIO_API_KEY\":");
        try std.json.Stringify.value(controller_key, .{}, &output.writer);
        try output.writer.writeAll(",\"LOCAL_STUDIO_HEAD_API_KEY\":");
        try std.json.Stringify.value(controller_key, .{}, &output.writer);
        try output.writer.writeAll(",\"LOCAL_STUDIO_DATA_DIR\":\"/home/node/.local-studio\",\"LOCAL_STUDIO_MODELS_DIR\":\"/home/node/models\",\"LOCAL_STUDIO_CLOUD_SESSION_ID\":");
        try std.json.Stringify.value(session_id, .{}, &output.writer);
        if (manager.environment.get("LOCAL_STUDIO_DAYTONA_SECRETSPEC_PROVIDER")) |provider| {
            try output.writer.writeAll(",\"LOCAL_STUDIO_SECRETSPEC_PROVIDER\":");
            try std.json.Stringify.value(provider, .{}, &output.writer);
        }
        try output.writer.writeByte('}');
        if (manager.environment.get("LOCAL_STUDIO_DAYTONA_SECRETSPEC_SECRETS")) |document| try writeSecretReferences(manager.allocator, &output.writer, document);
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    fn request(manager: *Manager, client: *http.Client, endpoint: []const u8, api_key: []const u8, path: []const u8, method: http.Method, payload: ?[]const u8) ![]u8 {
        const url = try std.fmt.allocPrint(manager.allocator, "{s}{s}", .{ endpoint, path });
        defer manager.allocator.free(url);
        const authorization = try std.fmt.allocPrint(manager.allocator, "Bearer {s}", .{api_key});
        defer manager.allocator.free(authorization);
        return fetch(manager.allocator, client, url, method, payload, &.{
            .{ .name = "Authorization", .value = authorization },
            .{ .name = "Content-Type", .value = "application/json" },
        });
    }

    fn waitForStarted(manager: *Manager, client: *http.Client, account_credential: *const Credential, provider_id: []const u8) !void {
        const sandbox_path = try std.fmt.allocPrint(manager.allocator, "/sandbox/{s}", .{provider_id});
        defer manager.allocator.free(sandbox_path);
        const deadline = Io.Clock.awake.now(manager.io).addDuration(.fromSeconds(10 * 60));
        while (Io.Clock.awake.now(manager.io).durationTo(deadline).toNanoseconds() > 0) {
            const document = manager.request(client, account_credential.endpoint, account_credential.api_key, sandbox_path, .GET, null) catch {
                try manager.io.sleep(.fromSeconds(2), .awake);
                continue;
            };
            defer manager.allocator.free(document);
            var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidDaytonaResponse;
            defer parsed.deinit();
            if (parsed.value != .object) return error.InvalidDaytonaResponse;
            const state = stringField(parsed.value.object, "state") orelse return error.InvalidDaytonaResponse;
            if (std.mem.eql(u8, state, "started")) return;
            if (std.mem.eql(u8, state, "error") or std.mem.eql(u8, state, "build_failed") or std.mem.eql(u8, state, "destroyed")) return error.DaytonaWorkerBuildFailed;
            try manager.io.sleep(.fromSeconds(2), .awake);
        }
        return error.DaytonaWorkerBuildTimedOut;
    }

    fn waitForPreview(manager: *Manager, client: *http.Client, account_credential: *const Credential, preview_path: []const u8) ![]u8 {
        const deadline = Io.Clock.awake.now(manager.io).addDuration(.fromSeconds(90));
        while (Io.Clock.awake.now(manager.io).durationTo(deadline).toNanoseconds() > 0) {
            if (manager.request(client, account_credential.endpoint, account_credential.api_key, preview_path, .GET, null)) |document| return document else |_| {}
            try manager.io.sleep(.fromSeconds(2), .awake);
        }
        return error.DaytonaPreviewNotReady;
    }

    fn waitForToolbox(manager: *Manager, client: *http.Client, account_credential: *const Credential, provider_id: []const u8) !void {
        const deadline = Io.Clock.awake.now(manager.io).addDuration(.fromSeconds(90));
        while (Io.Clock.awake.now(manager.io).durationTo(deadline).toNanoseconds() > 0) {
            if (manager.toolboxRequest(client, account_credential, provider_id, "/process/session/entrypoint", .GET, null)) |document| {
                manager.allocator.free(document);
                return;
            } else |_| {}
            try manager.io.sleep(.fromSeconds(2), .awake);
        }
        return error.DaytonaToolboxNotReady;
    }

    fn toolboxRequest(manager: *Manager, client: *http.Client, account_credential: *const Credential, provider_id: []const u8, path: []const u8, method: http.Method, payload: ?[]const u8) ![]u8 {
        const url = try std.fmt.allocPrint(manager.allocator, "https://proxy.app.daytona.io/toolbox/{s}{s}", .{ provider_id, path });
        defer manager.allocator.free(url);
        const authorization = try std.fmt.allocPrint(manager.allocator, "Bearer {s}", .{account_credential.api_key});
        defer manager.allocator.free(authorization);
        return fetch(manager.allocator, client, url, method, payload, &.{
            .{ .name = "Authorization", .value = authorization },
            .{ .name = "Content-Type", .value = "application/json" },
        });
    }

    fn waitForCatalog(manager: *Manager, client: *http.Client, address: []const u8, controller_key: []const u8) ![]u8 {
        const url = try std.fmt.allocPrint(manager.allocator, "{s}/internal/harness/v1/catalog", .{std.mem.trimEnd(u8, address, "/")});
        defer manager.allocator.free(url);
        const authorization = try std.fmt.allocPrint(manager.allocator, "Bearer {s}", .{controller_key});
        defer manager.allocator.free(authorization);
        const deadline = Io.Clock.awake.now(manager.io).addDuration(.fromSeconds(90));
        while (Io.Clock.awake.now(manager.io).durationTo(deadline).toNanoseconds() > 0) {
            if (fetch(manager.allocator, client, url, .GET, null, &.{.{ .name = "Authorization", .value = authorization }})) |catalog| return catalog else |_| {}
            try manager.io.sleep(.fromSeconds(2), .awake);
        }
        return error.DaytonaWorkerNotReady;
    }

    fn lifecycle(manager: *Manager, client: *http.Client, account_credential: *const Credential, provider_id: []const u8, operation: Lifecycle) !void {
        const path = switch (operation) {
            .pause => try std.fmt.allocPrint(manager.allocator, "/sandbox/{s}/pause", .{provider_id}),
            .stop => try std.fmt.allocPrint(manager.allocator, "/sandbox/{s}/stop", .{provider_id}),
            .start => try std.fmt.allocPrint(manager.allocator, "/sandbox/{s}/start", .{provider_id}),
            .delete => try std.fmt.allocPrint(manager.allocator, "/sandbox/{s}", .{provider_id}),
        };
        defer manager.allocator.free(path);
        const method: http.Method = if (operation == .delete) .DELETE else .POST;
        const response = try manager.request(client, account_credential.endpoint, account_credential.api_key, path, method, if (method == .POST) "{}" else null);
        manager.allocator.free(response);
    }

    fn pauseSandbox(manager: *Manager, client: *http.Client, account_credential: *const Credential, provider_id: []const u8) !bool {
        manager.lifecycle(client, account_credential, provider_id, .pause) catch |failure| {
            if (failure != error.DaytonaRequestRejected) return failure;
            try manager.lifecycle(client, account_credential, provider_id, .stop);
            return false;
        };
        return true;
    }

    fn cloneWorkspace(manager: *Manager, client: *http.Client, account_credential: *const Credential, provider_id: []const u8, session_id: []const u8, checkout: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, checkout, .{}) catch return error.InvalidCloudCheckout;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidCloudCheckout;
        const repository_url = stringField(parsed.value.object, "url") orelse return error.InvalidCloudCheckout;
        const username = stringField(parsed.value.object, "username") orelse return error.InvalidCloudCheckout;
        const password = stringField(parsed.value.object, "password") orelse return error.InvalidCloudCheckout;
        const reference = stringField(parsed.value.object, "ref") orelse "main";
        const workspace = try workspacePath(manager.allocator, session_id);
        errdefer manager.allocator.free(workspace);
        const credentials = try std.fmt.allocPrint(manager.allocator, "{s}:{s}", .{ username, password });
        defer manager.allocator.free(credentials);
        const encoded = try manager.allocator.alloc(u8, std.base64.standard.Encoder.calcSize(credentials.len));
        defer manager.allocator.free(encoded);
        _ = std.base64.standard.Encoder.encode(encoded, credentials);
        var command: Io.Writer.Allocating = .init(manager.allocator);
        defer command.deinit();
        try command.writer.writeAll("mkdir -p /home/node/workspaces && git -c ");
        const authorization_option = try std.fmt.allocPrint(manager.allocator, "http.extraHeader=Authorization: Basic {s}", .{encoded});
        defer manager.allocator.free(authorization_option);
        try writeShellArgument(&command.writer, authorization_option);
        try command.writer.writeAll(" clone --branch ");
        try writeShellArgument(&command.writer, reference);
        try command.writer.writeAll(" --no-single-branch -- ");
        try writeShellArgument(&command.writer, repository_url);
        try command.writer.writeByte(' ');
        try writeShellArgument(&command.writer, workspace);
        var document: Io.Writer.Allocating = .init(manager.allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"command\":");
        try std.json.Stringify.value(command.writer.buffered(), .{}, &document.writer);
        try document.writer.writeAll(",\"cwd\":\"/home/node\",\"timeout\":600}");
        const response = try manager.toolboxRequest(client, account_credential, provider_id, "/process/execute", .POST, document.writer.buffered());
        defer manager.allocator.free(response);
        var result = std.json.parseFromSlice(std.json.Value, manager.allocator, response, .{}) catch return error.InvalidDaytonaResponse;
        defer result.deinit();
        if (result.value != .object) return error.InvalidDaytonaResponse;
        const exit_code = result.value.object.get("exitCode") orelse result.value.object.get("code") orelse return error.InvalidDaytonaResponse;
        if (exit_code != .integer) return error.InvalidDaytonaResponse;
        if (exit_code.integer != 0) return error.DaytonaWorkspaceCloneFailed;
        return workspace;
    }
};

pub fn workspacePath(allocator: std.mem.Allocator, session_id: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "/home/node/workspaces/{s}", .{session_id});
}

fn writeShellArgument(writer: *Io.Writer, value: []const u8) !void {
    try writer.writeByte('\'');
    for (value) |byte| {
        if (byte == '\'') try writer.writeAll("'\\''") else try writer.writeByte(byte);
    }
    try writer.writeByte('\'');
}

fn fetch(allocator: std.mem.Allocator, client: *http.Client, url: []const u8, method: http.Method, payload: ?[]const u8, headers: []const http.Header) ![]u8 {
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = method,
        .payload = payload,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = headers,
        .response_writer = &output,
    });
    if (response.status == .not_found) return error.DaytonaResourceNotFound;
    if (response.status.class() != .success) return error.DaytonaRequestRejected;
    const body = output.buffered();
    return allocator.dupe(u8, body);
}

fn requiredResponseString(allocator: std.mem.Allocator, document: []const u8, name: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidDaytonaResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidDaytonaResponse;
    return allocator.dupe(u8, stringField(parsed.value.object, name) orelse return error.InvalidDaytonaResponse);
}

fn catalogHasHarness(allocator: std.mem.Allocator, document: []const u8, requested: []const u8) bool {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return false;
    defer parsed.deinit();
    if (parsed.value != .object) return false;
    const harnesses = parsed.value.object.get("harnesses") orelse return false;
    if (harnesses != .array) return false;
    for (harnesses.array.items) |entry| {
        if (entry != .object) continue;
        const id = stringField(entry.object, "id") orelse continue;
        const status = stringField(entry.object, "status") orelse continue;
        if (std.mem.eql(u8, id, requested) and std.mem.eql(u8, status, "available")) return true;
    }
    return false;
}

fn enrollmentDocument(allocator: std.mem.Allocator, node_id: []const u8, address: []const u8, api_key: []const u8, catalog_document: []const u8) ![]u8 {
    var catalog = std.json.parseFromSlice(std.json.Value, allocator, catalog_document, .{}) catch return error.InvalidHarnessCatalog;
    defer catalog.deinit();
    if (catalog.value != .object) return error.InvalidHarnessCatalog;
    const catalog_harnesses = catalog.value.object.get("harnesses") orelse return error.InvalidHarnessCatalog;
    if (catalog_harnesses != .array) return error.InvalidHarnessCatalog;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"nodeId\":");
    try std.json.Stringify.value(node_id, .{}, &output.writer);
    try output.writer.writeAll(",\"name\":\"Daytona worker\",\"hostname\":\"daytona\",\"os\":\"linux\",\"address\":");
    try std.json.Stringify.value(address, .{}, &output.writer);
    try output.writer.writeAll(",\"apiKey\":");
    try std.json.Stringify.value(api_key, .{}, &output.writer);
    try output.writer.writeAll(",\"role\":\"worker\",\"capabilities\":{\"compute\":true,\"harnesses\":[");
    var first = true;
    for (catalog_harnesses.array.items) |entry| {
        if (entry != .object) continue;
        const id = stringField(entry.object, "id") orelse continue;
        const status = stringField(entry.object, "status") orelse continue;
        if (!std.mem.eql(u8, status, "available")) continue;
        if (!first) try output.writer.writeByte(',');
        first = false;
        try std.json.Stringify.value(id, .{}, &output.writer);
    }
    try output.writer.writeAll("],\"mcp\":true,\"terminal\":true,\"browser\":true,\"harnessDetails\":[");
    first = true;
    for (catalog_harnesses.array.items) |entry| {
        if (entry != .object) continue;
        const id = stringField(entry.object, "id") orelse continue;
        const status = stringField(entry.object, "status") orelse continue;
        if (!std.mem.eql(u8, status, "available")) continue;
        if (!first) try output.writer.writeByte(',');
        first = false;
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(id, .{}, &output.writer);
        try output.writer.writeAll(",\"version\":");
        if (entry.object.get("version")) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"source\":");
        if (entry.object.get("source")) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"capabilities\":");
        if (entry.object.get("capabilities")) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("[]");
        try output.writer.writeByte('}');
    }
    try output.writer.writeAll("]}}");
    return output.toOwnedSlice();
}

fn writeSecretReferences(allocator: std.mem.Allocator, writer: *Io.Writer, document: []const u8) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidDaytonaSecretReferences;
    defer parsed.deinit();
    if (parsed.value != .object or parsed.value.object.count() > 64) return error.InvalidDaytonaSecretReferences;
    var iterator = parsed.value.object.iterator();
    while (iterator.next()) |entry| {
        if (!validEnvironmentName(entry.key_ptr.*) or entry.value_ptr.* != .string or entry.value_ptr.string.len == 0 or entry.value_ptr.string.len > 256) return error.InvalidDaytonaSecretReferences;
    }
    try writer.writeAll(",\"secrets\":[");
    var first = true;
    iterator = parsed.value.object.iterator();
    while (iterator.next()) |entry| {
        if (!first) try writer.writeByte(',');
        first = false;
        try writer.writeByte('{');
        try std.json.Stringify.value(entry.key_ptr.*, .{}, writer);
        try writer.writeByte(':');
        try std.json.Stringify.value(entry.value_ptr.string, .{}, writer);
        try writer.writeByte('}');
    }
    try writer.writeByte(']');
}

fn normalizeEndpoint(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const trimmed = std.mem.trimEnd(u8, std.mem.trim(u8, value, " \t\r\n"), "/");
    const candidate = if (std.ascii.startsWithIgnoreCase(trimmed, "https://")) trimmed else return error.InvalidDaytonaEndpoint;
    const uri = std.Uri.parse(candidate) catch return error.InvalidDaytonaEndpoint;
    if (uri.host == null) return error.InvalidDaytonaEndpoint;
    return allocator.dupe(u8, candidate);
}

fn validSnapshot(value: []const u8) bool {
    const trimmed = std.mem.trim(u8, value, " \t\r\n");
    if (trimmed.len == 0 or trimmed.len > 128 or !std.ascii.isAlphanumeric(trimmed[0])) return false;
    for (trimmed[1..]) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '.' and byte != '_' and byte != '-') return false;
    return true;
}

fn validVersion(value: []const u8) bool {
    if (value.len == 0 or value.len > 96 or !std.ascii.isDigit(value[0])) return false;
    var dots: usize = 0;
    for (value) |byte| {
        if (byte == '.') dots += 1 else if (!std.ascii.isAlphanumeric(byte) and byte != '-') return false;
    }
    return dots >= 2;
}

fn validEnvironmentName(value: []const u8) bool {
    if (value.len == 0 or value.len > 128 or (!std.ascii.isAlphabetic(value[0]) and value[0] != '_')) return false;
    for (value[1..]) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '_') return false;
    return true;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0 or trimmed.len > 1024 * 1024) null else trimmed;
}

fn lockedWorkerStatus(io: Io, database: *sqlite.Database, worker_id: []const u8, status: []const u8, message: ?[]const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    try cloud_store.setStatus(database, worker_id, status, message);
}

fn lockedWorkerReady(io: Io, database: *sqlite.Database, worker_id: []const u8, lease_seconds: u64) !void {
    try database.lock(io);
    defer database.unlock(io);
    try cloud_store.setReady(database, worker_id, lease_seconds);
}

fn lockedNodeCredential(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, node_id: []const u8) ![]u8 {
    try database.lock(io);
    defer database.unlock(io);
    const credential = try node_credentials.get(allocator, database, node_id);
    if (credential.len == 0) {
        allocator.free(credential);
        return error.DaytonaWorkerCredentialMissing;
    }
    return credential;
}

fn lockedAttach(io: Io, database: *sqlite.Database, worker_id: []const u8, provider_id: []const u8, node_id: []const u8, address: []const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    try cloud_store.attach(database, worker_id, provider_id, node_id, address);
}

fn lockedProvider(io: Io, database: *sqlite.Database, worker_id: []const u8, provider_id: []const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    try cloud_store.setProvider(database, worker_id, provider_id);
}
