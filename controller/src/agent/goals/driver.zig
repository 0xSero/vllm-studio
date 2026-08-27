const std = @import("std");
const records = @import("../sessions/control_store.zig");
const repository = @import("store.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;

pub fn decorateTurn(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return allocator.dupe(u8, document);
    defer parsed.deinit();
    if (parsed.value != .object) return allocator.dupe(u8, document);
    const native_id = stringField(parsed.value.object, "nativeSessionId") orelse stringField(parsed.value.object, "piSessionId") orelse return allocator.dupe(u8, document);
    const message = stringField(parsed.value.object, "message") orelse return allocator.dupe(u8, document);
    if (std.mem.indexOf(u8, message, "<goal_continuation>") != null or std.mem.indexOf(u8, message, "<local_studio_goal>") != null) return allocator.dupe(u8, document);
    try database.lock(io);
    const stored = repository.get(allocator, database, native_id) catch |failure| {
        database.unlock(io);
        return failure;
    };
    database.unlock(io);
    defer if (stored) |value| allocator.free(value);
    const goal_document = stored orelse return allocator.dupe(u8, document);
    var goal = std.json.parseFromSlice(std.json.Value, allocator, goal_document, .{}) catch return allocator.dupe(u8, document);
    defer goal.deinit();
    if (goal.value != .object or !std.mem.eql(u8, stringField(goal.value.object, "status") orelse "", "active")) return allocator.dupe(u8, document);
    const objective = stringField(goal.value.object, "objective") orelse return allocator.dupe(u8, document);
    const decorated = try std.fmt.allocPrint(allocator, "{s}\n\n<local_studio_goal>\nActive objective: {s}\nContinue working until the objective is achieved. Check concrete evidence before deciding. End a completed turn with GOAL_COMPLETE. If no further progress is possible, end with GOAL_BLOCKED and the reason.\n</local_studio_goal>", .{ message, objective });
    defer allocator.free(decorated);
    try parsed.value.object.put(parsed.arena.allocator(), "message", .{ .string = try parsed.arena.allocator().dupe(u8, decorated) });
    return serialize(allocator, parsed.value);
}

pub fn pauseForAbort(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, session: *const records.Session) !void {
    const native_id = session.native_session_id orelse return;
    try database.lock(io);
    defer database.unlock(io);
    const stored = try repository.get(allocator, database, native_id) orelse return;
    defer allocator.free(stored);
    var goal = std.json.parseFromSlice(std.json.Value, allocator, stored, .{}) catch return;
    defer goal.deinit();
    if (goal.value != .object or !std.mem.eql(u8, stringField(goal.value.object, "status") orelse "", "active")) return;
    try goal.value.object.put(goal.arena.allocator(), "status", .{ .string = "paused" });
    try goal.value.object.put(goal.arena.allocator(), "activeRunStartedAt", .null);
    try updateTimestamp(io, &goal);
    const updated = try serialize(allocator, goal.value);
    defer allocator.free(updated);
    try repository.save(database, native_id, updated);
}

pub fn reconcile(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, session: *const records.Session, payload: []const u8) !?[]u8 {
    const native_id = session.native_session_id orelse return null;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, payload, .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .object) return null;
    const events = parsed.value.object.get("events") orelse return null;
    if (events != .array or events.array.items.len == 0) return null;
    try database.lock(io);
    defer database.unlock(io);
    const stored = try repository.get(allocator, database, native_id) orelse return null;
    defer allocator.free(stored);
    var goal = std.json.parseFromSlice(std.json.Value, allocator, stored, .{}) catch return null;
    defer goal.deinit();
    if (goal.value != .object) return null;
    var driver = try repository.driver(allocator, database, session.id);
    defer driver.deinit();
    var settled = false;
    for (events.array.items) |wrapper| {
        if (wrapper != .object) continue;
        const native = wrapper.object.get("event") orelse continue;
        if (native != .object) continue;
        const event_type = stringField(native.object, "type") orelse continue;
        if (std.mem.eql(u8, event_type, "agent_start")) {
            driver.saw_tool = false;
            allocator.free(driver.assistant_text);
            driver.assistant_text = try allocator.dupe(u8, "");
            driver.run_started_at = Io.Clock.real.now(io).toSeconds();
            continue;
        }
        if (std.mem.indexOf(u8, event_type, "tool") != null) driver.saw_tool = true;
        if (std.mem.eql(u8, event_type, "message") or std.mem.eql(u8, event_type, "message_end")) try appendAssistant(allocator, &driver, native.object);
        if (std.mem.eql(u8, event_type, "agent_settled")) settled = true;
    }
    if (!settled) {
        try repository.saveDriver(database, session.id, &driver);
        return null;
    }
    const status = stringField(goal.value.object, "status") orelse "active";
    if (!std.mem.eql(u8, status, "active")) {
        try resetDriver(allocator, &driver);
        try repository.saveDriver(database, session.id, &driver);
        return null;
    }
    const now_seconds = Io.Clock.real.now(io).toSeconds();
    const elapsed: i64 = if (driver.run_started_at) |start| @max(now_seconds - start, 0) else 0;
    const used = numberField(goal.value.object, "timeUsedSeconds") + @as(f64, @floatFromInt(elapsed));
    try goal.value.object.put(goal.arena.allocator(), "timeUsedSeconds", .{ .float = used });
    try goal.value.object.put(goal.arena.allocator(), "activeRunStartedAt", .null);
    const outcome = goalOutcome(driver.assistant_text);
    var continue_goal = false;
    if (outcome) |value| {
        try goal.value.object.put(goal.arena.allocator(), "status", .{ .string = value });
    } else {
        const turns = integerField(goal.value.object, "turnsUsed") + 1;
        try goal.value.object.put(goal.arena.allocator(), "turnsUsed", .{ .integer = turns });
        const budget = nullableInteger(goal.value.object, "turnBudget");
        if (budget != null and turns >= budget.?) {
            try goal.value.object.put(goal.arena.allocator(), "status", .{ .string = "budget_limited" });
        } else if (driver.was_continuation and !driver.saw_tool) {
            try goal.value.object.put(goal.arena.allocator(), "status", .{ .string = "paused" });
        } else continue_goal = true;
    }
    try updateTimestamp(io, &goal);
    const updated = try serialize(allocator, goal.value);
    defer allocator.free(updated);
    try repository.save(database, native_id, updated);
    try resetDriver(allocator, &driver);
    driver.was_continuation = continue_goal;
    try repository.saveDriver(database, session.id, &driver);
    if (!continue_goal) return null;
    const objective = stringField(goal.value.object, "objective") orelse return null;
    return @as(?[]u8, try continuationDocument(allocator, session, objective));
}

fn appendAssistant(allocator: std.mem.Allocator, driver: *repository.Driver, event: std.json.ObjectMap) !void {
    const message = event.get("message") orelse return;
    if (message != .object or !std.mem.eql(u8, stringField(message.object, "role") orelse "", "assistant")) return;
    const content = message.object.get("content") orelse return;
    var addition: Io.Writer.Allocating = .init(allocator);
    defer addition.deinit();
    if (content == .string) try addition.writer.writeAll(content.string) else if (content == .array) for (content.array.items) |block| {
        if (block == .object and std.mem.eql(u8, stringField(block.object, "type") orelse "", "text")) if (stringField(block.object, "text")) |text| try addition.writer.writeAll(text);
    };
    if (addition.writer.buffered().len == 0) return;
    const combined = try std.fmt.allocPrint(allocator, "{s}{s}", .{ driver.assistant_text, addition.writer.buffered() });
    allocator.free(driver.assistant_text);
    driver.assistant_text = combined;
}

fn continuationDocument(allocator: std.mem.Allocator, session: *const records.Session, objective: []const u8) ![]u8 {
    const model_id = session.model_id orelse return error.ModelIdRequired;
    const cwd = session.project_path orelse return error.ProjectPathRequired;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"sessionId\":");
    try std.json.Stringify.value(session.id, .{}, &output.writer);
    for ([_]struct { name: []const u8, value: []const u8 }{ .{ .name = "harness", .value = session.harness }, .{ .name = "nodeId", .value = session.node_id }, .{ .name = "modelId", .value = model_id }, .{ .name = "cwd", .value = cwd } }) |field| {
        try output.writer.writeByte(',');
        try std.json.Stringify.value(field.name, .{}, &output.writer);
        try output.writer.writeByte(':');
        try std.json.Stringify.value(field.value, .{}, &output.writer);
    }
    try output.writer.writeAll(",\"modelRouteId\":");
    try std.json.Stringify.value(session.model_route_id orelse model_id, .{}, &output.writer);
    try output.writer.writeAll(",\"nativeSessionId\":");
    if (session.native_session_id) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"message\":");
    const prompt = try std.fmt.allocPrint(allocator, "<goal_continuation>\nContinue working toward the goal: {s}\nCheck progress against concrete evidence before deciding what to do next. If fully achieved, end with GOAL_COMPLETE. If no further progress is possible, end with GOAL_BLOCKED and the reason.\n</goal_continuation>", .{objective});
    defer allocator.free(prompt);
    try std.json.Stringify.value(prompt, .{}, &output.writer);
    try output.writer.writeAll(",\"toolAccess\":\"full\",\"mode\":\"prompt\"}");
    return output.toOwnedSlice();
}

fn resetDriver(allocator: std.mem.Allocator, driver: *repository.Driver) !void {
    driver.saw_tool = false;
    allocator.free(driver.assistant_text);
    driver.assistant_text = try allocator.dupe(u8, "");
    driver.was_continuation = false;
    driver.run_started_at = null;
}

fn goalOutcome(text: []const u8) ?[]const u8 {
    if (std.mem.indexOf(u8, text, "GOAL_COMPLETE") != null) return "complete";
    if (std.mem.indexOf(u8, text, "GOAL_BLOCKED") != null) return "blocked";
    return null;
}

fn updateTimestamp(io: Io, parsed: *std.json.Parsed(std.json.Value)) !void {
    var buffer: [24]u8 = undefined;
    try parsed.value.object.put(parsed.arena.allocator(), "updatedAt", .{ .string = try parsed.arena.allocator().dupe(u8, timestamp(io, &buffer)) });
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn integerField(object: std.json.ObjectMap, name: []const u8) i64 {
    const value = object.get(name) orelse return 0;
    return if (value == .integer) @max(value.integer, 0) else 0;
}

fn nullableInteger(object: std.json.ObjectMap, name: []const u8) ?i64 {
    const value = object.get(name) orelse return null;
    return if (value == .integer and value.integer > 0) value.integer else null;
}

fn numberField(object: std.json.ObjectMap, name: []const u8) f64 {
    const value = object.get(name) orelse return 0;
    return switch (value) { .integer => |number| @floatFromInt(number), .float => |number| number, else => 0 };
}

fn serialize(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn timestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = @max(Io.Clock.real.now(io).toSeconds(), 0);
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(seconds) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{ year_day.year, month_day.month.numeric(), month_day.day_index + 1, day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute() }) catch unreachable;
}
