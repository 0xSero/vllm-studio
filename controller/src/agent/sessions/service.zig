const std = @import("std");
const records = @import("control_store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const session_change = @import("change.zig");

const Io = std.Io;
const thread_title_project_id = "__local_studio_thread_title__";

pub fn payload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database) ![]u8 {
    try database.lock(io);
    defer database.unlock(io);
    var sessions = try records.list(allocator, database);
    defer sessions.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"sessions\":[");
    for (sessions.records, 0..) |session, index| {
        if (index > 0) try output.writer.writeByte(',');
        try writeMetadata(&output.writer, &session);
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn fingerprint(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database) !u64 {
    const document = try payload(allocator, io, database);
    defer allocator.free(document);
    return std.hash.Wyhash.hash(0, document);
}

pub fn upsert(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, session_id: []const u8, document: []const u8) ![]u8 {
    if (!validSessionId(session_id)) return error.InvalidSessionId;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidSessionMetadata;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidSessionMetadata;
    try database.lock(io);
    defer database.unlock(io);
    var existing = try records.get(allocator, database, session_id);
    defer if (existing) |*session| session.deinit();
    const object = parsed.value.object;
    const node_id = optionalString(object, "desktop_id") orelse optionalString(object, "node_id") orelse if (existing) |session| session.node_id else return error.SessionNodeRequired;
    const harness = optionalString(object, "harness") orelse if (existing) |session| session.harness else "pi";
    const status = optionalString(object, "status") orelse if (existing) |session| session.status else "idle";
    const sharing = optionalString(object, "sharing_policy") orelse if (existing) |session| session.sharing_policy else "private";
    try records.save(database, .{
        .id = session_id,
        .harness = harness,
        .harness_version = optionalString(object, "harness_version") orelse if (existing) |session| session.harness_version else null,
        .capabilities_json = if (existing) |session| session.capabilities_json else "[]",
        .node_id = node_id,
        .native_session_id = optionalString(object, "native_session_id") orelse optionalString(object, "pi_session_id"),
        .project_id = optionalString(object, "project_id"),
        .project_path = optionalString(object, "project_path"),
        .model_id = optionalString(object, "model_id"),
        .model_route_id = optionalString(object, "model_route_id"),
        .status = status,
        .event_cursor = unsignedField(object, "event_cursor") orelse if (existing) |session| session.event_cursor else 0,
        .sharing_policy = sharing,
        .automation_id = optionalString(object, "automation_id"),
    });
    session_change.notify();
    var saved = (try records.get(allocator, database, session_id)) orelse return error.SessionNotFound;
    defer saved.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"success\":true,\"session\":");
    try writeMetadata(&output.writer, &saved);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

pub fn historyPayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, project_path: ?[]const u8, project_id: ?[]const u8, archived_only: bool, include_archived: bool, limit: ?usize) ![]u8 {
    try database.lock(io);
    defer database.unlock(io);
    var sessions = try records.list(allocator, database);
    defer sessions.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"sessions\":[");
    var count: usize = 0;
    var emitted = std.StringHashMap(void).init(allocator);
    defer emitted.deinit();
    for (sessions.records) |session| {
        if (session.project_id) |session_project_id| if (std.mem.eql(u8, session_project_id, thread_title_project_id)) continue;
        const identity = session.native_session_id orelse session.id;
        if (emitted.contains(identity)) continue;
        var canonical = if (session.native_session_id) |native_session_id| try records.getByNative(allocator, database, native_session_id) else null;
        defer if (canonical) |*value| value.deinit();
        const selected = if (canonical) |*value| value else &session;
        const archived = std.mem.eql(u8, selected.status, "archived");
        if (archived_only != archived and (archived_only or !include_archived)) continue;
        if (project_path) |expected| if (selected.project_path == null or !std.mem.eql(u8, selected.project_path.?, expected)) continue;
        if (project_id) |expected| if (selected.project_id == null or !std.mem.eql(u8, selected.project_id.?, expected)) continue;
        if (limit) |maximum| if (count >= maximum) break;
        try emitted.put(identity, {});
        if (count > 0) try output.writer.writeByte(',');
        const first_message = try firstUserMessage(allocator, database, selected.id);
        defer if (first_message) |value| allocator.free(value);
        try writeHistorySummary(&output.writer, selected, first_message);
        count += 1;
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn find(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) !?records.Session {
    if (!validSessionId(id)) return error.InvalidSessionId;
    try database.lock(io);
    defer database.unlock(io);
    if (try records.get(allocator, database, id)) |session| return session;
    return records.getByNative(allocator, database, id);
}

pub fn archivePayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidSessionMetadata;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidSessionMetadata;
    const archived_value = parsed.value.object.get("archived") orelse return error.SessionArchivedRequired;
    if (archived_value != .bool) return error.SessionArchivedRequired;
    var session = (try find(allocator, io, database, id)) orelse return error.SessionNotFound;
    defer session.deinit();
    try database.lock(io);
    defer database.unlock(io);
    try records.save(database, .{
        .id = session.id,
        .harness = session.harness,
        .harness_version = session.harness_version,
        .capabilities_json = session.capabilities_json,
        .node_id = session.node_id,
        .native_session_id = session.native_session_id,
        .project_id = session.project_id,
        .project_path = session.project_path,
        .model_id = session.model_id,
        .model_route_id = session.model_route_id,
        .status = if (archived_value.bool) "archived" else "idle",
        .event_cursor = session.event_cursor,
        .sharing_policy = session.sharing_policy,
        .automation_id = session.automation_id,
    });
    session_change.notify();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"session\":{\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.print(",\"archived\":{},\"archivedAt\":", .{archived_value.bool});
    if (archived_value.bool) try std.json.Stringify.value(session.updated_at, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll("}}");
    return output.toOwnedSlice();
}

pub fn transcriptResponse(allocator: std.mem.Allocator, session: *const records.Session, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidHarnessResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidHarnessResponse;
    const entries = parsed.value.object.get("entries") orelse return error.InvalidHarnessResponse;
    if (entries != .array) return error.InvalidHarnessResponse;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"events\":");
    try std.json.Stringify.value(entries, .{}, &output.writer);
    try output.writer.writeAll(",\"cursor\":null,\"meta\":{\"cwd\":");
    if (!std.mem.eql(u8, session.harness, "chat")) {
        if (session.project_path) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    } else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"modelId\":");
    if (session.model_id) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"modelRouteId\":");
    if (session.model_route_id) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"harness\":");
    try std.json.Stringify.value(session.harness, .{}, &output.writer);
    try output.writer.writeAll(",\"startedAt\":");
    try std.json.Stringify.value(session.created_at, .{}, &output.writer);
    try output.writer.writeAll(",\"piSessionId\":");
    if (session.native_session_id) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"usage\":null}}");
    return output.toOwnedSlice();
}

fn writeHistorySummary(writer: *Io.Writer, session: *const records.Session, first_message: ?[]const u8) !void {
    const archived = std.mem.eql(u8, session.status, "archived");
    const project_path = if (std.mem.eql(u8, session.harness, "chat")) "" else session.project_path orelse "";
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(session.id, .{}, writer);
    try writer.writeAll(",\"filename\":\"\",\"cwd\":");
    try std.json.Stringify.value(project_path, .{}, writer);
    try writer.writeAll(",\"startedAt\":");
    try std.json.Stringify.value(session.created_at, .{}, writer);
    try writer.writeAll(",\"updatedAt\":");
    try std.json.Stringify.value(session.updated_at, .{}, writer);
    try writer.writeAll(",\"modelId\":");
    if (session.model_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"modelRouteId\":");
    if (session.model_route_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"harness\":");
    try std.json.Stringify.value(session.harness, .{}, writer);
    try writer.writeAll(",\"provider\":null,\"firstUserMessage\":");
    if (first_message) |value| try std.json.Stringify.value(value, .{}, writer) else try std.json.Stringify.value(session.id, .{}, writer);
    try writer.print(",\"archived\":{},\"archivedAt\":", .{archived});
    if (archived) try std.json.Stringify.value(session.updated_at, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"parentSessionId\":null,\"subagentName\":null,\"projectId\":");
    try std.json.Stringify.value(session.project_id orelse "", .{}, writer);
    try writer.writeAll(",\"projectName\":");
    try std.json.Stringify.value(session.project_id orelse "", .{}, writer);
    try writer.writeAll(",\"projectPath\":");
    try std.json.Stringify.value(project_path, .{}, writer);
    try writer.writeByte('}');
}

fn firstUserMessage(allocator: std.mem.Allocator, database: *sqlite.Database, session_id: []const u8) !?[]u8 {
    var transcript = try records.transcript(allocator, database, session_id);
    defer transcript.deinit();
    for (transcript.records) |entry| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, entry.document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const event_type = optionalString(parsed.value.object, "type") orelse continue;
        if (!std.mem.eql(u8, event_type, "message")) continue;
        const message = parsed.value.object.get("message") orelse continue;
        if (message != .object or !std.mem.eql(u8, optionalString(message.object, "role") orelse "", "user")) continue;
        const content = message.object.get("content") orelse continue;
        if (content != .array) continue;
        for (content.array.items) |part| {
            if (part != .object) continue;
            const text = optionalString(part.object, "text") orelse continue;
            return @as(?[]u8, try allocator.dupe(u8, text));
        }
    }
    return null;
}

fn writeMetadata(writer: *Io.Writer, session: *const records.Session) !void {
    try writer.writeAll("{\"session_id\":");
    try std.json.Stringify.value(session.id, .{}, writer);
    try writer.writeAll(",\"pi_session_id\":");
    if (session.native_session_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"native_session_id\":");
    if (session.native_session_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"desktop_id\":");
    try std.json.Stringify.value(session.node_id, .{}, writer);
    try writer.writeAll(",\"desktop_name\":");
    try std.json.Stringify.value(session.node_id, .{}, writer);
    try writer.writeAll(",\"project_id\":");
    if (session.project_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"project_name\":null,\"project_path\":");
    if (!std.mem.eql(u8, session.harness, "chat")) {
        if (session.project_path) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    } else try writer.writeAll("null");
    try writer.writeAll(",\"title\":");
    try std.json.Stringify.value(session.id, .{}, writer);
    try writer.writeAll(",\"last_message_preview\":null,\"status\":");
    try std.json.Stringify.value(session.status, .{}, writer);
    try writer.writeAll(",\"model_id\":");
    if (session.model_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"started_at\":");
    try std.json.Stringify.value(session.created_at, .{}, writer);
    try writer.writeAll(",\"updated_at\":");
    try std.json.Stringify.value(session.updated_at, .{}, writer);
    try writer.writeAll(",\"attachment_count\":0,\"attachments\":[],\"usage\":null,\"harness\":");
    try std.json.Stringify.value(session.harness, .{}, writer);
    try writer.writeAll(",\"harness_version\":");
    if (session.harness_version) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"capabilities\":");
    try writer.writeAll(session.capabilities_json);
    try writer.writeAll(",\"sharing_policy\":");
    try std.json.Stringify.value(session.sharing_policy, .{}, writer);
    try writer.print(",\"event_cursor\":{d},\"automation_id\":", .{session.event_cursor});
    if (session.automation_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeByte('}');
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
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

fn validSessionId(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '_' and byte != '-' and byte != '.' and byte != ':') return false;
    return true;
}
