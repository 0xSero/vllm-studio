const std = @import("std");
const limits = @import("../../agent/runtime/limits.zig");
const protocol = @import("../protocol.zig");

pub fn encode(allocator: std.mem.Allocator, request: protocol.Request) ![]u8 {
    if (request.model.len == 0 or request.model.len > limits.chat.model_bytes) return error.InvalidModel;
    for (request.model) |byte| if (byte <= 0x20 or byte == 0x7f) return error.InvalidModel;
    var instructions: std.Io.Writer.Allocating = .init(allocator);
    defer instructions.deinit();
    for (request.messages) |message| if (message.role == .system) if (message.content) |content| if (content.len > 0) {
        if (instructions.written().len > 0) try instructions.writer.writeAll("\n\n");
        try instructions.writer.writeAll(content);
    };
    if (instructions.written().len == 0) try instructions.writer.writeAll("You are a helpful assistant.");
    var document: std.Io.Writer.Allocating = .init(allocator);
    errdefer document.deinit();
    try document.writer.writeAll("{\"model\":");
    try std.json.Stringify.value(request.model, .{}, &document.writer);
    try document.writer.writeAll(",\"store\":false,\"stream\":true,\"instructions\":");
    try std.json.Stringify.value(instructions.written(), .{}, &document.writer);
    try document.writer.writeAll(",\"input\":[");
    try writeInput(allocator, &document.writer, request.messages);
    try document.writer.writeAll("],\"tools\":[");
    for (request.tools, 0..) |tool, index| {
        if (index > 0) try document.writer.writeByte(',');
        try writeTool(&document.writer, tool);
    }
    try document.writer.writeAll("],\"tool_choice\":");
    try std.json.Stringify.value(if (request.tools.len > 0) "auto" else "none", .{}, &document.writer);
    try document.writer.writeAll(",\"parallel_tool_calls\":true,\"include\":[\"reasoning.encrypted_content\"],\"text\":{\"verbosity\":\"low\"}");
    if (request.effort) |effort| if (!effort.isDefault()) {
        const label = if (std.mem.eql(u8, effort.label(), "minimal")) "low" else effort.label();
        try document.writer.writeAll(",\"reasoning\":{\"effort\":");
        try std.json.Stringify.value(label, .{}, &document.writer);
        try document.writer.writeAll(",\"summary\":\"auto\"}");
    };
    try document.writer.writeByte('}');
    return document.toOwnedSlice();
}

fn writeInput(allocator: std.mem.Allocator, writer: *std.Io.Writer, messages: []const protocol.Message) !void {
    var first = true;
    for (messages) |message| switch (message.role) {
        .system => {},
        .user => {
            try comma(writer, &first);
            try writer.writeAll("{\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":");
            try std.json.Stringify.value(message.content orelse "", .{}, writer);
            try writer.writeAll("}]}");
        },
        .assistant => {
            if (message.provider_state_json) |state_document| {
                if (state_document.len > limits.chat.provider_state_bytes) return error.ProviderStateTooLarge;
                var state = std.json.parseFromSlice(std.json.Value, allocator, state_document, .{}) catch return error.InvalidProviderState;
                defer state.deinit();
                if (state.value != .array) return error.InvalidProviderState;
                for (state.value.array.items) |item| {
                    if (item != .object) return error.InvalidProviderState;
                    try comma(writer, &first);
                    try std.json.Stringify.value(item, .{}, writer);
                }
            }
            if (message.content) |content| if (content.len > 0) {
                try comma(writer, &first);
                try writer.writeAll("{\"type\":\"message\",\"role\":\"assistant\",\"status\":\"completed\",\"content\":[{\"type\":\"output_text\",\"text\":");
                try std.json.Stringify.value(content, .{}, writer);
                try writer.writeAll(",\"annotations\":[]}]}");
            };
            if (message.tool_calls.len > limits.chat.tool_calls) return error.ToolCallLimitExceeded;
            for (message.tool_calls) |call| {
                try validateCall(call);
                try comma(writer, &first);
                try writer.writeAll("{\"type\":\"function_call\",\"call_id\":");
                try std.json.Stringify.value(call.id, .{}, writer);
                try writer.writeAll(",\"name\":");
                try std.json.Stringify.value(call.name, .{}, writer);
                try writer.writeAll(",\"arguments\":");
                try std.json.Stringify.value(call.arguments_json, .{}, writer);
                try writer.writeByte('}');
            }
        },
        .tool => {
            try comma(writer, &first);
            try writer.writeAll("{\"type\":\"function_call_output\",\"call_id\":");
            try std.json.Stringify.value(message.tool_call_id orelse "", .{}, writer);
            try writer.writeAll(",\"output\":");
            try std.json.Stringify.value(message.content orelse "", .{}, writer);
            try writer.writeByte('}');
        },
    };
}

fn writeTool(writer: *std.Io.Writer, tool: protocol.DynamicTool) !void {
    if (tool.name.len == 0 or tool.name.len > limits.chat.tool_identity_bytes or tool.input_schema != .object) return error.InvalidToolSchema;
    try writer.writeAll("{\"type\":\"function\",\"name\":");
    try std.json.Stringify.value(tool.name, .{}, writer);
    if (tool.description.len > 0) {
        try writer.writeAll(",\"description\":");
        try std.json.Stringify.value(tool.description[0..@min(tool.description.len, limits.chat.tool_description_bytes)], .{}, writer);
    }
    try writer.writeAll(",\"parameters\":");
    try std.json.Stringify.value(tool.input_schema, .{}, writer);
    try writer.writeAll(",\"strict\":false}");
}

fn validateCall(call: protocol.ToolCall) !void {
    if (call.id.len == 0 or call.id.len > limits.chat.tool_identity_bytes or call.name.len == 0 or call.name.len > limits.chat.tool_identity_bytes) return error.ToolCallLimitExceeded;
    if (call.arguments_json.len > limits.chat.tool_arguments_bytes) return error.ToolArgumentsTooLarge;
}

fn comma(writer: *std.Io.Writer, first: *bool) !void {
    if (!first.*) try writer.writeByte(',');
    first.* = false;
}
