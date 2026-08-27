const std = @import("std");
const config = @import("../../app/config.zig");
const agent_control = @import("../sessions/control_store.zig");
const repository = @import("store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const agent_coordinator = @import("../sessions/coordinator.zig");
const agent_run_completion = @import("../sessions/run_completion.zig");
const harness_runtime = @import("../harness/runtime.zig");

const Io = std.Io;
const http = std.http;

pub fn listPayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, parent_id: []const u8) ![]u8 {
    try validateId(parent_id);
    try database.lock(io);
    defer database.unlock(io);
    var runs = try repository.list(allocator, database, parent_id);
    defer runs.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"subagents\":[");
    for (runs.records, 0..) |*run, index| {
        if (index > 0) try output.writer.writeByte(',');
        try writeRun(&output.writer, run, false);
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn getPayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, parent_id: []const u8, run_id: []const u8) ![]u8 {
    try validateId(parent_id);
    try validateRunId(run_id);
    var run = (try lockedGet(allocator, io, database, parent_id, run_id)) orelse return error.SubagentNotFound;
    defer run.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"subagent\":");
    try writeRun(&output.writer, &run, true);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

pub fn runPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, harness: *harness_runtime.Manager, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidSubagentPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidSubagentPayload;
    const object = parsed.value.object;
    const parent_id = requiredString(object, "parentPiSessionId") orelse return error.ParentSessionIdRequired;
    const task = requiredString(object, "task") orelse return error.SubagentTaskRequired;
    if (task.len > 256 * 1024) return error.SubagentTaskTooLarge;
    try validateId(parent_id);
    var parent = try lockedParent(allocator, io, database, parent_id) orelse return error.ParentSessionNotFound;
    defer parent.deinit();
    if (std.mem.startsWith(u8, parent.id, "subagent:") or try lockedIsChild(io, database, parent_id)) return error.SubagentNestingDenied;
    if (try lockedRunningCount(io, database, parent_id) >= 4) return error.TooManySubagents;
    const model_id = requiredString(object, "modelId") orelse parent.model_id orelse return error.ModelIdRequired;
    const model_route_id = requiredString(object, "modelRouteId") orelse parent.model_route_id orelse model_id;
    const cwd = parent.project_path orelse return error.SubagentCwdRequired;
    const name_value = optionalString(object, "name");
    var random: [4]u8 = undefined;
    io.random(&random);
    const run_id_buffer = std.fmt.bytesToHex(random, .lower);
    const run_id = run_id_buffer[0..];
    const name = name_value orelse nickname(try lockedSiblingCount(allocator, io, database, parent_id));
    if (name.len > 128) return error.InvalidSubagentName;
    const runtime_id = try std.fmt.allocPrint(allocator, "subagent:{s}:{s}", .{ parent_id, run_id });
    defer allocator.free(runtime_id);
    var started_buffer: [24]u8 = undefined;
    const started_at = timestamp(io, &started_buffer);
    try lockedCreate(io, database, run_id, parent_id, name, task, runtime_id, cwd, started_at);
    const prompt = try taskPrompt(allocator, name, task);
    defer allocator.free(prompt);
    const turn = try turnDocument(allocator, runtime_id, parent.harness, parent.node_id, parent.project_id, model_id, model_route_id, cwd, prompt);
    defer allocator.free(turn);
    const accepted = agent_coordinator.turnPayload(allocator, io, mode, client, database, harness, turn) catch |failure| {
        try settleFailure(io, database, parent_id, run_id, null, "", @errorName(failure));
        return failure;
    };
    const cursor = agent_run_completion.acceptedEventCursor(allocator, accepted);
    allocator.free(accepted);
    var child = try lockedSession(allocator, io, database, runtime_id);
    defer if (child) |*value| value.deinit();
    if (child) |value| if (value.native_session_id) |native_id| try lockedAdopt(io, database, parent_id, run_id, native_id);
    var result = agent_run_completion.wait(allocator, io, mode, client, database, harness, runtime_id, cursor, 8000) catch |failure| {
        try settleFailure(io, database, parent_id, run_id, if (child) |value| value.native_session_id else null, "", @errorName(failure));
        return failure;
    };
    defer result.deinit();
    var finished_buffer: [24]u8 = undefined;
    const finished_at = timestamp(io, &finished_buffer);
    const did_finish = try lockedFinish(io, database, parent_id, run_id, if (result.failure == null) "done" else "error", finished_at, result.native_session, result.summary, result.failure);
    if (!did_finish) return stoppedResponse(allocator, io, database, parent_id, run_id);
    if (result.failure) |_| return error.SubagentRunFailed;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"piSessionId\":");
    if (result.native_session) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"result\":");
    try std.json.Stringify.value(if (result.summary.len > 0) result.summary else "(the subagent produced no final text)", .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

pub fn stopPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, harness: *harness_runtime.Manager, run_id: []const u8, document: []const u8) ![]u8 {
    try validateRunId(run_id);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidSubagentPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidSubagentPayload;
    const parent_id = requiredString(parsed.value.object, "piSessionId") orelse return error.ParentSessionIdRequired;
    try validateId(parent_id);
    var run = (try lockedGet(allocator, io, database, parent_id, run_id)) orelse return error.SubagentNotFound;
    defer run.deinit();
    if (std.mem.eql(u8, run.status, "running")) {
        var finished_buffer: [24]u8 = undefined;
        _ = try lockedFinish(io, database, parent_id, run_id, "cancelled", timestamp(io, &finished_buffer), run.native_session_id, run.report, null);
        const abort_document = try std.fmt.allocPrint(allocator, "{{\"sessionId\":\"{s}\"}}", .{run.runtime_session_id});
        defer allocator.free(abort_document);
        const response = agent_coordinator.controlPayload(allocator, io, mode, client, database, harness, "abort", abort_document) catch null;
        if (response) |value| allocator.free(value);
    }
    return getPayload(allocator, io, database, parent_id, run_id);
}

fn stoppedResponse(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, parent_id: []const u8, run_id: []const u8) ![]u8 {
    var run = (try lockedGet(allocator, io, database, parent_id, run_id)) orelse return error.SubagentNotFound;
    defer run.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"piSessionId\":");
    if (run.native_session_id) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"result\":");
    const report = if (run.report.len > 0) try std.fmt.allocPrint(allocator, "Subagent \"{s}\" was stopped before it reported.\n\nPartial work so far:\n{s}", .{ run.name, run.report }) else try std.fmt.allocPrint(allocator, "Subagent \"{s}\" was stopped before it reported.", .{run.name});
    defer allocator.free(report);
    try std.json.Stringify.value(report, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn writeRun(writer: *Io.Writer, run: *const repository.Run, include_report: bool) !void {
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(run.id, .{}, writer);
    try writer.writeAll(",\"name\":");
    try std.json.Stringify.value(run.name, .{}, writer);
    try writer.writeAll(",\"task\":");
    try std.json.Stringify.value(run.task, .{}, writer);
    try writer.writeAll(",\"status\":");
    try std.json.Stringify.value(run.status, .{}, writer);
    try writer.print(",\"active\":{},\"piSessionId\":", .{std.mem.eql(u8, run.status, "running")});
    if (run.native_session_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"startedAt\":");
    try std.json.Stringify.value(run.started_at, .{}, writer);
    try writer.writeAll(",\"finishedAt\":");
    if (run.finished_at) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"error\":");
    if (run.failure) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    if (include_report) {
        try writer.writeAll(",\"report\":");
        try std.json.Stringify.value(run.report, .{}, writer);
    }
    try writer.writeByte('}');
}

fn taskPrompt(allocator: std.mem.Allocator, name: []const u8, task: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "You are \"{s}\", a subagent completing one task for a parent agent session.\nWork independently with the tools you have. When finished, end with a clear,\nself-contained final report — it is the only thing the parent will see.\n\n{s}", .{ name, task });
}

fn turnDocument(allocator: std.mem.Allocator, session_id: []const u8, harness: []const u8, node_id: []const u8, project_id: ?[]const u8, model_id: []const u8, model_route_id: []const u8, cwd: []const u8, message: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"sessionId\":");
    try std.json.Stringify.value(session_id, .{}, &output.writer);
    for ([_]struct { name: []const u8, value: []const u8 }{ .{ .name = "harness", .value = harness }, .{ .name = "nodeId", .value = node_id }, .{ .name = "modelId", .value = model_id }, .{ .name = "cwd", .value = cwd }, .{ .name = "message", .value = message } }) |field| {
        try output.writer.writeByte(',');
        try std.json.Stringify.value(field.name, .{}, &output.writer);
        try output.writer.writeByte(':');
        try std.json.Stringify.value(field.value, .{}, &output.writer);
    }
    try output.writer.writeAll(",\"modelRouteId\":");
    try std.json.Stringify.value(model_route_id, .{}, &output.writer);
    try output.writer.writeAll(",\"projectId\":");
    if (project_id) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"toolAccess\":\"full\",\"mode\":\"prompt\"}");
    return output.toOwnedSlice();
}

fn nickname(index: usize) []const u8 {
    const names = [_][]const u8{ "Euclid", "Archimedes", "Hypatia", "Ptolemy", "Leibniz", "Lovelace", "Boole", "Turing", "Hopper", "Noether", "Curie", "Gauss", "Euler", "Ramanujan", "Erdos", "Franklin", "Kepler", "Darwin", "Fermi", "Bohr" };
    return names[index % names.len];
}

fn validateId(value: []const u8) !void {
    if (value.len == 0 or value.len > 128) return error.InvalidSessionId;
    for (value) |character| if (!std.ascii.isAlphanumeric(character) and character != '-' and character != '_' and character != ':' and character != '.') return error.InvalidSessionId;
}

fn validateRunId(value: []const u8) !void {
    if (value.len != 8) return error.InvalidSubagentRunId;
    for (value) |character| if (!std.ascii.isHex(character)) return error.InvalidSubagentRunId;
}

fn requiredString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    return optionalString(object, name);
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn lockedParent(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) !?agent_control.Session {
    try database.lock(io);
    defer database.unlock(io);
    return agent_control.getByNative(allocator, database, id);
}

fn lockedSession(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) !?agent_control.Session {
    try database.lock(io);
    defer database.unlock(io);
    return agent_control.get(allocator, database, id);
}

fn lockedGet(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, parent: []const u8, id: []const u8) !?repository.Run {
    try database.lock(io);
    defer database.unlock(io);
    return repository.get(allocator, database, parent, id);
}

fn lockedIsChild(io: Io, database: *sqlite.Database, id: []const u8) !bool {
    try database.lock(io);
    defer database.unlock(io);
    return repository.isChild(database, id);
}

fn lockedRunningCount(io: Io, database: *sqlite.Database, id: []const u8) !u64 {
    try database.lock(io);
    defer database.unlock(io);
    return repository.runningCount(database, id);
}

fn lockedSiblingCount(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) !usize {
    try database.lock(io);
    defer database.unlock(io);
    var runs = try repository.list(allocator, database, id);
    defer runs.deinit();
    return runs.records.len;
}

fn lockedCreate(io: Io, database: *sqlite.Database, run_id: []const u8, parent: []const u8, name: []const u8, task: []const u8, runtime: []const u8, cwd: []const u8, started: []const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    try repository.create(database, run_id, parent, name, task, runtime, cwd, started);
}

fn lockedAdopt(io: Io, database: *sqlite.Database, parent: []const u8, id: []const u8, native: []const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    try repository.adopt(database, parent, id, native);
}

fn lockedFinish(io: Io, database: *sqlite.Database, parent: []const u8, id: []const u8, status: []const u8, finished: []const u8, native: ?[]const u8, report: []const u8, failure: ?[]const u8) !bool {
    try database.lock(io);
    defer database.unlock(io);
    return repository.finish(database, parent, id, status, finished, native, report, failure);
}

fn settleFailure(io: Io, database: *sqlite.Database, parent: []const u8, id: []const u8, native: ?[]const u8, report: []const u8, failure: []const u8) !void {
    var buffer: [24]u8 = undefined;
    _ = try lockedFinish(io, database, parent, id, "error", timestamp(io, &buffer), native, report, failure);
}

fn timestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = @max(Io.Clock.real.now(io).toSeconds(), 0);
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(seconds) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{
        year_day.year, month_day.month.numeric(), month_day.day_index + 1,
        day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute(),
    }) catch unreachable;
}
