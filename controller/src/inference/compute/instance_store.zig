const std = @import("std");
const instances = @import("../runtime/instance_store.zig");
const references = @import("reference_store.zig");

const max_document_bytes = 1024 * 1024;
const max_instances = 1024;
const max_devices = 256;
const max_field_bytes = 16 * 1024;

pub const Record = struct {
    allocator: std.mem.Allocator,
    name: []u8,
    node_id: []u8,
    engine: []u8,
    recipe_id: []u8,
    runtime: []u8,
    reference: ?references.Reference,
    port: u16,
    devices: [][]u8,
    nonce: []u8,
    started_at: []u8,
    ready_deadline_at: []u8,

    pub fn deinit(record: *Record) void {
        record.allocator.free(record.name);
        record.allocator.free(record.node_id);
        record.allocator.free(record.engine);
        record.allocator.free(record.recipe_id);
        record.allocator.free(record.runtime);
        if (record.reference) |*reference| reference.deinit(record.allocator);
        for (record.devices) |device| record.allocator.free(device);
        record.allocator.free(record.devices);
        record.allocator.free(record.nonce);
        record.allocator.free(record.started_at);
        record.allocator.free(record.ready_deadline_at);
        record.* = undefined;
    }

    pub fn legacyView(record: *const Record) instances.Record {
        return .{
            .allocator = record.allocator,
            .recipe_id = record.recipe_id,
            .engine = record.engine,
            .port = record.port,
            .nonce = record.nonce,
            .started_at = record.started_at,
            .ready_deadline_at = record.ready_deadline_at,
            .process = if (record.reference) |*reference| reference.processValue() else null,
        };
    }
};

pub const List = struct {
    allocator: std.mem.Allocator,
    records: []Record,

    pub fn deinit(instance_list: *List) void {
        for (instance_list.records) |*record| record.deinit();
        instance_list.allocator.free(instance_list.records);
        instance_list.* = undefined;
    }
};

pub fn directoryPath(allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ data_dir, "instances" });
}

pub fn placementLockPath(allocator: std.mem.Allocator, directory: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ directory, "placement.lock" });
}

pub fn logPath(allocator: std.mem.Allocator, directory: []const u8, name: []const u8) ![]u8 {
    const safe = try safeName(allocator, name);
    defer allocator.free(safe);
    const filename = try std.fmt.allocPrint(allocator, "{s}.log", .{safe});
    defer allocator.free(filename);
    return std.fs.path.join(allocator, &.{ directory, "logs", filename });
}

pub fn read(allocator: std.mem.Allocator, io: std.Io, directory: []const u8, name: []const u8) !?Record {
    const path = try recordPath(allocator, directory, name);
    defer allocator.free(path);
    return readPath(allocator, io, path);
}

pub fn list(allocator: std.mem.Allocator, io: std.Io, directory: []const u8) !List {
    var records: std.ArrayList(Record) = .empty;
    errdefer {
        for (records.items) |*record| record.deinit();
        records.deinit(allocator);
    }
    var folder = std.Io.Dir.openDirAbsolute(io, directory, .{ .iterate = true }) catch |failure| switch (failure) {
        error.FileNotFound => return .{ .allocator = allocator, .records = try allocator.alloc(Record, 0) },
        else => return failure,
    };
    defer folder.close(io);
    var iterator = folder.iterateAssumeFirstIteration();
    while (try iterator.next(io)) |entry| {
        if (entry.kind != .file or !std.mem.endsWith(u8, entry.name, ".json")) continue;
        if (records.items.len >= max_instances) return error.TooManyInstanceRecords;
        const path = try std.fs.path.join(allocator, &.{ directory, entry.name });
        defer allocator.free(path);
        var record = try readPath(allocator, io, path) orelse continue;
        errdefer record.deinit();
        try records.append(allocator, record);
    }
    std.mem.sort(Record, records.items, {}, lessThanName);
    return .{ .allocator = allocator, .records = try records.toOwnedSlice(allocator) };
}

pub fn createReservation(allocator: std.mem.Allocator, io: std.Io, name: []const u8, engine: []const u8, recipe_id: []const u8, runtime: []const u8, port: u16, devices: []const []const u8, nonce: []const u8, ready_timeout_seconds: u64) !Record {
    var started_buffer: [24]u8 = undefined;
    var deadline_buffer: [24]u8 = undefined;
    return create(allocator, name, "self", engine, recipe_id, runtime, null, port, devices, nonce, formatTimestampAt(io, 0, &started_buffer), formatTimestampAt(io, ready_timeout_seconds, &deadline_buffer));
}

pub fn setProcess(record: *Record, reference: instances.ProcessReference) !void {
    const token = if (reference.start_token) |value| try record.allocator.dupe(u8, value) else null;
    if (record.reference) |*current| current.deinit(record.allocator);
    record.reference = .{ .process = .{
        .pid = reference.pid,
        .process_group_id = reference.process_group_id,
        .session_id = reference.session_id,
        .start_token = token,
    } };
}

pub fn setDocker(record: *Record, container_id: []const u8, daemon_id: []const u8, executable_path: []const u8, executable_token: []const u8) !void {
    const id = try record.allocator.dupe(u8, container_id);
    errdefer record.allocator.free(id);
    const daemon = try record.allocator.dupe(u8, daemon_id);
    errdefer record.allocator.free(daemon);
    const path = try record.allocator.dupe(u8, executable_path);
    errdefer record.allocator.free(path);
    const token = try record.allocator.dupe(u8, executable_token);
    if (record.reference) |*current| current.deinit(record.allocator);
    record.reference = .{ .docker = .{ .container_id = id, .daemon_id = daemon, .executable_path = path, .executable_token = token } };
}

pub fn setDockerPending(record: *Record, container_name: []const u8, daemon_id: []const u8, executable_path: []const u8, executable_token: []const u8) !void {
    const name = try record.allocator.dupe(u8, container_name);
    errdefer record.allocator.free(name);
    const nonce = try record.allocator.dupe(u8, record.nonce);
    errdefer record.allocator.free(nonce);
    const daemon = try record.allocator.dupe(u8, daemon_id);
    errdefer record.allocator.free(daemon);
    const path = try record.allocator.dupe(u8, executable_path);
    errdefer record.allocator.free(path);
    const token = try record.allocator.dupe(u8, executable_token);
    if (record.reference) |*current| current.deinit(record.allocator);
    record.reference = .{ .docker_pending = .{ .container_name = name, .nonce = nonce, .daemon_id = daemon, .executable_path = path, .executable_token = token } };
}

pub fn write(io: std.Io, directory: []const u8, record: *const Record) !void {
    const path = try recordPath(record.allocator, directory, record.name);
    defer record.allocator.free(path);
    const document = try payload(record.allocator, record);
    defer record.allocator.free(document);
    var atomic_file = try std.Io.Dir.cwd().createFileAtomic(io, path, .{
        .permissions = @enumFromInt(0o600),
        .make_path = true,
        .replace = true,
    });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, document);
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
}

pub fn drop(allocator: std.mem.Allocator, io: std.Io, directory: []const u8, name: []const u8) !void {
    const path = try recordPath(allocator, directory, name);
    defer allocator.free(path);
    std.Io.Dir.cwd().deleteFile(io, path) catch |failure| switch (failure) {
        error.FileNotFound => {},
        else => return failure,
    };
}

pub fn payload(allocator: std.mem.Allocator, record: *const Record) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"name\":");
    try std.json.Stringify.value(record.name, .{}, &output.writer);
    try output.writer.writeAll(",\"nodeId\":");
    try std.json.Stringify.value(record.node_id, .{}, &output.writer);
    try output.writer.writeAll(",\"engine\":");
    try std.json.Stringify.value(record.engine, .{}, &output.writer);
    try output.writer.writeAll(",\"recipeId\":");
    try std.json.Stringify.value(record.recipe_id, .{}, &output.writer);
    try output.writer.writeAll(",\"runtime\":");
    try std.json.Stringify.value(record.runtime, .{}, &output.writer);
    try output.writer.writeAll(",\"ref\":");
    if (record.reference) |*reference| try reference.writeJson(&output.writer) else try output.writer.writeAll("null");
    try output.writer.print(",\"port\":{d},\"devices\":", .{record.port});
    try std.json.Stringify.value(record.devices, .{}, &output.writer);
    try output.writer.writeAll(",\"nonce\":");
    try std.json.Stringify.value(record.nonce, .{}, &output.writer);
    try output.writer.writeAll(",\"startedAt\":");
    try std.json.Stringify.value(record.started_at, .{}, &output.writer);
    try output.writer.writeAll(",\"readyDeadlineAt\":");
    try std.json.Stringify.value(record.ready_deadline_at, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn readPath(allocator: std.mem.Allocator, io: std.Io, path: []const u8) !?Record {
    const document = std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .limited(max_document_bytes)) catch |failure| switch (failure) {
        error.FileNotFound => return null,
        else => return failure,
    };
    defer allocator.free(document);
    try hardenFile(allocator, path);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInstanceRecord;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInstanceRecord;
    const object = parsed.value.object;
    const name = stringField(object, "name") orelse return error.InvalidInstanceRecord;
    const node_id = stringField(object, "nodeId") orelse return error.InvalidInstanceRecord;
    const engine = stringField(object, "engine") orelse return error.InvalidInstanceRecord;
    const recipe_id = stringField(object, "recipeId") orelse return error.InvalidInstanceRecord;
    const runtime = stringField(object, "runtime") orelse return error.InvalidInstanceRecord;
    if (!validEngine(engine) or (!std.mem.eql(u8, runtime, "process") and !std.mem.eql(u8, runtime, "docker"))) return error.InvalidInstanceRecord;
    const port = positiveU16(object.get("port")) orelse return error.InvalidInstanceRecord;
    const devices_value = object.get("devices") orelse return error.InvalidInstanceRecord;
    if (devices_value != .array or devices_value.array.items.len > max_devices) return error.InvalidInstanceRecord;
    var devices = try allocator.alloc([]u8, devices_value.array.items.len);
    var device_count: usize = 0;
    errdefer {
        for (devices[0..device_count]) |device| allocator.free(device);
        allocator.free(devices);
    }
    for (devices_value.array.items) |device| {
        if (device != .string or device.string.len == 0 or device.string.len > max_field_bytes) return error.InvalidInstanceRecord;
        devices[device_count] = try allocator.dupe(u8, device.string);
        device_count += 1;
    }
    var reference = try references.parse(allocator, object.get("ref"));
    errdefer if (reference) |*value| value.deinit(allocator);
    return @as(?Record, try createOwned(allocator, object, name, node_id, engine, recipe_id, runtime, reference, port, devices));
}

fn create(allocator: std.mem.Allocator, name: []const u8, node_id: []const u8, engine: []const u8, recipe_id: []const u8, runtime: []const u8, reference: ?references.Reference, port: u16, devices: []const []const u8, nonce: []const u8, started_at: []const u8, deadline: []const u8) !Record {
    var object: std.json.ObjectMap = .empty;
    defer object.deinit(allocator);
    try object.put(allocator, "nonce", .{ .string = nonce });
    try object.put(allocator, "startedAt", .{ .string = started_at });
    try object.put(allocator, "readyDeadlineAt", .{ .string = deadline });
    const owned_devices = try allocator.alloc([]u8, devices.len);
    var count: usize = 0;
    errdefer {
        for (owned_devices[0..count]) |device| allocator.free(device);
        allocator.free(owned_devices);
    }
    for (devices) |device| {
        owned_devices[count] = try allocator.dupe(u8, device);
        count += 1;
    }
    return createOwned(allocator, object, name, node_id, engine, recipe_id, runtime, reference, port, owned_devices);
}

fn createOwned(allocator: std.mem.Allocator, object: std.json.ObjectMap, name: []const u8, node_id: []const u8, engine: []const u8, recipe_id: []const u8, runtime: []const u8, reference: ?references.Reference, port: u16, devices: [][]u8) !Record {
    const name_copy = try allocator.dupe(u8, name);
    errdefer allocator.free(name_copy);
    const node_copy = try allocator.dupe(u8, node_id);
    errdefer allocator.free(node_copy);
    const engine_copy = try allocator.dupe(u8, engine);
    errdefer allocator.free(engine_copy);
    const recipe_copy = try allocator.dupe(u8, recipe_id);
    errdefer allocator.free(recipe_copy);
    const runtime_copy = try allocator.dupe(u8, runtime);
    errdefer allocator.free(runtime_copy);
    const nonce = stringField(object, "nonce") orelse return error.InvalidInstanceRecord;
    const started_at = stringField(object, "startedAt") orelse return error.InvalidInstanceRecord;
    const deadline = stringField(object, "readyDeadlineAt") orelse return error.InvalidInstanceRecord;
    const nonce_copy = try allocator.dupe(u8, nonce);
    errdefer allocator.free(nonce_copy);
    const started_copy = try allocator.dupe(u8, started_at);
    errdefer allocator.free(started_copy);
    const deadline_copy = try allocator.dupe(u8, deadline);
    return .{ .allocator = allocator, .name = name_copy, .node_id = node_copy, .engine = engine_copy, .recipe_id = recipe_copy, .runtime = runtime_copy, .reference = reference, .port = port, .devices = devices, .nonce = nonce_copy, .started_at = started_copy, .ready_deadline_at = deadline_copy };
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len == 0 or value.string.len > max_field_bytes) return null;
    return value.string;
}

fn positiveU16(value: ?std.json.Value) ?u16 {
    const present = value orelse return null;
    if (present != .integer or present.integer <= 0 or present.integer > std.math.maxInt(u16)) return null;
    return @intCast(present.integer);
}

fn validEngine(value: []const u8) bool {
    return std.mem.eql(u8, value, "vllm") or std.mem.eql(u8, value, "sglang") or std.mem.eql(u8, value, "llamacpp") or std.mem.eql(u8, value, "mlx") or std.mem.eql(u8, value, "exllamav3");
}

fn recordPath(allocator: std.mem.Allocator, directory: []const u8, name: []const u8) ![]u8 {
    const safe = try safeName(allocator, name);
    defer allocator.free(safe);
    const filename = try std.fmt.allocPrint(allocator, "{s}.json", .{safe});
    defer allocator.free(filename);
    return std.fs.path.join(allocator, &.{ directory, filename });
}

fn safeName(allocator: std.mem.Allocator, name: []const u8) ![]u8 {
    const result = try allocator.dupe(u8, name);
    for (result) |*character| if (character.* == '/' or character.* == '\\') {
        character.* = '_';
    };
    return result;
}

fn lessThanName(_: void, left: Record, right: Record) bool {
    return std.mem.lessThan(u8, left.name, right.name);
}

fn hardenFile(allocator: std.mem.Allocator, path: []const u8) !void {
    const path_z = try allocator.dupeZ(u8, path);
    defer allocator.free(path_z);
    if (std.c.chmod(path_z.ptr, 0o600) != 0) return error.PermissionHardeningFailed;
}

fn formatTimestampAt(io: std.Io, offset_seconds: u64, buffer: *[24]u8) []const u8 {
    const seconds = std.Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @as(u64, @intCast(@max(seconds, 0))) +| offset_seconds };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{ year_day.year, month_day.month.numeric(), month_day.day_index + 1, day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute() }) catch unreachable;
}
