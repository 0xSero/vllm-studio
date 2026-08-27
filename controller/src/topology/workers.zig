const std = @import("std");
const config = @import("../app/config.zig");
const credential_repository = @import("credential_store.zig");
const rig_repository = @import("rig_store.zig");
const sqlite = @import("../storage/sqlite.zig");

const http = std.http;
const Io = std.Io;
const probe_timeout = Io.Duration.fromSeconds(3);
const max_parallel_probes = 16;
const max_probe_response_bytes = 4 * 1024 * 1024;
const max_inference_requests = 16;

pub const Pool = struct {
    allocator: std.mem.Allocator,
    mutex: Io.Mutex = .init,
    active_streams: std.StringHashMap(usize),
    inference_requests: std.atomic.Value(usize) = .init(0),

    pub fn init(allocator: std.mem.Allocator) Pool {
        return .{ .allocator = allocator, .active_streams = .init(allocator) };
    }

    pub fn deinit(pool: *Pool) void {
        var iterator = pool.active_streams.keyIterator();
        while (iterator.next()) |key| pool.allocator.free(key.*);
        pool.active_streams.deinit();
        pool.* = undefined;
    }

    pub fn acquire(pool: *Pool, io: Io, worker_id: []const u8) !void {
        try pool.mutex.lock(io);
        defer pool.mutex.unlock(io);
        if (pool.active_streams.getPtr(worker_id)) |count_ptr| {
            count_ptr.* += 1;
            return;
        }
        const owned_id = try pool.allocator.dupe(u8, worker_id);
        errdefer pool.allocator.free(owned_id);
        try pool.active_streams.put(owned_id, 1);
    }

    pub fn release(pool: *Pool, io: Io, worker_id: []const u8) void {
        pool.mutex.lockUncancelable(io);
        defer pool.mutex.unlock(io);
        const count_ptr = pool.active_streams.getPtr(worker_id) orelse return;
        if (count_ptr.* > 1) {
            count_ptr.* -= 1;
            return;
        }
        const removed = pool.active_streams.fetchRemove(worker_id) orelse return;
        pool.allocator.free(removed.key);
    }

    pub fn tryAcquireInference(pool: *Pool) bool {
        const previous = pool.inference_requests.fetchAdd(1, .acq_rel);
        if (previous < max_inference_requests) return true;
        _ = pool.inference_requests.fetchSub(1, .acq_rel);
        return false;
    }

    pub fn releaseInference(pool: *Pool) void {
        _ = pool.inference_requests.fetchSub(1, .acq_rel);
    }

    fn activeCount(pool: *Pool, io: Io, worker_id: []const u8) !usize {
        try pool.mutex.lock(io);
        defer pool.mutex.unlock(io);
        return pool.active_streams.get(worker_id) orelse 0;
    }
};

pub const Target = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    name: []u8,
    address: []u8,
    api_key: []u8,

    pub fn deinit(target: *Target) void {
        target.allocator.free(target.id);
        target.allocator.free(target.name);
        target.allocator.free(target.address);
        target.allocator.free(target.api_key);
        target.* = undefined;
    }
};

const TargetList = struct {
    allocator: std.mem.Allocator,
    storage: []Target,
    len: usize,

    fn items(targets: *TargetList) []Target {
        return targets.storage[0..targets.len];
    }

    fn deinit(targets: *TargetList) void {
        for (targets.storage[0..targets.len]) |*target| target.deinit();
        targets.allocator.free(targets.storage);
        targets.* = undefined;
    }
};

const ProbeResult = struct {
    allocator: std.mem.Allocator,
    healthy: bool = false,
    models: ?[]u8 = null,
    hardware: ?[]u8 = null,
    checked_at: [24]u8 = undefined,
    error_name: ?[]const u8 = null,

    fn deinit(result: *ProbeResult) void {
        if (result.models) |models| result.allocator.free(models);
        if (result.hardware) |hardware| result.allocator.free(hardware);
        result.* = undefined;
    }
};

const ProbeList = struct {
    allocator: std.mem.Allocator,
    storage: []ProbeResult,

    fn deinit(results: *ProbeList) void {
        for (results.storage) |*result| result.deinit();
        results.allocator.free(results.storage);
        results.* = undefined;
    }
};

const ModelEntry = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    document: []u8,

    fn deinit(model: *ModelEntry) void {
        model.allocator.free(model.id);
        model.allocator.free(model.document);
        model.* = undefined;
    }
};

const FetchResponse = struct {
    allocator: std.mem.Allocator,
    status: http.Status,
    storage: []u8,
    body: []const u8,

    fn deinit(response: *FetchResponse) void {
        response.allocator.free(response.storage);
        response.* = undefined;
    }
};

pub fn payload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, pool: *Pool) ![]u8 {
    var targets = loadTargets(allocator, io, database) catch |failure| {
        std.log.warn("could not load Worker configuration: {t}", .{failure});
        return try emptyPayload(allocator, mode);
    };
    defer targets.deinit();

    var results = try probeTargets(allocator, io, client, targets.items(), true);
    defer results.deinit();

    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"mode\":\"{t}\",\"workers\":[", .{mode});
    for (targets.items(), results.storage, 0..) |target, result, index| {
        if (index > 0) try output.writer.writeByte(',');
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(target.id, .{}, &output.writer);
        try output.writer.writeAll(",\"name\":");
        try std.json.Stringify.value(target.name, .{}, &output.writer);
        try output.writer.writeAll(",\"address\":");
        try std.json.Stringify.value(target.address, .{}, &output.writer);
        try output.writer.print(",\"healthy\":{},\"active_streams\":{d},\"models\":", .{ result.healthy, try pool.activeCount(io, target.id) });
        try output.writer.writeAll(result.models orelse "[]");
        try output.writer.writeAll(",\"hardware\":");
        try output.writer.writeAll(result.hardware orelse "null");
        try output.writer.writeAll(",\"checked_at\":");
        try std.json.Stringify.value(result.checked_at[0..], .{}, &output.writer);
        try output.writer.writeAll(",\"error\":");
        if (result.error_name) |error_name| try std.json.Stringify.value(error_name, .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.writeByte('}');
    }
    try output.writer.writeAll("]}");
    return try output.toOwnedSlice();
}

pub fn modelCatalogPayload(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database) ![]u8 {
    var targets = loadTargets(allocator, io, database) catch return try allocator.dupe(u8, "{\"object\":\"list\",\"data\":[]}");
    defer targets.deinit();
    var results = try probeTargets(allocator, io, client, targets.items(), false);
    defer results.deinit();

    var models: std.ArrayList(ModelEntry) = .empty;
    defer {
        for (models.items) |*model| model.deinit();
        models.deinit(allocator);
    }
    var model_indexes = std.StringHashMap(usize).init(allocator);
    defer model_indexes.deinit();
    for (results.storage) |result| {
        if (!result.healthy) continue;
        try addModels(allocator, &models, &model_indexes, result.models orelse continue);
    }
    std.mem.sort(ModelEntry, models.items, {}, struct {
        fn lessThan(_: void, left: ModelEntry, right: ModelEntry) bool {
            return std.mem.lessThan(u8, left.id, right.id);
        }
    }.lessThan);

    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"object\":\"list\",\"data\":[");
    for (models.items, 0..) |model, index| {
        if (index > 0) try output.writer.writeByte(',');
        try output.writer.writeAll(model.document);
    }
    try output.writer.writeAll("]}");
    return try output.toOwnedSlice();
}

pub fn findTarget(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, worker_id: []const u8) !?Target {
    var targets = try loadTargets(allocator, io, database);
    defer targets.deinit();
    for (targets.items()) |target| {
        if (std.mem.eql(u8, target.id, worker_id)) return try cloneTarget(allocator, target);
    }
    return null;
}

pub fn selectServing(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, pool: *Pool, model_id: []const u8, excluded_worker_id: ?[]const u8) !?Target {
    var targets = try loadTargets(allocator, io, database);
    defer targets.deinit();
    var results = try probeTargets(allocator, io, client, targets.items(), false);
    defer results.deinit();
    var selected_index: ?usize = null;
    var selected_count: usize = 0;
    for (targets.items(), results.storage, 0..) |target, result, index| {
        if (!result.healthy) continue;
        if (excluded_worker_id) |excluded| if (std.mem.eql(u8, target.id, excluded)) continue;
        if (!modelIsActive(allocator, result.models orelse continue, model_id)) continue;
        const active_count = try pool.activeCount(io, target.id);
        if (selected_index == null or active_count < selected_count or (active_count == selected_count and std.mem.lessThan(u8, target.name, targets.items()[selected_index.?].name))) {
            selected_index = index;
            selected_count = active_count;
        }
    }
    return if (selected_index) |index| try cloneTarget(allocator, targets.items()[index]) else null;
}

fn emptyPayload(allocator: std.mem.Allocator, mode: config.Mode) ![]u8 {
    return try std.fmt.allocPrint(allocator, "{{\"mode\":\"{t}\",\"workers\":[]}}", .{mode});
}

fn loadTargets(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database) !TargetList {
    try database.lock(io);
    defer database.unlock(io);
    return try targetsFromRigs(allocator, database);
}

fn probeTargets(allocator: std.mem.Allocator, io: Io, client: *http.Client, targets: []Target, include_hardware: bool) !ProbeList {
    const results = try allocator.alloc(ProbeResult, targets.len);
    errdefer allocator.free(results);
    for (results) |*result| result.* = .{ .allocator = allocator };
    errdefer for (results) |*result| result.deinit();
    var group: Io.Group = .init;
    defer group.cancel(io);
    var start: usize = 0;
    while (start < targets.len) {
        const end = @min(start + max_parallel_probes, targets.len);
        for (targets[start..end], results[start..end]) |*target, *result| {
            group.concurrent(io, probeInto, .{ allocator, io, client, target, result, include_hardware }) catch probeInto(allocator, io, client, target, result, include_hardware);
        }
        try group.await(io);
        start = end;
    }
    return .{ .allocator = allocator, .storage = results };
}

fn targetsFromRigs(allocator: std.mem.Allocator, database: *sqlite.Database) !TargetList {
    var stored = try rig_repository.list(allocator, database);
    defer stored.deinit();
    var targets: std.ArrayList(Target) = .empty;
    errdefer {
        for (targets.items) |*target| target.deinit();
        targets.deinit(allocator);
    }
    var seen = std.StringHashMap(void).init(allocator);
    defer seen.deinit();

    for (stored.items()) |document| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const nodes = parsed.value.object.get("nodes") orelse continue;
        if (nodes != .array) continue;
        for (nodes.array.items) |node| {
            if (node != .object) continue;
            const role = node.object.get("role") orelse continue;
            const id = node.object.get("id") orelse continue;
            const name = node.object.get("name") orelse continue;
            const address = node.object.get("address") orelse continue;
            if (role != .string or !std.mem.eql(u8, role.string, "worker")) continue;
            if (id != .string or name != .string or address != .string) continue;
            if (seen.contains(id.string)) continue;
            try targets.ensureUnusedCapacity(allocator, 1);
            try seen.ensureUnusedCapacity(1);
            const target = try makeTarget(allocator, database, id.string, name.string, address.string);
            targets.appendAssumeCapacity(target);
            seen.putAssumeCapacityNoClobber(target.id, {});
        }
    }
    const storage = try targets.toOwnedSlice(allocator);
    return .{ .allocator = allocator, .storage = storage, .len = storage.len };
}

fn makeTarget(allocator: std.mem.Allocator, database: *sqlite.Database, id: []const u8, name: []const u8, address: []const u8) !Target {
    const owned_id = try allocator.dupe(u8, id);
    errdefer allocator.free(owned_id);
    const owned_name = try allocator.dupe(u8, name);
    errdefer allocator.free(owned_name);
    const normalized_address = try normalizeAddress(allocator, address);
    errdefer allocator.free(normalized_address);
    const api_key = try credential_repository.get(allocator, database, id);
    return .{
        .allocator = allocator,
        .id = owned_id,
        .name = owned_name,
        .address = normalized_address,
        .api_key = api_key,
    };
}

fn cloneTarget(allocator: std.mem.Allocator, target: Target) !Target {
    const id = try allocator.dupe(u8, target.id);
    errdefer allocator.free(id);
    const name = try allocator.dupe(u8, target.name);
    errdefer allocator.free(name);
    const address = try allocator.dupe(u8, target.address);
    errdefer allocator.free(address);
    return .{
        .allocator = allocator,
        .id = id,
        .name = name,
        .address = address,
        .api_key = try allocator.dupe(u8, target.api_key),
    };
}

fn normalizeAddress(allocator: std.mem.Allocator, address: []const u8) ![]u8 {
    const trimmed = std.mem.trim(u8, address, " \t\r\n");
    if (trimmed.len == 0) return error.InvalidWorkerAddress;
    const candidate = if (std.ascii.startsWithIgnoreCase(trimmed, "http://") or std.ascii.startsWithIgnoreCase(trimmed, "https://"))
        try allocator.dupe(u8, trimmed)
    else
        try std.fmt.allocPrint(allocator, "http://{s}", .{trimmed});
    defer allocator.free(candidate);
    const uri = std.Uri.parse(candidate) catch return error.InvalidWorkerAddress;
    if (!std.ascii.eqlIgnoreCase(uri.scheme, "http") and !std.ascii.eqlIgnoreCase(uri.scheme, "https")) return error.InvalidWorkerAddress;
    const host = uri.host orelse return error.InvalidWorkerAddress;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    const scheme = if (std.ascii.eqlIgnoreCase(uri.scheme, "https")) "https" else "http";
    try output.writer.print("{s}://", .{scheme});
    try host.formatHost(&output.writer);
    if (uri.port) |port| {
        if ((std.mem.eql(u8, scheme, "http") and port != 80) or (std.mem.eql(u8, scheme, "https") and port != 443)) {
            try output.writer.print(":{d}", .{port});
        }
    }
    return try output.toOwnedSlice();
}

fn probeInto(allocator: std.mem.Allocator, io: Io, client: *http.Client, target: *const Target, result: *ProbeResult, include_hardware: bool) void {
    formatTimestamp(io, &result.checked_at);
    var models_response = fetchWithTimeout(allocator, io, client, target, "/v1/models") catch |failure| {
        result.error_name = @errorName(failure);
        return;
    };
    defer models_response.deinit();
    if (!isSuccess(models_response.status)) {
        result.error_name = "Worker returned an unsuccessful model response";
        return;
    }
    result.models = modelArray(allocator, models_response.body) catch |failure| {
        result.error_name = @errorName(failure);
        return;
    };
    result.healthy = true;

    if (!include_hardware) return;

    var hardware_response = fetchWithTimeout(allocator, io, client, target, "/studio/rigs") catch return;
    defer hardware_response.deinit();
    if (!isSuccess(hardware_response.status)) return;
    result.hardware = hardwareNode(allocator, hardware_response.body) catch null;
}

fn fetchWithTimeout(allocator: std.mem.Allocator, io: Io, client: *http.Client, target: *const Target, path: []const u8) !FetchResponse {
    const FetchTaskResult = anyerror!FetchResponse;
    const TimerTaskResult = Io.Cancelable!void;
    const Selection = union(enum) {
        fetch: FetchTaskResult,
        timer: TimerTaskResult,
    };
    var selections: [2]Selection = undefined;
    var select = Io.Select(Selection).init(io, &selections);
    try select.concurrent(.fetch, fetchResponse, .{ allocator, client, target, path });
    select.concurrent(.timer, waitForProbeTimeout, .{io}) catch {
        while (select.cancel()) |pending| deinitSelection(pending);
        return error.ConcurrencyUnavailable;
    };
    const selected = try select.await();
    switch (selected) {
        .fetch => |response| {
            select.cancelDiscard();
            return response;
        },
        .timer => |timer_result| {
            timer_result catch |failure| switch (failure) {
                error.Canceled => return error.Canceled,
            };
            while (select.cancel()) |pending| deinitSelection(pending);
            return error.WorkerProbeTimeout;
        },
    }
}

fn deinitSelection(selection: anytype) void {
    switch (selection) {
        .fetch => |response_result| if (response_result) |response_value| {
            var response = response_value;
            response.deinit();
        } else |_| {},
        .timer => {},
    }
}

fn waitForProbeTimeout(io: Io) Io.Cancelable!void {
    return io.sleep(probe_timeout, .awake);
}

fn fetchResponse(allocator: std.mem.Allocator, client: *http.Client, target: *const Target, path: []const u8) anyerror!FetchResponse {
    const url = try std.fmt.allocPrint(allocator, "{s}{s}", .{ target.address, path });
    defer allocator.free(url);
    const authorization = if (target.api_key.len > 0) try std.fmt.allocPrint(allocator, "Bearer {s}", .{target.api_key}) else null;
    defer if (authorization) |value| allocator.free(value);
    var headers: [2]http.Header = undefined;
    headers[0] = .{ .name = "X-Local-Studio-Federation-Hop", .value = "head" };
    var header_count: usize = 1;
    if (authorization) |value| {
        headers[1] = .{ .name = "Authorization", .value = value };
        header_count += 1;
    }
    const storage = try allocator.alloc(u8, max_probe_response_bytes);
    errdefer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = .GET,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = headers[0..header_count],
        .response_writer = &output,
    });
    return .{ .allocator = allocator, .status = response.status, .storage = storage, .body = output.buffered() };
}

fn modelArray(allocator: std.mem.Allocator, body: []const u8) ![]u8 {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, body, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidWorkerModelData;
    const data = parsed.value.object.get("data") orelse return error.InvalidWorkerModelData;
    if (data != .array) return error.InvalidWorkerModelData;
    for (data.array.items) |model| try validateModel(model);
    return try serializeValue(allocator, data);
}

fn modelIsActive(allocator: std.mem.Allocator, document: []const u8, model_id: []const u8) bool {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return false;
    defer parsed.deinit();
    if (parsed.value != .array) return false;
    for (parsed.value.array.items) |model| {
        if (model != .object) continue;
        const id = model.object.get("id") orelse continue;
        const active = model.object.get("active") orelse continue;
        if (id == .string and active == .bool and active.bool and std.mem.eql(u8, id.string, model_id)) return true;
    }
    return false;
}

fn addModels(allocator: std.mem.Allocator, models: *std.ArrayList(ModelEntry), indexes: *std.StringHashMap(usize), document: []const u8) !void {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, document, .{});
    defer parsed.deinit();
    if (parsed.value != .array) return error.InvalidWorkerModelData;
    for (parsed.value.array.items) |model| {
        if (model != .object) return error.InvalidWorkerModelData;
        const id = model.object.get("id") orelse return error.InvalidWorkerModelData;
        if (id != .string) return error.InvalidWorkerModelData;
        if (indexes.get(id.string)) |index| {
            try mergeModel(allocator, &models.items[index], model);
            continue;
        }
        try models.ensureUnusedCapacity(allocator, 1);
        try indexes.ensureUnusedCapacity(1);
        const entry = try makeModelEntry(allocator, id.string, model);
        models.appendAssumeCapacity(entry);
        indexes.putAssumeCapacityNoClobber(entry.id, models.items.len - 1);
    }
}

fn makeModelEntry(allocator: std.mem.Allocator, id: []const u8, value: std.json.Value) !ModelEntry {
    const owned_id = try allocator.dupe(u8, id);
    errdefer allocator.free(owned_id);
    return .{ .allocator = allocator, .id = owned_id, .document = try serializeValue(allocator, value) };
}

fn mergeModel(allocator: std.mem.Allocator, existing: *ModelEntry, candidate: std.json.Value) !void {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, existing.document, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidWorkerModelData;
    const arena = parsed.arena.allocator();
    const active = modelActive(parsed.value) or modelActive(candidate);
    try parsed.value.object.put(arena, "active", .{ .bool = active });
    const max_length = @max(modelMaxLength(parsed.value), modelMaxLength(candidate));
    try parsed.value.object.put(arena, "max_model_len", if (max_length > 0) numberValue(max_length) else .null);
    const updated = try serializeValue(allocator, parsed.value);
    allocator.free(existing.document);
    existing.document = updated;
}

fn modelActive(model: std.json.Value) bool {
    const value = model.object.get("active") orelse return false;
    return value == .bool and value.bool;
}

fn modelMaxLength(model: std.json.Value) f64 {
    const value = model.object.get("max_model_len") orelse return 0;
    return switch (value) {
        .integer => |integer| @floatFromInt(integer),
        .float => |float| float,
        .number_string => |number| std.fmt.parseFloat(f64, number) catch 0,
        else => 0,
    };
}

fn numberValue(value: f64) std.json.Value {
    if (@floor(value) == value and value >= @as(f64, @floatFromInt(std.math.minInt(i64))) and value <= @as(f64, @floatFromInt(std.math.maxInt(i64)))) {
        return .{ .integer = @intFromFloat(value) };
    }
    return .{ .float = value };
}

fn validateModel(model: std.json.Value) !void {
    if (model != .object) return error.InvalidWorkerModelData;
    try requireString(model.object.get("id"));
    try optionalString(model.object.get("object"));
    try optionalNumber(model.object.get("created"), false);
    try optionalString(model.object.get("owned_by"));
    try optionalBoolean(model.object.get("active"));
    try optionalNumber(model.object.get("max_model_len"), true);
    if (model.object.get("metadata")) |metadata| if (metadata != .object) return error.InvalidWorkerModelData;
}

fn hardwareNode(allocator: std.mem.Allocator, body: []const u8) !?[]u8 {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, body, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidWorkerHardwareData;
    const local_node_id = parsed.value.object.get("local_node_id") orelse return error.InvalidWorkerHardwareData;
    const rigs = parsed.value.object.get("rigs") orelse return error.InvalidWorkerHardwareData;
    if (local_node_id != .string or rigs != .array) return error.InvalidWorkerHardwareData;
    for (rigs.array.items) |rig| {
        if (rig != .object) continue;
        const nodes = rig.object.get("nodes") orelse continue;
        if (nodes != .array) continue;
        for (nodes.array.items) |node| {
            if (node != .object) continue;
            const node_id = node.object.get("id") orelse continue;
            if (node_id != .string or !std.mem.eql(u8, node_id.string, local_node_id.string)) continue;
            try validateHardwareNode(node);
            return try serializeValue(allocator, node);
        }
    }
    return null;
}

fn validateHardwareNode(node: std.json.Value) !void {
    try requireString(node.object.get("id"));
    try requireString(node.object.get("name"));
    try requireLiteral(node.object.get("hardware_type"), &.{ "dgx-spark", "gpu-desktop", "gpu-server", "mac", "laptop", "mini-pc", "custom" });
    try requireLiteral(node.object.get("role"), &.{ "head", "worker", "standalone" });
    try requireLiteral(node.object.get("source"), &.{ "detected", "manual" });
    try requireNullableString(node.object.get("hostname"));
    try requireNullableString(node.object.get("address"));
    try requireNullableString(node.object.get("os"));
    try requireNullableString(node.object.get("cpu_model"));
    try requireNullableNumber(node.object.get("cpu_cores"));
    try requireNullableNumber(node.object.get("memory_gb"));
    const accelerators = node.object.get("accelerators") orelse return error.InvalidWorkerHardwareData;
    if (accelerators != .array) return error.InvalidWorkerHardwareData;
    for (accelerators.array.items) |accelerator| {
        if (accelerator != .object) return error.InvalidWorkerHardwareData;
        try requireString(accelerator.object.get("name"));
        try requireNumber(accelerator.object.get("count"));
        try requireNullableNumber(accelerator.object.get("memory_gb"));
        try requireNullableString(accelerator.object.get("memory_type"));
        try requireNullableNumber(accelerator.object.get("memory_bandwidth_gbs"));
        try requireBoolean(accelerator.object.get("unified_memory"));
    }
    try requireNullableString(node.object.get("notes"));
}

fn serializeValue(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return try output.toOwnedSlice();
}

fn requireString(value: ?std.json.Value) !void {
    const present = value orelse return error.InvalidWorkerData;
    if (present != .string) return error.InvalidWorkerData;
}

fn optionalString(value: ?std.json.Value) !void {
    if (value) |present| if (present != .string) return error.InvalidWorkerData;
}

fn requireLiteral(value: ?std.json.Value, expected: []const []const u8) !void {
    const present = value orelse return error.InvalidWorkerData;
    if (present != .string) return error.InvalidWorkerData;
    for (expected) |literal| if (std.mem.eql(u8, present.string, literal)) return;
    return error.InvalidWorkerData;
}

fn requireNullableString(value: ?std.json.Value) !void {
    const present = value orelse return error.InvalidWorkerData;
    if (present != .string and present != .null) return error.InvalidWorkerData;
}

fn requireBoolean(value: ?std.json.Value) !void {
    const present = value orelse return error.InvalidWorkerData;
    if (present != .bool) return error.InvalidWorkerData;
}

fn optionalBoolean(value: ?std.json.Value) !void {
    if (value) |present| if (present != .bool) return error.InvalidWorkerData;
}

fn optionalNumber(value: ?std.json.Value, nullable: bool) !void {
    if (value) |present| switch (present) {
        .integer, .float, .number_string => {},
        .null => if (!nullable) return error.InvalidWorkerData,
        else => return error.InvalidWorkerData,
    };
}

fn requireNumber(value: ?std.json.Value) !void {
    const present = value orelse return error.InvalidWorkerData;
    switch (present) {
        .integer, .float, .number_string => {},
        else => return error.InvalidWorkerData,
    }
}

fn requireNullableNumber(value: ?std.json.Value) !void {
    const present = value orelse return error.InvalidWorkerData;
    switch (present) {
        .integer, .float, .number_string, .null => {},
        else => return error.InvalidWorkerData,
    }
}

fn isSuccess(status: http.Status) bool {
    const code = @intFromEnum(status);
    return code >= 200 and code < 300;
}

fn formatTimestamp(io: Io, buffer: *[24]u8) void {
    const seconds = Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds, 0)) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    _ = std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{
        year_day.year,
        month_day.month.numeric(),
        month_day.day_index + 1,
        day_seconds.getHoursIntoDay(),
        day_seconds.getMinutesIntoHour(),
        day_seconds.getSecondsIntoMinute(),
    }) catch unreachable;
}
