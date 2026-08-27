const std = @import("std");
const limits = @import("../../agent/runtime/limits.zig");
const protocol = @import("../protocol.zig");

const Tool = struct {
    output_index: i64,
    id: []u8,
    name: []u8,
    arguments: std.ArrayList(u8) = .empty,

    fn deinit(tool: *Tool, allocator: std.mem.Allocator) void {
        allocator.free(tool.id);
        allocator.free(tool.name);
        tool.arguments.deinit(allocator);
        tool.* = undefined;
    }
};

pub const Reducer = struct {
    content: std.ArrayList(u8) = .empty,
    provider_state: std.Io.Writer.Allocating,
    provider_state_count: usize = 0,
    tools: std.ArrayList(Tool) = .empty,
    terminal_seen: bool = false,
    saw_content_delta: bool = false,
    event_count: usize = 0,
    aggregate_bytes: usize = 0,

    pub fn init(allocator: std.mem.Allocator) Reducer {
        return .{ .provider_state = .init(allocator) };
    }

    pub fn deinit(reducer: *Reducer, allocator: std.mem.Allocator) void {
        reducer.content.deinit(allocator);
        reducer.provider_state.deinit();
        for (reducer.tools.items) |*tool| tool.deinit(allocator);
        reducer.tools.deinit(allocator);
        reducer.* = undefined;
    }

    pub fn apply(reducer: *Reducer, allocator: std.mem.Allocator, document: []const u8, request: protocol.Request) !bool {
        if (request.cancel_flag.load(.seq_cst)) return error.Cancelled;
        reducer.event_count = try limits.checkedAdd(reducer.event_count, 1, limits.chat.stream_events);
        reducer.aggregate_bytes = try limits.checkedAdd(reducer.aggregate_bytes, document.len, limits.chat.stream_bytes);
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidEvent;
        defer parsed.deinit();
        if (parsed.value != .object) return false;
        const event_type = stringField(parsed.value.object, "type") orelse return false;
        if (std.mem.eql(u8, event_type, "response.output_item.added")) {
            const output_index = integerField(parsed.value.object, "output_index") orelse return false;
            const item = parsed.value.object.get("item") orelse return false;
            if (item != .object or !std.mem.eql(u8, stringField(item.object, "type") orelse "", "function_call")) return false;
            const id = stringField(item.object, "call_id") orelse return false;
            const name = stringField(item.object, "name") orelse return false;
            if (findTool(reducer.tools.items, output_index) == null) {
                try reducer.appendTool(allocator, output_index, id, name);
                request.events.emit(.{ .tool_started = .{ .id = id, .name = name } });
            }
        } else if (std.mem.eql(u8, event_type, "response.output_text.delta") or std.mem.eql(u8, event_type, "response.refusal.delta")) {
            const delta = stringField(parsed.value.object, "delta") orelse return false;
            reducer.saw_content_delta = true;
            request.events.emit(.{ .content_delta = delta });
            try reducer.appendContent(allocator, delta);
        } else if (std.mem.eql(u8, event_type, "response.reasoning_summary_text.delta") or std.mem.eql(u8, event_type, "response.reasoning_text.delta")) {
            if (stringField(parsed.value.object, "delta")) |delta| request.events.emit(.{ .reasoning_delta = delta });
        } else if (std.mem.eql(u8, event_type, "response.reasoning_summary_part.done")) {
            request.events.emit(.{ .reasoning_delta = "\n\n" });
        } else if (std.mem.eql(u8, event_type, "response.function_call_arguments.delta")) {
            const output_index = integerField(parsed.value.object, "output_index") orelse return false;
            const delta = stringField(parsed.value.object, "delta") orelse return false;
            const index = findTool(reducer.tools.items, output_index) orelse return false;
            try appendArguments(allocator, &reducer.tools.items[index].arguments, delta);
            request.events.emit(.{ .tool_input_delta = delta });
        } else if (std.mem.eql(u8, event_type, "response.function_call_arguments.done")) {
            const output_index = integerField(parsed.value.object, "output_index") orelse return false;
            const arguments = stringField(parsed.value.object, "arguments") orelse return false;
            const index = findTool(reducer.tools.items, output_index) orelse return false;
            const current = reducer.tools.items[index].arguments.items;
            if (std.mem.startsWith(u8, arguments, current)) {
                try appendArguments(allocator, &reducer.tools.items[index].arguments, arguments[current.len..]);
            } else {
                reducer.tools.items[index].arguments.clearRetainingCapacity();
                try appendArguments(allocator, &reducer.tools.items[index].arguments, arguments);
            }
        } else if (std.mem.eql(u8, event_type, "response.output_item.done")) {
            try reducer.finishItem(allocator, parsed.value.object, request.events);
        } else if (std.mem.eql(u8, event_type, "response.completed") or std.mem.eql(u8, event_type, "response.done") or std.mem.eql(u8, event_type, "response.incomplete")) {
            reducer.terminal_seen = true;
            return true;
        } else if (std.mem.eql(u8, event_type, "response.failed") or std.mem.eql(u8, event_type, "error")) {
            return error.ResponseFailed;
        }
        return false;
    }

    pub fn finish(reducer: *Reducer, allocator: std.mem.Allocator, cancel_flag: *std.atomic.Value(bool)) !protocol.Completion {
        if (cancel_flag.load(.seq_cst)) return error.Cancelled;
        if (!reducer.terminal_seen) return error.StreamIncomplete;
        const content = if (reducer.content.items.len > 0) try reducer.content.toOwnedSlice(allocator) else null;
        if (content != null) reducer.content = .empty;
        errdefer if (content) |value| allocator.free(value);
        const state = if (reducer.provider_state_count > 0) state: {
            try reducer.provider_state.writer.writeByte(']');
            break :state try reducer.provider_state.toOwnedSlice();
        } else null;
        errdefer if (state) |value| allocator.free(value);
        const calls: []protocol.ToolCall = if (reducer.tools.items.len > 0) try allocator.alloc(protocol.ToolCall, reducer.tools.items.len) else &.{};
        errdefer if (calls.len > 0) allocator.free(calls);
        var initialized: usize = 0;
        errdefer for (calls[0..initialized]) |call| {
            allocator.free(@constCast(call.id));
            allocator.free(@constCast(call.name));
            allocator.free(@constCast(call.arguments_json));
        };
        for (reducer.tools.items, 0..) |*tool, index| {
            const arguments = if (tool.arguments.items.len > 0) try tool.arguments.toOwnedSlice(allocator) else try allocator.dupe(u8, "{}");
            tool.arguments = .empty;
            calls[index] = .{ .id = tool.id, .name = tool.name, .arguments_json = arguments, .argument_integrity = protocol.ToolArgumentIntegrity.classify(allocator, arguments) };
            tool.id = &.{};
            tool.name = &.{};
            initialized += 1;
        }
        return .{ .content = content, .tool_calls = calls, .provider_state_json = state };
    }

    fn appendTool(reducer: *Reducer, allocator: std.mem.Allocator, output_index: i64, id: []const u8, name: []const u8) !void {
        if (reducer.tools.items.len >= limits.chat.tool_calls or id.len == 0 or id.len > limits.chat.tool_identity_bytes or name.len == 0 or name.len > limits.chat.tool_identity_bytes) return error.ToolCallLimitExceeded;
        const owned_id = try allocator.dupe(u8, id);
        errdefer allocator.free(owned_id);
        const owned_name = try allocator.dupe(u8, name);
        errdefer allocator.free(owned_name);
        try reducer.tools.append(allocator, .{ .output_index = output_index, .id = owned_id, .name = owned_name });
    }

    fn appendContent(reducer: *Reducer, allocator: std.mem.Allocator, delta: []const u8) !void {
        const remaining = limits.chat.stream_bytes -| @min(limits.chat.stream_bytes, reducer.content.items.len);
        try reducer.content.appendSlice(allocator, delta[0..@min(delta.len, remaining)]);
    }

    fn finishItem(reducer: *Reducer, allocator: std.mem.Allocator, event: std.json.ObjectMap, sink: protocol.EventSink) !void {
        const output_index = integerField(event, "output_index") orelse return;
        const item = event.get("item") orelse return;
        if (item != .object) return;
        const item_type = stringField(item.object, "type") orelse return;
        if (std.mem.eql(u8, item_type, "function_call")) {
            if (findTool(reducer.tools.items, output_index)) |index| if (reducer.tools.items[index].arguments.items.len == 0) if (stringField(item.object, "arguments")) |arguments| try appendArguments(allocator, &reducer.tools.items[index].arguments, arguments);
        } else if (std.mem.eql(u8, item_type, "reasoning")) {
            if (stringField(item.object, "encrypted_content") == null) return;
            var encoded: std.Io.Writer.Allocating = .init(allocator);
            defer encoded.deinit();
            try std.json.Stringify.value(item, .{}, &encoded.writer);
            const separators: usize = if (reducer.provider_state_count == 0) 2 else 1;
            _ = try limits.checkedAdd(reducer.provider_state.written().len, try limits.checkedAdd(encoded.written().len, separators, limits.chat.provider_state_bytes), limits.chat.provider_state_bytes);
            if (reducer.provider_state_count == 0) try reducer.provider_state.writer.writeByte('[') else try reducer.provider_state.writer.writeByte(',');
            try reducer.provider_state.writer.writeAll(encoded.written());
            reducer.provider_state_count += 1;
        } else if (std.mem.eql(u8, item_type, "message") and !reducer.saw_content_delta) {
            const parts = item.object.get("content") orelse return;
            if (parts != .array) return;
            for (parts.array.items) |part| {
                if (part != .object) continue;
                const text = stringField(part.object, "text") orelse stringField(part.object, "refusal") orelse continue;
                sink.emit(.{ .content_delta = text });
                try reducer.appendContent(allocator, text);
            }
        }
    }
};

fn appendArguments(allocator: std.mem.Allocator, arguments: *std.ArrayList(u8), delta: []const u8) !void {
    _ = limits.checkedAdd(arguments.items.len, delta.len, limits.chat.tool_arguments_bytes) catch return error.ToolArgumentsTooLarge;
    try arguments.appendSlice(allocator, delta);
}

fn findTool(tools: []const Tool, output_index: i64) ?usize {
    for (tools, 0..) |tool, index| if (tool.output_index == output_index) return index;
    return null;
}

fn stringField(object: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = object.get(key) orelse return null;
    return if (value == .string) value.string else null;
}

fn integerField(object: std.json.ObjectMap, key: []const u8) ?i64 {
    const value = object.get(key) orelse return null;
    return if (value == .integer) value.integer else null;
}
