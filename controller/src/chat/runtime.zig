const std = @import("std");
const history = @import("runtime/history.zig");
const output = @import("runtime/output.zig");
const turn = @import("runtime/turn.zig");

pub const Sink = output.Sink;

pub const Runtime = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    client: std.http.Client,
    store: history.Store,
    api_key: []u8,
    model: []u8,
    gateway_url: []u8,
    bridge_url: []u8,
    bridge_key: ?[]u8,
    bridge_model: []u8,
    bridge_session: []u8,
    bridge_local_scope: bool,
    cancelled: std.atomic.Value(bool) = .init(false),

    pub fn init(allocator: std.mem.Allocator, io: std.Io, options: Options) !Runtime {
        const api_key = try allocator.dupe(u8, options.api_key);
        errdefer allocator.free(api_key);
        const model = try allocator.dupe(u8, options.model);
        errdefer allocator.free(model);
        const gateway_url = try allocator.dupe(u8, options.gateway_url);
        errdefer allocator.free(gateway_url);
        const bridge_url = try allocator.dupe(u8, options.bridge_url);
        errdefer allocator.free(bridge_url);
        const bridge_key = if (options.bridge_key) |value| try allocator.dupe(u8, value) else null;
        errdefer if (bridge_key) |value| allocator.free(value);
        const bridge_model = try allocator.dupe(u8, options.bridge_model);
        errdefer allocator.free(bridge_model);
        const bridge_session = try allocator.dupe(u8, options.bridge_session);
        errdefer allocator.free(bridge_session);
        var store = try history.Store.open(allocator, io, options.home, options.session_id);
        errdefer store.deinit();
        return .{
            .allocator = allocator,
            .io = io,
            .client = .{ .allocator = allocator, .io = io },
            .store = store,
            .api_key = api_key,
            .model = model,
            .gateway_url = gateway_url,
            .bridge_url = bridge_url,
            .bridge_key = bridge_key,
            .bridge_model = bridge_model,
            .bridge_session = bridge_session,
            .bridge_local_scope = options.bridge_local_scope,
        };
    }

    pub fn deinit(runtime: *Runtime) void {
        runtime.cancel();
        runtime.client.deinit();
        runtime.store.deinit();
        runtime.allocator.free(runtime.api_key);
        runtime.allocator.free(runtime.model);
        runtime.allocator.free(runtime.gateway_url);
        runtime.allocator.free(runtime.bridge_url);
        if (runtime.bridge_key) |value| runtime.allocator.free(value);
        runtime.allocator.free(runtime.bridge_model);
        runtime.allocator.free(runtime.bridge_session);
        runtime.* = undefined;
    }

    pub fn prompt(runtime: *Runtime, message: []const u8, thinking: ?[]const u8, browser_enabled: bool, sink: Sink) void {
        runtime.cancelled.store(false, .seq_cst);
        turn.run(runtime.allocator, runtime.io, &runtime.client, .{
            .api_key = runtime.api_key,
            .model = runtime.model,
            .gateway_url = runtime.gateway_url,
            .bridge = .{
                .base_url = runtime.bridge_url,
                .api_key = runtime.bridge_key,
                .model_id = runtime.bridge_model,
                .session_id = runtime.bridge_session,
                .local_scope = runtime.bridge_local_scope,
            },
        }, &runtime.store, sink, message, thinking, browser_enabled, &runtime.cancelled) catch |failure| {
            output.writeError(sink, @errorName(failure)) catch {};
        };
    }

    pub fn cancel(runtime: *Runtime) void {
        runtime.cancelled.store(true, .seq_cst);
    }
};

pub const Options = struct {
    api_key: []const u8,
    model: []const u8,
    gateway_url: []const u8,
    home: []const u8,
    session_id: []const u8,
    bridge_url: []const u8,
    bridge_key: ?[]const u8,
    bridge_model: []const u8,
    bridge_session: []const u8,
    bridge_local_scope: bool,
};
