const std = @import("std");

pub const Role = enum {
    system,
    user,
    assistant,
    tool,
};

pub const ToolArgumentIntegrity = enum {
    valid,
    malformed_json,

    pub fn classify(allocator: std.mem.Allocator, document: []const u8) ToolArgumentIntegrity {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return .malformed_json;
        parsed.deinit();
        return .valid;
    }
};

pub const ToolCall = struct {
    id: []const u8,
    name: []const u8,
    arguments_json: []const u8,
    argument_integrity: ToolArgumentIntegrity = .valid,
};

pub const Message = struct {
    role: Role,
    content: ?[]const u8 = null,
    tool_call_id: ?[]const u8 = null,
    tool_calls: []const ToolCall = &.{},
    provider_state_json: ?[]const u8 = null,
};

pub const Effort = union(enum) {
    auto,
    named: Name,

    const maximum_bytes = 64;

    const Name = struct {
        bytes: [maximum_bytes]u8,
        length: u8,

        fn parse(value: []const u8) ?Name {
            if (value.len == 0 or value.len > maximum_bytes) return null;
            for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_' and byte != '.') return null;
            var name = Name{ .bytes = [_]u8{0} ** maximum_bytes, .length = @intCast(value.len) };
            @memcpy(name.bytes[0..value.len], value);
            return name;
        }

        fn view(name: *const Name) []const u8 {
            return name.bytes[0..name.length];
        }
    };

    pub fn parse(value: []const u8) ?Effort {
        if (std.ascii.eqlIgnoreCase(value, "auto") or std.ascii.eqlIgnoreCase(value, "adaptive") or std.ascii.eqlIgnoreCase(value, "default")) return .auto;
        return .{ .named = Name.parse(value) orelse return null };
    }

    pub fn label(effort: *const Effort) []const u8 {
        return switch (effort.*) {
            .auto => "auto",
            .named => |*name| name.view(),
        };
    }

    pub fn isDefault(effort: Effort) bool {
        return effort == .auto;
    }
};

pub const DynamicTool = struct {
    name: []const u8,
    description: []const u8,
    input_schema: std.json.Value,
};

pub const Event = union(enum) {
    content_delta: []const u8,
    reasoning_delta: []const u8,
    tool_started: struct {
        id: []const u8,
        name: []const u8,
    },
    tool_input_delta: []const u8,
};

pub const EventSink = struct {
    context: *anyopaque,
    emit_fn: *const fn (*anyopaque, Event) void,

    pub fn emit(sink: EventSink, event: Event) void {
        sink.emit_fn(sink.context, event);
    }
};

pub const Request = struct {
    api_key: []const u8,
    model: []const u8,
    messages: []const Message,
    tools: []const DynamicTool,
    effort: ?Effort,
    events: EventSink,
    cancel_flag: *std.atomic.Value(bool),
};

pub const FailureKind = enum {
    invalid_request,
    unauthorized,
    forbidden,
    request_too_large,
    rate_limited,
    server_error,
    bad_gateway,
    unavailable,
    gateway_timeout,
    provider_error,
};

pub const Completion = struct {
    content: ?[]u8 = null,
    tool_calls: []ToolCall = &.{},
    provider_state_json: ?[]u8 = null,

    pub fn deinit(completion: *Completion, allocator: std.mem.Allocator) void {
        if (completion.content) |content| allocator.free(content);
        for (completion.tool_calls) |call| {
            allocator.free(@constCast(call.id));
            allocator.free(@constCast(call.name));
            allocator.free(@constCast(call.arguments_json));
        }
        if (completion.tool_calls.len > 0) allocator.free(completion.tool_calls);
        if (completion.provider_state_json) |state| allocator.free(state);
        completion.* = undefined;
    }
};

pub const Result = union(enum) {
    completed: Completion,
    failed: struct {
        kind: FailureKind,
        detail: []u8,
    },

    pub fn deinit(result: *Result, allocator: std.mem.Allocator) void {
        switch (result.*) {
            .completed => |*completion| completion.deinit(allocator),
            .failed => |failure| allocator.free(failure.detail),
        }
        result.* = undefined;
    }
};
