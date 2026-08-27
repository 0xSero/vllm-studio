const std = @import("std");
const protocol = @import("../protocol.zig");

pub const Sink = struct {
    context: *anyopaque,
    emit_fn: *const fn (*anyopaque, []const u8) anyerror!void,

    pub fn emit(sink: Sink, document: []const u8) !void {
        try sink.emit_fn(sink.context, document);
    }
};

pub const Output = struct {
    allocator: std.mem.Allocator,
    sink: Sink,
    content: std.ArrayList(u8) = .empty,
    failed: bool = false,

    pub fn deinit(output: *Output) void {
        output.content.deinit(output.allocator);
    }

    pub fn emitModel(raw: *anyopaque, event: protocol.Event) void {
        const output: *Output = @ptrCast(@alignCast(raw));
        switch (event) {
            .content_delta => |chunk| {
                output.content.appendSlice(output.allocator, chunk) catch {
                    output.failed = true;
                    return;
                };
                output.writeDelta("text_delta", chunk) catch {
                    output.failed = true;
                };
            },
            .reasoning_delta => |chunk| output.writeDelta("thinking_delta", chunk) catch {
                output.failed = true;
            },
            else => {},
        }
    }

    pub fn writeDelta(output: *Output, event_type: []const u8, chunk: []const u8) !void {
        var document: std.Io.Writer.Allocating = .init(output.allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":");
        try std.json.Stringify.value(event_type, .{}, &document.writer);
        try document.writer.writeAll(",\"delta\":");
        try std.json.Stringify.value(chunk, .{}, &document.writer);
        try document.writer.writeAll("}}");
        try output.sink.emit(document.writer.buffered());
    }

    pub fn writeMessage(output: *Output, text: []const u8) !void {
        var document: std.Io.Writer.Allocating = .init(output.allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":");
        try std.json.Stringify.value(text, .{}, &document.writer);
        try document.writer.writeAll("}]}}");
        try output.sink.emit(document.writer.buffered());
    }

    pub fn writeOutboundAction(output: *Output, action: []const u8) !void {
        var document: std.Io.Writer.Allocating = .init(output.allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"content\":[],\"outboundAction\":");
        try std.json.Stringify.value(action, .{}, &document.writer);
        try document.writer.writeAll("}}");
        try output.sink.emit(document.writer.buffered());
    }

    pub fn writeToolCall(output: *Output, call: protocol.ToolCall) !void {
        var document: std.Io.Writer.Allocating = .init(output.allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":\"toolcall_end\",\"toolCall\":{\"id\":");
        try std.json.Stringify.value(call.id, .{}, &document.writer);
        try document.writer.writeAll(",\"name\":");
        try std.json.Stringify.value(call.name, .{}, &document.writer);
        try document.writer.writeAll(",\"arguments\":");
        try document.writer.writeAll(call.arguments_json);
        try document.writer.writeAll("}}}");
        try output.sink.emit(document.writer.buffered());
    }

    pub fn writeToolResult(output: *Output, call_id: []const u8, text: []const u8, is_error: bool) !void {
        var document: std.Io.Writer.Allocating = .init(output.allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"type\":\"tool_execution_end\",\"toolCallId\":");
        try std.json.Stringify.value(call_id, .{}, &document.writer);
        try document.writer.print(",\"isError\":{},\"result\":{{\"content\":[{{\"type\":\"text\",\"text\":", .{is_error});
        try std.json.Stringify.value(text, .{}, &document.writer);
        try document.writer.writeAll("}]}}");
        try output.sink.emit(document.writer.buffered());
    }
};

pub fn writeError(sink: Sink, message: []const u8) !void {
    var buffer: [2048]u8 = undefined;
    var writer = std.Io.Writer.fixed(&buffer);
    try writer.writeAll("{\"type\":\"extension_error\",\"message\":");
    try std.json.Stringify.value(message, .{}, &writer);
    try writer.writeByte('}');
    try sink.emit(writer.buffered());
    try sink.emit("{\"type\":\"agent_settled\"}");
}
