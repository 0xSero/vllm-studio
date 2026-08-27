const std = @import("std");
const runtime_limits = @import("../../agent/runtime/limits.zig");
const protocol = @import("../protocol.zig");
const history = @import("history.zig");
const output_runtime = @import("output.zig");
const provider = @import("provider.zig");
const tools_runtime = @import("tools.zig");

const system_prompt =
    "You are the built-in Local Studio Chat assistant. You have no filesystem, terminal, shell, or git access. " ++
    "Use the available browser and connector tools whenever they help, continue after each tool result until the request is complete, and state clearly when a filesystem-bound capability blocks the request.";

pub const Config = struct {
    api_key: []const u8,
    model: []const u8,
    gateway_url: []const u8,
    bridge: tools_runtime.Bridge,
};

pub fn run(allocator: std.mem.Allocator, io: std.Io, client: *std.http.Client, config: Config, store: *history.Store, sink: output_runtime.Sink, message: []const u8, thinking: ?[]const u8, browser_enabled: bool, cancelled: *std.atomic.Value(bool)) !void {
    var catalog = tools_runtime.load(allocator, io, client, config.bridge, browser_enabled) catch try tools_runtime.Catalog.empty(allocator);
    defer catalog.deinit();
    try store.append(.user, message);
    var keep_user = false;
    defer if (!keep_user) if (store.pop()) |value| {
        var entry = value;
        entry.deinit();
    };
    var messages: std.ArrayList(protocol.Message) = .empty;
    defer messages.deinit(allocator);
    try messages.append(allocator, .{ .role = .system, .content = system_prompt });
    for (store.values()) |entry| try messages.append(allocator, .{ .role = entry.role, .content = entry.content });
    var output = output_runtime.Output{ .allocator = allocator, .sink = sink };
    defer output.deinit();
    const effort = if (thinking) |value| if (!std.mem.eql(u8, value, "off")) protocol.Effort.parse(value) else null else null;
    var turn_arena = std.heap.ArenaAllocator.init(allocator);
    defer turn_arena.deinit();
    const turn_allocator = turn_arena.allocator();
    var assistant: []const u8 = "";
    var assistant_streamed = false;
    var round: usize = 0;
    while (round < runtime_limits.chat.tool_rounds) : (round += 1) {
        const content_start = output.content.items.len;
        var result = provider.stream(allocator, client, config.gateway_url, .{
            .api_key = config.api_key,
            .model = config.model,
            .messages = messages.items,
            .tools = catalog.tools,
            .effort = effort,
            .events = .{ .context = &output, .emit_fn = output_runtime.Output.emitModel },
            .cancel_flag = cancelled,
        }) catch |failure| return output_runtime.writeError(sink, @errorName(failure));
        defer result.deinit(allocator);
        if (output.failed) return output_runtime.writeError(sink, "Chat stream could not be delivered");
        const completion = switch (result) {
            .completed => |completed| completed,
            .failed => |failure| return output_runtime.writeError(sink, if (failure.detail.len > 0) failure.detail else @tagName(failure.kind)),
        };
        if (completion.tool_calls.len == 0) {
            assistant_streamed = output.content.items.len > content_start;
            assistant = if (assistant_streamed)
                output.content.items[content_start..]
            else if (completion.content) |value|
                try turn_allocator.dupe(u8, value)
            else
                "";
            break;
        }
        const calls = try duplicateToolCalls(turn_allocator, completion.tool_calls);
        try messages.append(allocator, .{
            .role = .assistant,
            .content = if (completion.content) |value| try turn_allocator.dupe(u8, value) else null,
            .tool_calls = calls,
            .provider_state_json = if (completion.provider_state_json) |value| try turn_allocator.dupe(u8, value) else null,
        });
        for (calls) |call| {
            try output.writeToolCall(call);
            var tool_result = if (call.argument_integrity == .valid)
                try tools_runtime.call(allocator, io, client, config.bridge, &catalog, call.name, call.arguments_json)
            else
                tools_runtime.Result{ .text = try allocator.dupe(u8, "Tool arguments were not valid JSON"), .is_error = true };
            defer tool_result.deinit(allocator);
            try output.writeToolResult(call.id, tool_result.text, tool_result.is_error);
            if (tool_result.outbound_action and !tool_result.is_error) {
                try store.append(.assistant, "Reacted to the user's Telegram message.");
                keep_user = true;
                try store.save();
                try output.writeOutboundAction("telegram_reaction");
                try sink.emit("{\"type\":\"agent_settled\"}");
                return;
            }
            try messages.append(allocator, .{
                .role = .tool,
                .content = try turn_allocator.dupe(u8, tool_result.text),
                .tool_call_id = call.id,
            });
        }
    }
    if (round == runtime_limits.chat.tool_rounds) return output_runtime.writeError(sink, "Chat tool loop reached its safety limit");
    if (std.mem.trim(u8, assistant, " \t\r\n").len == 0) return output_runtime.writeError(sink, "Provider completed without an assistant response");
    if (!assistant_streamed) try output.writeDelta("text_delta", assistant);
    try store.append(.assistant, assistant);
    keep_user = true;
    errdefer if (store.pop()) |value| {
        var entry = value;
        entry.deinit();
    };
    try store.save();
    try output.writeMessage(assistant);
    try sink.emit("{\"type\":\"agent_settled\"}");
}

fn duplicateToolCalls(allocator: std.mem.Allocator, calls: []const protocol.ToolCall) ![]protocol.ToolCall {
    const duplicated = try allocator.alloc(protocol.ToolCall, calls.len);
    for (calls, 0..) |call, index| duplicated[index] = .{
        .id = try allocator.dupe(u8, call.id),
        .name = try allocator.dupe(u8, call.name),
        .arguments_json = try allocator.dupe(u8, call.arguments_json),
        .argument_integrity = call.argument_integrity,
    };
    return duplicated;
}
