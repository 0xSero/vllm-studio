const std = @import("std");
const config = @import("../../app/config.zig");
const sqlite = @import("../../storage/sqlite.zig");
const agent_coordinator = @import("coordinator.zig");
const harness_runtime = @import("../harness/runtime.zig");

const Io = std.Io;
const http = std.http;

pub const Result = struct {
    allocator: std.mem.Allocator,
    native_session: ?[]u8,
    summary: []u8,
    failure: ?[]u8,
    outbound_action: bool,

    pub fn deinit(result: *Result) void {
        if (result.native_session) |value| result.allocator.free(value);
        result.allocator.free(result.summary);
        if (result.failure) |value| result.allocator.free(value);
        result.* = undefined;
    }
};

pub const Heartbeat = struct {
    context: *anyopaque,
    send: *const fn (*anyopaque) anyerror!void,
};

pub fn acceptedEventCursor(allocator: std.mem.Allocator, document: []const u8) u64 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return 0;
    defer parsed.deinit();
    if (parsed.value != .object) return 0;
    const status = parsed.value.object.get("status") orelse return 0;
    if (status != .object) return 0;
    return unsignedField(status.object, "eventSeq") orelse 0;
}

pub fn wait(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, harness: *harness_runtime.Manager, session_id: []const u8, after: u64, max_summary: usize) !Result {
    return waitWithHeartbeat(allocator, io, mode, client, database, harness, session_id, after, max_summary, null);
}

pub fn waitWithHeartbeat(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, harness: *harness_runtime.Manager, session_id: []const u8, after: u64, max_summary: usize, heartbeat: ?Heartbeat) !Result {
    var cursor = after;
    var native_session: ?[]u8 = null;
    errdefer if (native_session) |value| allocator.free(value);
    var attempts: usize = 0;
    while (attempts < 14_400) : (attempts += 1) {
        try io.sleep(.fromMilliseconds(250), .awake);
        if (heartbeat) |pulse| if (attempts % 16 == 0) pulse.send(pulse.context) catch {};
        const payload = try agent_coordinator.statusPayload(allocator, io, mode, client, database, harness, session_id, cursor);
        defer allocator.free(payload);
        var status = std.json.parseFromSlice(std.json.Value, allocator, payload, .{}) catch return error.InvalidHarnessResponse;
        defer status.deinit();
        if (status.value != .object) return error.InvalidHarnessResponse;
        const state = status.value.object.get("status") orelse return error.InvalidHarnessResponse;
        if (state != .object) return error.InvalidHarnessResponse;
        if (native_session == null) {
            if (stringField(state.object, "nativeSessionId") orelse stringField(state.object, "piSessionId")) |value| native_session = try allocator.dupe(u8, value);
        }
        if (stringField(state.object, "lastError")) |failure| return .{
            .allocator = allocator,
            .native_session = native_session,
            .summary = try allocator.dupe(u8, ""),
            .failure = try allocator.dupe(u8, failure),
            .outbound_action = false,
        };
        var settled = false;
        if (status.value.object.get("events")) |events| if (events == .array) for (events.array.items) |event| {
            if (event != .object) continue;
            cursor = @max(cursor, unsignedField(event.object, "seq") orelse 0);
            const native = event.object.get("event") orelse continue;
            if (native == .object and std.mem.eql(u8, stringField(native.object, "type") orelse "", "agent_settled")) settled = true;
        };
        if (!settled) continue;
        const transcript = try agent_coordinator.transcriptPayload(allocator, io, mode, client, database, harness, session_id, null);
        defer allocator.free(transcript);
        var assistant = try lastAssistantResult(allocator, transcript, max_summary);
        errdefer assistant.deinit();
        if (native_session) |value| {
            if (assistant.native_session) |previous| allocator.free(previous);
            assistant.native_session = value;
            native_session = null;
        }
        return assistant;
    }
    return error.AgentRunTimeout;
}

fn lastAssistantResult(allocator: std.mem.Allocator, document: []const u8, max_summary: usize) !Result {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidHarnessResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidHarnessResponse;
    const entries = parsed.value.object.get("entries") orelse return error.InvalidHarnessResponse;
    if (entries != .array) return error.InvalidHarnessResponse;
    var summary = try allocator.dupe(u8, "");
    errdefer allocator.free(summary);
    var failure: ?[]u8 = null;
    var outbound_action = false;
    errdefer if (failure) |value| allocator.free(value);
    for (entries.array.items) |entry| {
        if (entry != .object or !std.mem.eql(u8, stringField(entry.object, "type") orelse "", "message")) continue;
        const message = entry.object.get("message") orelse continue;
        if (message != .object or !std.mem.eql(u8, stringField(message.object, "role") orelse "", "assistant")) continue;
        if (std.mem.eql(u8, stringField(message.object, "outboundAction") orelse "", "telegram_reaction")) outbound_action = true;
        const text = try messageText(allocator, message.object.get("content"));
        defer allocator.free(text);
        const trimmed = std.mem.trim(u8, text, " \t\r\n");
        if (trimmed.len > 0) {
            allocator.free(summary);
            summary = try allocator.dupe(u8, trimmed[0..@min(trimmed.len, max_summary)]);
            if (failure) |value| allocator.free(value);
            failure = null;
        } else if (stringField(message.object, "errorMessage")) |value| {
            if (failure) |previous| allocator.free(previous);
            failure = try allocator.dupe(u8, value);
        }
    }
    if (summary.len == 0 and failure == null and !outbound_action) failure = try allocator.dupe(u8, "Run completed without an assistant response.");
    const native = if (stringField(parsed.value.object, "nativeSessionId")) |value| try allocator.dupe(u8, value) else null;
    return .{ .allocator = allocator, .native_session = native, .summary = summary, .failure = failure, .outbound_action = outbound_action };
}

fn messageText(allocator: std.mem.Allocator, content: ?std.json.Value) ![]u8 {
    const value = content orelse return allocator.dupe(u8, "");
    if (value == .string) return allocator.dupe(u8, value.string);
    if (value != .array) return allocator.dupe(u8, "");
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    for (value.array.items) |block| {
        if (block != .object or !std.mem.eql(u8, stringField(block.object, "type") orelse "", "text")) continue;
        if (stringField(block.object, "text")) |text| try output.writer.writeAll(text);
    }
    return output.toOwnedSlice();
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn unsignedField(object: std.json.ObjectMap, name: []const u8) ?u64 {
    const value = object.get(name) orelse return null;
    if (value != .integer or value.integer < 0) return null;
    return @intCast(value.integer);
}
