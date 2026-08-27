const std = @import("std");
const runtime_limits = @import("../../agent/runtime/limits.zig");
const mcp_bridge = @import("../../agent/mcp/bridge.zig");
const protocol = @import("../protocol.zig");
const tool_policy = @import("../tool_policy.zig");

const truncation_marker = "\n[tool result truncated by Local Studio]";

pub const Bridge = struct {
    base_url: []const u8,
    api_key: ?[]const u8,
    model_id: []const u8,
    session_id: []const u8,
    local_scope: bool,
};

pub const Catalog = struct {
    allocator: std.mem.Allocator,
    parsed: std.json.Parsed(std.json.Value),
    tools: []protocol.DynamicTool,

    pub fn empty(allocator: std.mem.Allocator) !Catalog {
        const parsed = try std.json.parseFromSlice(std.json.Value, allocator, "{\"result\":{\"tools\":[]}}", .{});
        errdefer parsed.deinit();
        return .{ .allocator = allocator, .parsed = parsed, .tools = try allocator.alloc(protocol.DynamicTool, 0) };
    }

    pub fn deinit(catalog: *Catalog) void {
        catalog.allocator.free(catalog.tools);
        catalog.parsed.deinit();
        catalog.* = undefined;
    }

    pub fn contains(catalog: *const Catalog, name: []const u8) bool {
        for (catalog.tools) |tool| if (std.mem.eql(u8, tool.name, name)) return true;
        return false;
    }
};

pub const Result = struct {
    text: []u8,
    is_error: bool,
    outbound_action: bool = false,

    pub fn deinit(result: *Result, allocator: std.mem.Allocator) void {
        allocator.free(result.text);
        result.* = undefined;
    }
};

pub fn load(allocator: std.mem.Allocator, io: std.Io, client: *std.http.Client, bridge: Bridge, browser_enabled: bool) !Catalog {
    if (bridge.base_url.len == 0) return Catalog.empty(allocator);
    const response = try mcp_bridge.handle(allocator, io, client, bridge.base_url, bridge.api_key, bridge.model_id, bridge.session_id, bridge.local_scope, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}");
    defer allocator.free(response);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response, .{}) catch return error.InvalidMcpResponse;
    errdefer parsed.deinit();
    if (parsed.value != .object) return error.InvalidMcpResponse;
    const result = parsed.value.object.get("result") orelse return error.InvalidMcpResponse;
    if (result != .object) return error.InvalidMcpResponse;
    const values = result.object.get("tools") orelse return error.InvalidMcpResponse;
    if (values != .array) return error.InvalidMcpResponse;
    var count: usize = 0;
    for (values.array.items) |value| {
        if (!validTool(value, browser_enabled)) continue;
        if (count == runtime_limits.chat.tools) break;
        count += 1;
    }
    const selected = try allocator.alloc(protocol.DynamicTool, count);
    errdefer allocator.free(selected);
    var index: usize = 0;
    for (values.array.items) |value| {
        if (!validTool(value, browser_enabled) or index == selected.len) continue;
        const schema = value.object.get("inputSchema") orelse std.json.Value{ .object = .empty };
        selected[index] = .{
            .name = stringField(value.object, "name").?,
            .description = stringField(value.object, "description") orelse "",
            .input_schema = schema,
        };
        index += 1;
    }
    return .{ .allocator = allocator, .parsed = parsed, .tools = selected };
}

pub fn call(allocator: std.mem.Allocator, io: std.Io, client: *std.http.Client, bridge: Bridge, catalog: *const Catalog, name: []const u8, arguments_json: []const u8) !Result {
    if (!catalog.contains(name)) return failure(allocator, "Tool is not available to built-in Chat");
    var arguments = std.json.parseFromSlice(std.json.Value, allocator, arguments_json, .{}) catch return failure(allocator, "Tool arguments were not valid JSON");
    defer arguments.deinit();
    if (arguments.value != .object) return failure(allocator, "Tool arguments must be an object");
    var request: std.Io.Writer.Allocating = .init(allocator);
    defer request.deinit();
    try request.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":");
    try std.json.Stringify.value(name, .{}, &request.writer);
    try request.writer.writeAll(",\"arguments\":");
    try std.json.Stringify.value(arguments.value, .{}, &request.writer);
    try request.writer.writeAll("}}");
    const response = mcp_bridge.handle(allocator, io, client, bridge.base_url, bridge.api_key, bridge.model_id, bridge.session_id, bridge.local_scope, request.writer.buffered()) catch |reason| return failure(allocator, @errorName(reason));
    defer allocator.free(response);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response, .{}) catch return failure(allocator, "Tool returned an invalid response");
    defer parsed.deinit();
    if (parsed.value != .object) return failure(allocator, "Tool returned an invalid response");
    if (parsed.value.object.get("error")) |tool_error| return .{ .text = try boundedJson(allocator, tool_error), .is_error = true };
    const result = parsed.value.object.get("result") orelse return failure(allocator, "Tool returned no result");
    const is_error = result == .object and (boolField(result.object, "isError") orelse false);
    const outbound_action = if (result == .object) if (result.object.get("structuredContent")) |structured| structured == .object and std.mem.eql(u8, stringField(structured.object, "outboundAction") orelse "", "telegram_reaction") else false else false;
    return .{ .text = try resultText(allocator, result), .is_error = is_error, .outbound_action = outbound_action };
}

pub fn origin(url: []const u8) []const u8 {
    for ([_][]const u8{ "/v1/responses", "/v1/chat/completions", "/v1/messages" }) |suffix| {
        if (std.mem.endsWith(u8, url, suffix)) return url[0 .. url.len - suffix.len];
    }
    return "";
}

fn validTool(value: std.json.Value, browser_enabled: bool) bool {
    if (value != .object) return false;
    const name = stringField(value.object, "name") orelse return false;
    if (!tool_policy.allows(name, browser_enabled)) return false;
    const schema = value.object.get("inputSchema") orelse std.json.Value{ .object = .empty };
    return schema == .object;
}

fn failure(allocator: std.mem.Allocator, message: []const u8) !Result {
    return .{ .text = try allocator.dupe(u8, message), .is_error = true };
}

fn boundedJson(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return runtime_limits.boundedCopy(allocator, output.writer.buffered(), runtime_limits.chat.tool_result_bytes, truncation_marker);
}

fn resultText(allocator: std.mem.Allocator, result: std.json.Value) ![]u8 {
    if (result == .object) if (result.object.get("content")) |content| if (content == .array) for (content.array.items) |item| {
        if (item != .object or !std.mem.eql(u8, stringField(item.object, "type") orelse "", "text")) continue;
        if (stringField(item.object, "text")) |text| return runtime_limits.boundedCopy(allocator, text, runtime_limits.chat.tool_result_bytes, truncation_marker);
    };
    return boundedJson(allocator, result);
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}

fn boolField(object: std.json.ObjectMap, name: []const u8) ?bool {
    const value = object.get(name) orelse return null;
    return if (value == .bool) value.bool else null;
}
