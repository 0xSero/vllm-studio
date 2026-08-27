const std = @import("std");
const account_repository = @import("../../accounts/store.zig");
const cloud_store = @import("store.zig");
const cloud_types = @import("types.zig");
const enrollments = @import("../../topology/enrollments.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 16 * 1024 * 1024;
const controller_port = 8080;

const Credential = struct {
    allocator: std.mem.Allocator,
    token: []u8,
    team_id: []u8,
    project_id: []u8,

    fn deinit(credential: *Credential) void {
        credential.allocator.free(credential.token);
        credential.allocator.free(credential.team_id);
        credential.allocator.free(credential.project_id);
        credential.* = undefined;
    }
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []u8,
    environment: *const std.process.Environ.Map,

    pub fn init(allocator: std.mem.Allocator, io: Io, data_dir: []const u8, environment: *const std.process.Environ.Map) !Manager {
        return .{
            .allocator = allocator,
            .io = io,
            .data_dir = try allocator.dupe(u8, data_dir),
            .environment = environment,
        };
    }

    pub fn deinit(manager: *Manager) void {
        manager.allocator.free(manager.data_dir);
        manager.* = undefined;
    }

    pub fn provision(manager: *Manager, client: *http.Client, database: *sqlite.Database, worker_id: []const u8, session_id: []const u8, account_id: []const u8, requested_harness: []const u8, image: []const u8, vcpus: u8, checkout: []const u8) !cloud_types.Provisioned {
        var credential = try manager.loadCredential(account_id);
        defer credential.deinit();
        var controller_key_bytes: [32]u8 = undefined;
        manager.io.random(&controller_key_bytes);
        const controller_key = std.fmt.bytesToHex(controller_key_bytes, .lower);
        const name = try std.fmt.allocPrint(manager.allocator, "local-studio-{s}", .{worker_id[0..@min(worker_id.len, 20)]});
        defer manager.allocator.free(name);
        const create_document = try manager.createDocument(name, session_id, image, vcpus, controller_key[0..], credential.project_id);
        defer manager.allocator.free(create_document);
        const created = manager.request(client, &credential, "/v3/sandboxes", .POST, create_document, null) catch return error.VercelSandboxCreateRejected;
        defer manager.allocator.free(created);
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, created, .{}) catch return error.InvalidVercelResponse;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidVercelResponse;
        const sandbox = parsed.value.object.get("sandbox") orelse return error.InvalidVercelResponse;
        const session = parsed.value.object.get("session") orelse return error.InvalidVercelResponse;
        const routes = parsed.value.object.get("routes") orelse return error.InvalidVercelResponse;
        if (sandbox != .object or session != .object or routes != .array) return error.InvalidVercelResponse;
        const provider_id = try manager.allocator.dupe(u8, stringField(sandbox.object, "name") orelse return error.InvalidVercelResponse);
        errdefer manager.allocator.free(provider_id);
        const provider_session_id = stringField(session.object, "id") orelse return error.InvalidVercelResponse;
        const address = try routeAddress(manager.allocator, routes.array.items, controller_port);
        errdefer manager.allocator.free(address);
        errdefer manager.deleteSandbox(client, &credential, provider_id) catch {};
        try lockedWorkerStatus(manager.io, database, worker_id, "starting", null);
        try manager.verifyHead(client, &credential, provider_session_id);
        const started = try manager.execute(client, &credential, provider_session_id, "/usr/local/bin/local-studio-controller", &.{}, null, false);
        manager.allocator.free(started);
        const catalog = try manager.waitForCatalog(client, address, controller_key[0..]);
        defer manager.allocator.free(catalog);
        if (!catalogHasHarness(manager.allocator, catalog, requested_harness)) return error.CloudHarnessUnavailable;
        const workspace = try manager.cloneWorkspace(client, &credential, provider_session_id, session_id, checkout);
        errdefer manager.allocator.free(workspace);
        const node_id = try std.fmt.allocPrint(manager.allocator, "vercel-{s}", .{worker_id[0..@min(worker_id.len, 20)]});
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

    pub fn ownsAccount(manager: *Manager, account_id: []const u8) !bool {
        var accounts = try account_repository.load(manager.allocator, manager.io, manager.data_dir);
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse return false;
        return std.mem.eql(u8, account.provider, "vercel");
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
            var credential = manager.loadCredential(worker.account_id) catch |failure| {
                try lockedWorkerStatus(manager.io, database, worker.id, "failed", @errorName(failure));
                continue;
            };
            defer credential.deinit();
            if (std.mem.eql(u8, worker.status, "ready")) {
                try lockedWorkerStatus(manager.io, database, worker.id, "stopping", null);
                manager.stopSandbox(client, &credential, provider_id) catch |failure| {
                    try lockedWorkerStatus(manager.io, database, worker.id, "failed", @errorName(failure));
                    continue;
                };
                try lockedWorkerStatus(manager.io, database, worker.id, "stopped", null);
                continue;
            }
            try lockedWorkerStatus(manager.io, database, worker.id, "deleting", null);
            manager.deleteSandbox(client, &credential, provider_id) catch |failure| {
                try lockedWorkerStatus(manager.io, database, worker.id, "failed", @errorName(failure));
                continue;
            };
            if (worker.node_id) |node_id| {
                const removed = enrollments.deletePayload(manager.allocator, manager.io, database, node_id) catch null;
                if (removed) |payload| manager.allocator.free(payload);
            }
            try lockedWorkerStatus(manager.io, database, worker.id, "deleted", null);
        }
    }

    fn loadCredential(manager: *Manager, account_id: []const u8) !Credential {
        var accounts = try account_repository.load(manager.allocator, manager.io, manager.data_dir);
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse return error.SandboxAccountNotFound;
        if (!std.mem.eql(u8, account.provider, "vercel")) return error.VercelAccountRequired;
        var configuration = std.json.parseFromSlice(std.json.Value, manager.allocator, account.configuration_json, .{}) catch return error.InvalidVercelCredential;
        defer configuration.deinit();
        if (configuration.value != .object) return error.InvalidVercelCredential;
        const team_id = stringField(configuration.value.object, "teamId") orelse return error.InvalidVercelCredential;
        const project_id = stringField(configuration.value.object, "projectId") orelse return error.InvalidVercelCredential;
        if (!validIdentifier(team_id) or !validIdentifier(project_id)) return error.InvalidVercelCredential;
        const stored = try account_repository.resolveSecret(manager.allocator, manager.io, manager.environment, manager.data_dir, &accounts, account.secret_ref, account.secret_provider);
        defer manager.allocator.free(stored);
        var secret = std.json.parseFromSlice(std.json.Value, manager.allocator, stored, .{}) catch return error.InvalidVercelCredential;
        defer secret.deinit();
        if (secret.value != .object) return error.InvalidVercelCredential;
        const token = stringField(secret.value.object, "token") orelse return error.InvalidVercelCredential;
        return .{
            .allocator = manager.allocator,
            .token = try manager.allocator.dupe(u8, token),
            .team_id = try manager.allocator.dupe(u8, team_id),
            .project_id = try manager.allocator.dupe(u8, project_id),
        };
    }

    fn createDocument(manager: *Manager, name: []const u8, session_id: []const u8, image: []const u8, vcpus: u8, controller_key: []const u8, project_id: []const u8) ![]u8 {
        if (vcpus == 0 or vcpus > 32) return error.InvalidSandboxProfile;
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"projectId\":");
        try std.json.Stringify.value(project_id, .{}, &output.writer);
        try output.writer.writeAll(",\"name\":");
        try std.json.Stringify.value(name, .{}, &output.writer);
        try output.writer.writeAll(",\"image\":");
        try std.json.Stringify.value(image, .{}, &output.writer);
        try output.writer.print(",\"ports\":[{d}],\"timeout\":2700000,\"persistent\":true,\"snapshotExpiration\":604800000,\"keepLastSnapshots\":{{\"count\":1,\"deleteEvicted\":true}},\"resources\":{{\"vcpus\":{d}}},\"tags\":{{\"local-studio\":\"worker\",\"session\":", .{ controller_port, vcpus });
        try std.json.Stringify.value(session_id, .{}, &output.writer);
        try output.writer.writeAll("},\"env\":{\"LOCAL_STUDIO_CONTROLLER_MODE\":\"worker\",\"LOCAL_STUDIO_HOST\":\"0.0.0.0\",\"LOCAL_STUDIO_PORT\":\"8080\",\"LOCAL_STUDIO_API_KEY\":");
        try std.json.Stringify.value(controller_key, .{}, &output.writer);
        try output.writer.writeAll(",\"LOCAL_STUDIO_DATA_DIR\":\"/home/node/.local-studio\",\"LOCAL_STUDIO_MODELS_DIR\":\"/home/node/models\",\"LOCAL_STUDIO_CLOUD_SESSION_ID\":");
        try std.json.Stringify.value(session_id, .{}, &output.writer);
        if (manager.environment.get("LOCAL_STUDIO_VERCEL_SECRETSPEC_PROVIDER")) |provider| {
            try output.writer.writeAll(",\"LOCAL_STUDIO_SECRETSPEC_PROVIDER\":");
            try std.json.Stringify.value(provider, .{}, &output.writer);
        }
        if (manager.environment.get("LOCAL_STUDIO_VERCEL_HEAD_URL")) |head_url| {
            try output.writer.writeAll(",\"LOCAL_STUDIO_HEAD_URL\":");
            try std.json.Stringify.value(head_url, .{}, &output.writer);
        }
        if (manager.environment.get("LOCAL_STUDIO_VERCEL_HEAD_API_KEY")) |head_api_key| {
            try output.writer.writeAll(",\"LOCAL_STUDIO_HEAD_API_KEY\":");
            try std.json.Stringify.value(head_api_key, .{}, &output.writer);
        }
        try output.writer.writeAll("}}");
        return output.toOwnedSlice();
    }

    fn verifyHead(manager: *Manager, client: *http.Client, credential: *const Credential, provider_session_id: []const u8) !void {
        if (manager.environment.get("LOCAL_STUDIO_VERCEL_HEAD_URL") == null) return error.VercelHeadEndpointRequired;
        const response = manager.execute(client, credential, provider_session_id, "bash", &.{ "-lc", "curl --fail --silent --show-error --max-time 20 \"$LOCAL_STUDIO_HEAD_URL/health\" >/dev/null" }, null, true) catch return error.VercelHeadUnavailable;
        manager.allocator.free(response);
    }

    fn request(manager: *Manager, client: *http.Client, credential: *const Credential, path: []const u8, method: http.Method, payload: ?[]const u8, query: ?[]const u8) ![]u8 {
        const url = try std.fmt.allocPrint(manager.allocator, "https://vercel.com/api{s}?teamId={s}{s}", .{ path, credential.team_id, query orelse "" });
        defer manager.allocator.free(url);
        const authorization = try std.fmt.allocPrint(manager.allocator, "Bearer {s}", .{credential.token});
        defer manager.allocator.free(authorization);
        return fetch(manager.allocator, client, url, method, payload, &.{
            .{ .name = "Authorization", .value = authorization },
            .{ .name = "Content-Type", .value = "application/json" },
            .{ .name = "User-Agent", .value = "local-studio-controller" },
        });
    }

    fn execute(manager: *Manager, client: *http.Client, credential: *const Credential, provider_session_id: []const u8, command: []const u8, args: []const []const u8, environment: ?std.json.Value, wait: bool) ![]u8 {
        var document: Io.Writer.Allocating = .init(manager.allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"command\":");
        try std.json.Stringify.value(command, .{}, &document.writer);
        try document.writer.writeAll(",\"args\":");
        try std.json.Stringify.value(args, .{}, &document.writer);
        try document.writer.writeAll(",\"env\":");
        if (environment) |value| try std.json.Stringify.value(value, .{}, &document.writer) else try document.writer.writeAll("{}");
        try document.writer.writeAll(",\"sudo\":false}");
        const path = try std.fmt.allocPrint(manager.allocator, "/v2/sandboxes/sessions/{s}/cmd", .{provider_session_id});
        defer manager.allocator.free(path);
        const started = try manager.request(client, credential, path, .POST, document.writer.buffered(), null);
        if (!wait) return started;
        defer manager.allocator.free(started);
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, started, .{}) catch return error.InvalidVercelResponse;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidVercelResponse;
        const command_value = parsed.value.object.get("command") orelse return error.InvalidVercelResponse;
        if (command_value != .object) return error.InvalidVercelResponse;
        const command_id = stringField(command_value.object, "id") orelse return error.InvalidVercelResponse;
        const status_path = try std.fmt.allocPrint(manager.allocator, "/v2/sandboxes/sessions/{s}/cmd/{s}", .{ provider_session_id, command_id });
        defer manager.allocator.free(status_path);
        const finished = try manager.request(client, credential, status_path, .GET, null, "&wait=true");
        errdefer manager.allocator.free(finished);
        var result = std.json.parseFromSlice(std.json.Value, manager.allocator, finished, .{}) catch return error.InvalidVercelResponse;
        defer result.deinit();
        const result_command = if (result.value == .object) result.value.object.get("command") orelse return error.InvalidVercelResponse else return error.InvalidVercelResponse;
        if (result_command != .object) return error.InvalidVercelResponse;
        const exit_code = result_command.object.get("exitCode") orelse return error.InvalidVercelResponse;
        if (exit_code != .integer or exit_code.integer != 0) return error.VercelCommandFailed;
        return finished;
    }

    fn cloneWorkspace(manager: *Manager, client: *http.Client, credential: *const Credential, provider_session_id: []const u8, session_id: []const u8, checkout: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, checkout, .{}) catch return error.InvalidCloudCheckout;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidCloudCheckout;
        const repository_url = stringField(parsed.value.object, "url") orelse return error.InvalidCloudCheckout;
        const username = stringField(parsed.value.object, "username") orelse return error.InvalidCloudCheckout;
        const password = stringField(parsed.value.object, "password") orelse return error.InvalidCloudCheckout;
        const reference = stringField(parsed.value.object, "ref") orelse "main";
        const workspace = try workspacePath(manager.allocator, session_id);
        errdefer manager.allocator.free(workspace);
        const scheme = "https://";
        if (!std.mem.startsWith(u8, repository_url, scheme)) return error.InvalidCloudCheckout;
        const authenticated_url = try std.fmt.allocPrint(manager.allocator, "{s}{s}:{s}@{s}", .{ scheme, username, password, repository_url[scheme.len..] });
        defer manager.allocator.free(authenticated_url);
        const rewrite_key = try std.fmt.allocPrint(manager.allocator, "url.{s}.insteadOf", .{authenticated_url});
        defer manager.allocator.free(rewrite_key);
        const lfs_url = try std.fmt.allocPrint(manager.allocator, "{s}/info/lfs", .{authenticated_url});
        defer manager.allocator.free(lfs_url);
        var environment: Io.Writer.Allocating = .init(manager.allocator);
        defer environment.deinit();
        try environment.writer.writeAll("{\"GIT_CONFIG_COUNT\":\"2\",\"GIT_CONFIG_KEY_0\":");
        try std.json.Stringify.value(rewrite_key, .{}, &environment.writer);
        try environment.writer.writeAll(",\"GIT_CONFIG_VALUE_0\":");
        try std.json.Stringify.value(repository_url, .{}, &environment.writer);
        try environment.writer.writeAll(",\"GIT_CONFIG_KEY_1\":\"lfs.url\",\"GIT_CONFIG_VALUE_1\":");
        try std.json.Stringify.value(lfs_url, .{}, &environment.writer);
        try environment.writer.writeAll(",\"LOCAL_STUDIO_GIT_REF\":");
        try std.json.Stringify.value(reference, .{}, &environment.writer);
        try environment.writer.writeAll(",\"LOCAL_STUDIO_GIT_URL\":");
        try std.json.Stringify.value(repository_url, .{}, &environment.writer);
        try environment.writer.writeAll(",\"LOCAL_STUDIO_GIT_WORKSPACE\":");
        try std.json.Stringify.value(workspace, .{}, &environment.writer);
        try environment.writer.writeByte('}');
        var environment_json = std.json.parseFromSlice(std.json.Value, manager.allocator, environment.writer.buffered(), .{}) catch return error.InvalidCloudCheckout;
        defer environment_json.deinit();
        const command = "mkdir -p /home/node/workspaces && git clone --branch \"$LOCAL_STUDIO_GIT_REF\" -- \"$LOCAL_STUDIO_GIT_URL\" \"$LOCAL_STUDIO_GIT_WORKSPACE\"";
        const response = manager.execute(client, credential, provider_session_id, "bash", &.{ "-lc", command }, environment_json.value, true) catch return error.VercelWorkspaceCloneFailed;
        manager.allocator.free(response);
        return workspace;
    }

    fn waitForCatalog(manager: *Manager, client: *http.Client, address: []const u8, controller_key: []const u8) ![]u8 {
        const url = try std.fmt.allocPrint(manager.allocator, "{s}/internal/harness/v1/catalog", .{std.mem.trimEnd(u8, address, "/")});
        defer manager.allocator.free(url);
        const authorization = try std.fmt.allocPrint(manager.allocator, "Bearer {s}", .{controller_key});
        defer manager.allocator.free(authorization);
        const deadline = Io.Clock.awake.now(manager.io).addDuration(.fromSeconds(120));
        while (Io.Clock.awake.now(manager.io).durationTo(deadline).toNanoseconds() > 0) {
            if (fetch(manager.allocator, client, url, .GET, null, &.{.{ .name = "Authorization", .value = authorization }})) |catalog| return catalog else |_| {}
            try manager.io.sleep(.fromSeconds(2), .awake);
        }
        return error.VercelWorkerNotReady;
    }

    fn stopSandbox(manager: *Manager, client: *http.Client, credential: *const Credential, name: []const u8) !void {
        const path = try std.fmt.allocPrint(manager.allocator, "/v2/sandboxes/{s}", .{name});
        defer manager.allocator.free(path);
        const query = try std.fmt.allocPrint(manager.allocator, "&projectId={s}", .{credential.project_id});
        defer manager.allocator.free(query);
        const document = try manager.request(client, credential, path, .GET, null, query);
        defer manager.allocator.free(document);
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidVercelResponse;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidVercelResponse;
        const session = parsed.value.object.get("session") orelse return error.InvalidVercelResponse;
        if (session != .object) return error.InvalidVercelResponse;
        const status = stringField(session.object, "status") orelse return error.InvalidVercelResponse;
        if (!std.mem.eql(u8, status, "running") and !std.mem.eql(u8, status, "pending")) return;
        const session_id = stringField(session.object, "id") orelse return error.InvalidVercelResponse;
        const stop_path = try std.fmt.allocPrint(manager.allocator, "/v2/sandboxes/sessions/{s}/stop", .{session_id});
        defer manager.allocator.free(stop_path);
        const stopped = try manager.request(client, credential, stop_path, .POST, "{}", null);
        manager.allocator.free(stopped);
    }

    fn deleteSandbox(manager: *Manager, client: *http.Client, credential: *const Credential, name: []const u8) !void {
        const path = try std.fmt.allocPrint(manager.allocator, "/v2/sandboxes/{s}", .{name});
        defer manager.allocator.free(path);
        const query = try std.fmt.allocPrint(manager.allocator, "&projectId={s}&deleteOrphanSnapshots=true", .{credential.project_id});
        defer manager.allocator.free(query);
        const response = try manager.request(client, credential, path, .DELETE, null, query);
        manager.allocator.free(response);
    }
};

pub fn workspacePath(allocator: std.mem.Allocator, session_id: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "/home/node/workspaces/{s}", .{session_id});
}

fn routeAddress(allocator: std.mem.Allocator, routes: []const std.json.Value, port: u16) ![]u8 {
    for (routes) |route| {
        if (route != .object) continue;
        const route_port = route.object.get("port") orelse continue;
        if (route_port != .integer or route_port.integer != port) continue;
        return allocator.dupe(u8, stringField(route.object, "url") orelse continue);
    }
    return error.VercelControllerRouteMissing;
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
    if (response.status.class() != .success) return error.VercelRequestRejected;
    return allocator.dupe(u8, output.buffered());
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
    try output.writer.writeAll(",\"name\":\"Vercel worker\",\"hostname\":\"vercel\",\"os\":\"linux\",\"address\":");
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

fn validIdentifier(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '_' and byte != '-') return false;
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

fn lockedAttach(io: Io, database: *sqlite.Database, worker_id: []const u8, provider_id: []const u8, node_id: []const u8, address: []const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    try cloud_store.attach(database, worker_id, provider_id, node_id, address);
}
