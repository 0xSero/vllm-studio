const std = @import("std");

pub const Protocol = enum {
    chat_completions,
    responses,
};

pub fn request(allocator: std.mem.Allocator, source: Protocol, target: Protocol, document: []const u8) ![]u8 {
    if (source == target) return allocator.dupe(u8, document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInferencePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInferencePayload;
    if (source == .chat_completions) try chatRequestToResponses(&parsed) else try responsesRequestToChat(&parsed);
    return stringify(allocator, parsed.value);
}

pub fn response(allocator: std.mem.Allocator, source: Protocol, target: Protocol, document: []const u8) ![]u8 {
    if (source == target) return allocator.dupe(u8, document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInferenceResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInferenceResponse;
    return if (source == .chat_completions)
        chatResponseToResponses(allocator, parsed.value.object)
    else
        responsesResponseToChat(allocator, parsed.value.object);
}

pub fn writeResponsesStream(allocator: std.mem.Allocator, writer: *std.Io.Writer, document: []const u8) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInferenceResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInferenceResponse;
    const output = parsed.value.object.get("output") orelse return error.InvalidInferenceResponse;
    if (output != .array) return error.InvalidInferenceResponse;
    for (output.array.items, 0..) |item, output_index| {
        if (item != .object) continue;
        const item_type = stringField(item.object, "type") orelse continue;
        const item_id = stringField(item.object, "id") orelse "item";
        try writer.print("event: response.output_item.added\ndata: {{\"type\":\"response.output_item.added\",\"output_index\":{d},\"item\":", .{output_index});
        if (std.mem.eql(u8, item_type, "message")) {
            try writer.writeAll("{\"id\":");
            try std.json.Stringify.value(item_id, .{}, writer);
            try writer.writeAll(",\"type\":\"message\",\"status\":\"in_progress\",\"role\":\"assistant\",\"content\":[]}");
        } else if (std.mem.eql(u8, item_type, "function_call")) {
            try writer.writeAll("{\"id\":");
            try std.json.Stringify.value(item_id, .{}, writer);
            try writer.writeAll(",\"type\":\"function_call\",\"call_id\":");
            try std.json.Stringify.value(stringField(item.object, "call_id") orelse item_id, .{}, writer);
            try writer.writeAll(",\"name\":");
            try std.json.Stringify.value(stringField(item.object, "name") orelse "", .{}, writer);
            try writer.writeAll(",\"arguments\":\"\"}");
        } else {
            try std.json.Stringify.value(item, .{}, writer);
        }
        try writer.writeAll("}\n\n");
        if (std.mem.eql(u8, item_type, "message")) {
            const content = item.object.get("content");
            if (content) |parts| if (parts == .array) for (parts.array.items, 0..) |part, content_index| {
                if (part != .object or !std.mem.eql(u8, stringField(part.object, "type") orelse "", "output_text")) continue;
                const text = stringField(part.object, "text") orelse "";
                try writer.print("event: response.content_part.added\ndata: {{\"type\":\"response.content_part.added\",\"item_id\":", .{});
                try std.json.Stringify.value(item_id, .{}, writer);
                try writer.print(",\"output_index\":{d},\"content_index\":{d},\"part\":{{\"type\":\"output_text\",\"text\":\"\",\"annotations\":[]}}}}\n\n", .{ output_index, content_index });
                try writer.writeAll("event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"item_id\":");
                try std.json.Stringify.value(item_id, .{}, writer);
                try writer.print(",\"output_index\":{d},\"content_index\":{d},\"delta\":", .{ output_index, content_index });
                try std.json.Stringify.value(text, .{}, writer);
                try writer.writeAll("}\n\n");
                try writer.writeAll("event: response.output_text.done\ndata: {\"type\":\"response.output_text.done\",\"item_id\":");
                try std.json.Stringify.value(item_id, .{}, writer);
                try writer.print(",\"output_index\":{d},\"content_index\":{d},\"text\":", .{ output_index, content_index });
                try std.json.Stringify.value(text, .{}, writer);
                try writer.writeAll("}\n\n");
                try writer.writeAll("event: response.content_part.done\ndata: {\"type\":\"response.content_part.done\",\"item_id\":");
                try std.json.Stringify.value(item_id, .{}, writer);
                try writer.print(",\"output_index\":{d},\"content_index\":{d},\"part\":", .{ output_index, content_index });
                try std.json.Stringify.value(part, .{}, writer);
                try writer.writeAll("}\n\n");
            };
        } else if (std.mem.eql(u8, item_type, "function_call")) {
            const arguments = stringField(item.object, "arguments") orelse "{}";
            try writer.writeAll("event: response.function_call_arguments.delta\ndata: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":");
            try std.json.Stringify.value(item_id, .{}, writer);
            try writer.print(",\"output_index\":{d},\"delta\":", .{output_index});
            try std.json.Stringify.value(arguments, .{}, writer);
            try writer.writeAll("}\n\n");
            try writer.writeAll("event: response.function_call_arguments.done\ndata: {\"type\":\"response.function_call_arguments.done\",\"item_id\":");
            try std.json.Stringify.value(item_id, .{}, writer);
            try writer.print(",\"output_index\":{d},\"arguments\":", .{output_index});
            try std.json.Stringify.value(arguments, .{}, writer);
            try writer.writeAll("}\n\n");
        }
        try writer.print("event: response.output_item.done\ndata: {{\"type\":\"response.output_item.done\",\"output_index\":{d},\"item\":", .{output_index});
        try std.json.Stringify.value(item, .{}, writer);
        try writer.writeAll("}\n\n");
    }
    try writer.writeAll("event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":");
    try writer.writeAll(document);
    try writer.writeAll("}\n\n");
}

fn chatRequestToResponses(parsed: *std.json.Parsed(std.json.Value)) !void {
    const object = &parsed.value.object;
    const storage = parsed.arena.allocator();
    if (object.fetchSwapRemove("messages")) |entry| try object.put(storage, "input", entry.value);
    if (object.fetchSwapRemove("max_completion_tokens")) |entry| {
        try object.put(storage, "max_output_tokens", entry.value);
        _ = object.swapRemove("max_tokens");
    } else if (object.fetchSwapRemove("max_tokens")) |entry| {
        try object.put(storage, "max_output_tokens", entry.value);
    }
    if (object.fetchSwapRemove("response_format")) |entry| {
        var text: std.json.ObjectMap = .empty;
        try text.put(storage, "format", entry.value);
        try object.put(storage, "text", .{ .object = text });
    }
    if (object.getPtr("tools")) |tools| try chatToolsToResponses(storage, tools);
    if (object.getPtr("tool_choice")) |choice| try chatToolChoiceToResponses(storage, choice);
    for ([_][]const u8{ "frequency_penalty", "presence_penalty", "logit_bias", "logprobs", "top_logprobs", "n", "seed", "stop", "stream_options" }) |name| _ = object.swapRemove(name);
}

fn responsesRequestToChat(parsed: *std.json.Parsed(std.json.Value)) !void {
    const object = &parsed.value.object;
    const storage = parsed.arena.allocator();
    var messages: std.json.Array = .init(storage);
    if (object.fetchSwapRemove("instructions")) |entry| if (entry.value == .string and entry.value.string.len > 0) {
        var message: std.json.ObjectMap = .empty;
        try message.put(storage, "role", .{ .string = "system" });
        try message.put(storage, "content", entry.value);
        try messages.append(.{ .object = message });
    };
    if (object.fetchSwapRemove("input")) |entry| {
        switch (entry.value) {
            .string => |text| {
                var message: std.json.ObjectMap = .empty;
                try message.put(storage, "role", .{ .string = "user" });
                try message.put(storage, "content", .{ .string = text });
                try messages.append(.{ .object = message });
            },
            .array => |items| for (items.items) |item| try appendResponseInputAsChat(storage, &messages, item),
            else => return error.InvalidInferencePayload,
        }
    }
    try object.put(storage, "messages", .{ .array = messages });
    if (object.fetchSwapRemove("max_output_tokens")) |entry| try object.put(storage, "max_completion_tokens", entry.value);
    if (object.fetchSwapRemove("text")) |entry| if (entry.value == .object) if (entry.value.object.get("format")) |format| try object.put(storage, "response_format", format);
    if (object.getPtr("tools")) |tools| try responsesToolsToChat(storage, tools);
    if (object.getPtr("tool_choice")) |choice| try responsesToolChoiceToChat(storage, choice);
    if (object.fetchSwapRemove("reasoning")) |entry| if (entry.value == .object) if (entry.value.object.get("effort")) |effort| try object.put(storage, "reasoning_effort", effort);
    for ([_][]const u8{ "include", "store", "truncation", "previous_response_id", "prompt_cache_key", "safety_identifier" }) |name| _ = object.swapRemove(name);
}

fn appendResponseInputAsChat(storage: std.mem.Allocator, messages: *std.json.Array, item: std.json.Value) !void {
    if (item != .object) return;
    const item_type = stringField(item.object, "type");
    if (item_type != null and std.mem.eql(u8, item_type.?, "function_call_output")) {
        var message: std.json.ObjectMap = .empty;
        try message.put(storage, "role", .{ .string = "tool" });
        try message.put(storage, "tool_call_id", item.object.get("call_id") orelse .{ .string = "" });
        try message.put(storage, "content", item.object.get("output") orelse .{ .string = "" });
        try messages.append(.{ .object = message });
        return;
    }
    if (item_type != null and std.mem.eql(u8, item_type.?, "function_call")) {
        var function: std.json.ObjectMap = .empty;
        try function.put(storage, "name", item.object.get("name") orelse .{ .string = "" });
        try function.put(storage, "arguments", item.object.get("arguments") orelse .{ .string = "{}" });
        var tool_call: std.json.ObjectMap = .empty;
        try tool_call.put(storage, "id", item.object.get("call_id") orelse item.object.get("id") orelse .{ .string = "" });
        try tool_call.put(storage, "type", .{ .string = "function" });
        try tool_call.put(storage, "function", .{ .object = function });
        var calls: std.json.Array = .init(storage);
        try calls.append(.{ .object = tool_call });
        var message: std.json.ObjectMap = .empty;
        try message.put(storage, "role", .{ .string = "assistant" });
        try message.put(storage, "content", .null);
        try message.put(storage, "tool_calls", .{ .array = calls });
        try messages.append(.{ .object = message });
        return;
    }
    var message = try cloneObject(storage, item.object);
    _ = message.swapRemove("type");
    if (!message.contains("role")) try message.put(storage, "role", .{ .string = "user" });
    if (message.getPtr("content")) |content| try responseContentToChat(storage, content);
    try messages.append(.{ .object = message });
}

fn responseContentToChat(storage: std.mem.Allocator, content: *std.json.Value) !void {
    if (content.* != .array) return;
    for (content.array.items) |*part| {
        if (part.* != .object) continue;
        const part_type = stringField(part.object, "type") orelse continue;
        if (std.mem.eql(u8, part_type, "input_text") or std.mem.eql(u8, part_type, "output_text")) {
            try part.object.put(storage, "type", .{ .string = "text" });
        } else if (std.mem.eql(u8, part_type, "input_image")) {
            const url = part.object.fetchSwapRemove("image_url") orelse continue;
            var image_url: std.json.ObjectMap = .empty;
            try image_url.put(storage, "url", url.value);
            try part.object.put(storage, "type", .{ .string = "image_url" });
            try part.object.put(storage, "image_url", .{ .object = image_url });
        }
    }
}

fn chatToolsToResponses(storage: std.mem.Allocator, value: *std.json.Value) !void {
    if (value.* != .array) return error.InvalidInferencePayload;
    for (value.array.items) |*tool| {
        if (tool.* != .object or !std.mem.eql(u8, stringField(tool.object, "type") orelse "", "function")) continue;
        const function = tool.object.get("function") orelse continue;
        if (function != .object) continue;
        var flattened = try cloneObject(storage, function.object);
        try flattened.put(storage, "type", .{ .string = "function" });
        tool.* = .{ .object = flattened };
    }
}

fn responsesToolsToChat(storage: std.mem.Allocator, value: *std.json.Value) !void {
    if (value.* != .array) return error.InvalidInferencePayload;
    for (value.array.items) |*tool| {
        if (tool.* != .object or !std.mem.eql(u8, stringField(tool.object, "type") orelse "", "function")) continue;
        var function = try cloneObject(storage, tool.object);
        _ = function.swapRemove("type");
        var wrapped: std.json.ObjectMap = .empty;
        try wrapped.put(storage, "type", .{ .string = "function" });
        try wrapped.put(storage, "function", .{ .object = function });
        tool.* = .{ .object = wrapped };
    }
}

fn chatToolChoiceToResponses(storage: std.mem.Allocator, value: *std.json.Value) !void {
    if (value.* != .object) return;
    const function = value.object.get("function") orelse return;
    if (function != .object) return;
    var flattened = try cloneObject(storage, function.object);
    try flattened.put(storage, "type", .{ .string = "function" });
    value.* = .{ .object = flattened };
}

fn responsesToolChoiceToChat(storage: std.mem.Allocator, value: *std.json.Value) !void {
    if (value.* != .object or !std.mem.eql(u8, stringField(value.object, "type") orelse "", "function")) return;
    var function = try cloneObject(storage, value.object);
    _ = function.swapRemove("type");
    var wrapped: std.json.ObjectMap = .empty;
    try wrapped.put(storage, "type", .{ .string = "function" });
    try wrapped.put(storage, "function", .{ .object = function });
    value.* = .{ .object = wrapped };
}

fn responsesResponseToChat(allocator: std.mem.Allocator, object: std.json.ObjectMap) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    const id = stringField(object, "id") orelse "response";
    const model = stringField(object, "model") orelse "unknown";
    try output.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeAll(",\"object\":\"chat.completion\",\"created\":");
    try writeIntegerOrZero(&output.writer, object.get("created_at"));
    try output.writer.writeAll(",\"model\":");
    try std.json.Stringify.value(model, .{}, &output.writer);
    try output.writer.writeAll(",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":");
    var text: std.Io.Writer.Allocating = .init(allocator);
    defer text.deinit();
    var tool_count: usize = 0;
    const response_output = object.get("output");
    if (response_output) |items| if (items == .array) for (items.array.items) |item| {
        if (item != .object) continue;
        const item_type = stringField(item.object, "type") orelse continue;
        if (std.mem.eql(u8, item_type, "message")) appendOutputText(&text.writer, item.object.get("content")) catch {} else if (std.mem.eql(u8, item_type, "function_call")) tool_count += 1;
    };
    if (text.writer.buffered().len > 0) try std.json.Stringify.value(text.writer.buffered(), .{}, &output.writer) else try output.writer.writeAll("null");
    if (tool_count > 0) {
        try output.writer.writeAll(",\"tool_calls\":[");
        var index: usize = 0;
        if (response_output) |items| if (items == .array) for (items.array.items) |item| {
            if (item != .object or !std.mem.eql(u8, stringField(item.object, "type") orelse "", "function_call")) continue;
            if (index > 0) try output.writer.writeByte(',');
            try output.writer.print("{{\"index\":{d},\"id\":", .{index});
            try std.json.Stringify.value(stringField(item.object, "call_id") orelse stringField(item.object, "id") orelse "", .{}, &output.writer);
            try output.writer.writeAll(",\"type\":\"function\",\"function\":{\"name\":");
            try std.json.Stringify.value(stringField(item.object, "name") orelse "", .{}, &output.writer);
            try output.writer.writeAll(",\"arguments\":");
            try std.json.Stringify.value(stringField(item.object, "arguments") orelse "{}", .{}, &output.writer);
            try output.writer.writeAll("}}");
            index += 1;
        };
        try output.writer.writeByte(']');
    }
    try output.writer.writeAll("},\"finish_reason\":");
    try std.json.Stringify.value(if (tool_count > 0) "tool_calls" else finishReasonFromResponse(object), .{}, &output.writer);
    try output.writer.writeAll("}],\"usage\":");
    try writeResponsesUsageAsChat(&output.writer, object.get("usage"));
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn chatResponseToResponses(allocator: std.mem.Allocator, object: std.json.ObjectMap) ![]u8 {
    const choices = object.get("choices") orelse return error.InvalidInferenceResponse;
    if (choices != .array or choices.array.items.len == 0 or choices.array.items[0] != .object) return error.InvalidInferenceResponse;
    const choice = choices.array.items[0].object;
    const message = choice.get("message") orelse return error.InvalidInferenceResponse;
    if (message != .object) return error.InvalidInferenceResponse;
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    const id = stringField(object, "id") orelse "chatcmpl";
    try output.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeAll(",\"object\":\"response\",\"created_at\":");
    try writeIntegerOrZero(&output.writer, object.get("created"));
    try output.writer.writeAll(",\"status\":\"completed\",\"model\":");
    try std.json.Stringify.value(stringField(object, "model") orelse "unknown", .{}, &output.writer);
    try output.writer.writeAll(",\"output\":[{\"id\":\"message_0\",\"type\":\"message\",\"status\":\"completed\",\"role\":\"assistant\",\"content\":[");
    if (message.object.get("content")) |content| {
        if (content == .string and content.string.len > 0) {
            try output.writer.writeAll("{\"type\":\"output_text\",\"text\":");
            try std.json.Stringify.value(content.string, .{}, &output.writer);
            try output.writer.writeAll(",\"annotations\":[]}");
        }
    }
    try output.writer.writeAll("]}");
    if (message.object.get("tool_calls")) |calls| if (calls == .array) for (calls.array.items) |call| {
        if (call != .object) continue;
        const function = call.object.get("function") orelse continue;
        if (function != .object) continue;
        try output.writer.writeAll(",{\"type\":\"function_call\",\"id\":");
        try std.json.Stringify.value(stringField(call.object, "id") orelse "", .{}, &output.writer);
        try output.writer.writeAll(",\"call_id\":");
        try std.json.Stringify.value(stringField(call.object, "id") orelse "", .{}, &output.writer);
        try output.writer.writeAll(",\"name\":");
        try std.json.Stringify.value(stringField(function.object, "name") orelse "", .{}, &output.writer);
        try output.writer.writeAll(",\"arguments\":");
        try std.json.Stringify.value(stringField(function.object, "arguments") orelse "{}", .{}, &output.writer);
        try output.writer.writeAll(",\"status\":\"completed\"}");
    };
    try output.writer.writeAll("],\"usage\":");
    try writeChatUsageAsResponses(&output.writer, object.get("usage"));
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn appendOutputText(writer: *std.Io.Writer, content_value: ?std.json.Value) !void {
    const content = content_value orelse return;
    if (content != .array) return;
    for (content.array.items) |part| {
        if (part != .object) continue;
        const part_type = stringField(part.object, "type") orelse continue;
        if (!std.mem.eql(u8, part_type, "output_text")) continue;
        if (stringField(part.object, "text")) |value| try writer.writeAll(value);
    }
}

fn finishReasonFromResponse(object: std.json.ObjectMap) []const u8 {
    const status = stringField(object, "status") orelse return "stop";
    if (std.mem.eql(u8, status, "incomplete")) return "length";
    if (std.mem.eql(u8, status, "failed") or std.mem.eql(u8, status, "cancelled")) return "stop";
    return "stop";
}

fn writeResponsesUsageAsChat(writer: *std.Io.Writer, usage_value: ?std.json.Value) !void {
    const usage = usage_value orelse {
        try writer.writeAll("{\"prompt_tokens\":0,\"completion_tokens\":0,\"total_tokens\":0}");
        return;
    };
    if (usage != .object) return error.InvalidInferenceResponse;
    const input = integerField(usage.object, "input_tokens");
    const output = integerField(usage.object, "output_tokens");
    try writer.print("{{\"prompt_tokens\":{d},\"completion_tokens\":{d},\"total_tokens\":{d}}}", .{ input, output, input + output });
}

fn writeChatUsageAsResponses(writer: *std.Io.Writer, usage_value: ?std.json.Value) !void {
    const usage = usage_value orelse {
        try writer.writeAll("{\"input_tokens\":0,\"output_tokens\":0,\"total_tokens\":0}");
        return;
    };
    if (usage != .object) return error.InvalidInferenceResponse;
    const input = integerField(usage.object, "prompt_tokens");
    const output = integerField(usage.object, "completion_tokens");
    try writer.print("{{\"input_tokens\":{d},\"output_tokens\":{d},\"total_tokens\":{d}}}", .{ input, output, input + output });
}

fn writeIntegerOrZero(writer: *std.Io.Writer, value: ?std.json.Value) !void {
    const present = value orelse {
        try writer.writeByte('0');
        return;
    };
    if (present == .integer and present.integer >= 0) try writer.print("{d}", .{present.integer}) else try writer.writeByte('0');
}

fn integerField(object: std.json.ObjectMap, name: []const u8) u64 {
    const value = object.get(name) orelse return 0;
    return if (value == .integer and value.integer > 0) @intCast(value.integer) else 0;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}

fn cloneObject(storage: std.mem.Allocator, object: std.json.ObjectMap) !std.json.ObjectMap {
    var cloned: std.json.ObjectMap = .empty;
    var iterator = object.iterator();
    while (iterator.next()) |entry| try cloned.put(storage, try storage.dupe(u8, entry.key_ptr.*), entry.value_ptr.*);
    return cloned;
}

fn stringify(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}
