const std = @import("std");
const account_repository = @import("../../accounts/store.zig");
const cloud_store = @import("store.zig");
const enrollments = @import("../../topology/enrollments.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 16 * 1024 * 1024;
const controller_port = 8080;
const worker_image = "ghcr.io/jake-molnia/local-studio-controller:main";

pub const Provisioned = struct {
    allocator: std.mem.Allocator,
    provider_id: []u8,
    node_id: []u8,
    address: []u8,

    pub fn deinit(worker: *Provisioned) void {
        worker.allocator.free(worker.provider_id);
        worker.allocator.free(worker.node_id);
        worker.allocator.free(worker.address);
        worker.* = undefined;
    }
};

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

    pub fn provision(manager: *Manager, client: *http.Client, database: *sqlite.Database, worker_id: []const u8, session_id: []const u8, account_id: []const u8, requested_harness: []const u8, image: []const u8) !Provisioned {
        var account_credential = try manager.loadCredential(account_id);
        defer account_credential.deinit();
        var controller_key_bytes: [32]u8 = undefined;
        manager.io.random(&controller_key_bytes);
        const controller_key = std.fmt.bytesToHex(controller_key_bytes, .lower);
        const create_document = try manager.createDocument(worker_id, session_id, image, controller_key[0..]);
        defer manager.allocator.free(create_document);
        const created = try manager.request(client, account_credential.endpoint, account_credential.api_key, "/sandbox", .POST, create_document);
        defer manager.allocator.free(created);
        const provider_id = try requiredResponseString(manager.allocator, created, "id");
        errdefer manager.allocator.free(provider_id);
        errdefer manager.lifecycle(client, &account_credential, provider_id, .DELETE) catch {};
        try lockedWorkerStatus(manager.io, database, worker_id, "starting", null);
        const preview_path = try std.fmt.allocPrint(manager.allocator, "/sandbox/{s}/ports/{d}/preview-url", .{ provider_id, controller_port });
        defer manager.allocator.free(preview_path);
        const preview = try manager.request(client, account_credential.endpoint, account_credential.api_key, preview_path, .GET, null);
        defer manager.allocator.free(preview);
        const address = try requiredResponseString(manager.allocator, preview, "url");
        errdefer manager.allocator.free(address);
        const catalog = try manager.waitForCatalog(client, address, controller_key[0..]);
        defer manager.allocator.free(catalog);
        if (!catalogHasHarness(manager.allocator, catalog, requested_harness)) return error.CloudHarnessUnavailable;
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
        };
    }

    pub fn listPayload(manager: *Manager, database: *sqlite.Database) ![]u8 {
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        return cloud_store.listPayload(manager.allocator, database);
    }

    pub fn defaultImage(manager: *Manager) ![]u8 {
        return manager.allocator.dupe(u8, worker_image);
    }

    pub fn runReconciler(manager: *Manager, client: *http.Client, database: *sqlite.Database) Io.Cancelable!void {
        while (true) {
            manager.reconcile(client, database) catch |failure| std.log.warn("Daytona reconciliation failed: {t}", .{failure});
            try manager.io.sleep(.fromSeconds(30), .awake);
        }
    }

    fn reconcile(manager: *Manager, client: *http.Client, database: *sqlite.Database) !void {
        var candidates = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk try cloud_store.reconciliationCandidates(manager.allocator, database);
        };
        defer candidates.deinit();
        for (candidates.items.items) |*worker| {
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
                try lockedWorkerStatus(manager.io, database, worker.id, "stopping", null);
                manager.lifecycle(client, &account_credential, provider_id, .POST) catch |failure| {
                    try lockedWorkerStatus(manager.io, database, worker.id, "failed", @errorName(failure));
                    continue;
                };
                try lockedWorkerStatus(manager.io, database, worker.id, "stopped", null);
                continue;
            }
            try lockedWorkerStatus(manager.io, database, worker.id, "deleting", null);
            manager.lifecycle(client, &account_credential, provider_id, .DELETE) catch |failure| {
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

    fn createDocument(manager: *Manager, worker_id: []const u8, session_id: []const u8, image: []const u8, controller_key: []const u8) ![]u8 {
        if (!validImage(image)) return error.DaytonaImageRequired;
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"image\":");
        try std.json.Stringify.value(image, .{}, &output.writer);
        try output.writer.writeAll(",\"public\":true,\"ephemeral\":false,\"autoStopInterval\":60,\"autoDeleteInterval\":0,\"ttlMinutes\":1440,\"name\":");
        const name = try std.fmt.allocPrint(manager.allocator, "local-studio-{s}", .{worker_id[0..@min(worker_id.len, 20)]});
        defer manager.allocator.free(name);
        try std.json.Stringify.value(name, .{}, &output.writer);
        try output.writer.writeAll(",\"labels\":{\"local-studio\":\"worker\",\"local-studio-session\":");
        try std.json.Stringify.value(session_id, .{}, &output.writer);
        try output.writer.writeAll("},\"env\":{\"LOCAL_STUDIO_CONTROLLER_MODE\":\"worker\",\"LOCAL_STUDIO_HOST\":\"0.0.0.0\",\"LOCAL_STUDIO_PORT\":\"8080\",\"LOCAL_STUDIO_API_KEY\":");
        try std.json.Stringify.value(controller_key, .{}, &output.writer);
        try output.writer.writeAll(",\"LOCAL_STUDIO_DATA_DIR\":\"/home/studio/.local-studio\",\"LOCAL_STUDIO_MODELS_DIR\":\"/home/studio/models\",\"LOCAL_STUDIO_CLOUD_SESSION_ID\":");
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

    fn lifecycle(manager: *Manager, client: *http.Client, account_credential: *const Credential, provider_id: []const u8, method: http.Method) !void {
        const path = if (method == .POST)
            try std.fmt.allocPrint(manager.allocator, "/sandbox/{s}/stop", .{provider_id})
        else
            try std.fmt.allocPrint(manager.allocator, "/sandbox/{s}", .{provider_id});
        defer manager.allocator.free(path);
        const response = try manager.request(client, account_credential.endpoint, account_credential.api_key, path, method, if (method == .POST) "{}" else null);
        manager.allocator.free(response);
    }
};

fn fetch(allocator: std.mem.Allocator, client: *http.Client, url: []const u8, method: http.Method, payload: ?[]const u8, headers: []const http.Header) ![]u8 {
    const storage = try allocator.alloc(u8, max_response_bytes);
    errdefer allocator.free(storage);
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
    if (response.status.class() != .success) {
        allocator.free(storage);
        return error.DaytonaRequestRejected;
    }
    const body = output.buffered();
    const owned = try allocator.dupe(u8, body);
    allocator.free(storage);
    return owned;
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

fn validImage(value: []const u8) bool {
    const trimmed = std.mem.trim(u8, value, " \t\r\n");
    if (trimmed.len == 0 or trimmed.len > 1024 or trimmed[0] == '-') return false;
    for (trimmed) |byte| if (byte < 0x21 or byte > 0x7e or byte == '"' or byte == '\'' or byte == '\\') return false;
    if (std.mem.endsWith(u8, trimmed, ":latest") or std.mem.endsWith(u8, trimmed, ":lts") or std.mem.endsWith(u8, trimmed, ":stable")) return false;
    return true;
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

fn lockedAttach(io: Io, database: *sqlite.Database, worker_id: []const u8, provider_id: []const u8, node_id: []const u8, address: []const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    try cloud_store.attach(database, worker_id, provider_id, node_id, address);
}
