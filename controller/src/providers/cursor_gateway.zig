const std = @import("std");
const config = @import("../app/config.zig");
const connector_runtime = @import("../agent/connectors/runtime.zig");
const openai_protocol = @import("openai_protocol.zig");
const inference_usage = @import("../inference/usage/store.zig");

const Io = std.Io;
const max_response_bytes = 64 * 1024 * 1024;
const bridge_source = @embedFile("../assets/cursor-provider.mjs");
const h2_source = @embedFile("../assets/h2-bridge.mjs");

const BridgeResult = struct {
    allocator: std.mem.Allocator,
    stdout: []u8,
    stderr: []u8,
    term: std.process.Child.Term,

    fn deinit(result: *BridgeResult) void {
        result.allocator.free(result.stdout);
        result.allocator.free(result.stderr);
        result.* = undefined;
    }
};

pub fn configured(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) bool {
    const node = discoverNode(allocator, io, configuration.environment) catch return false;
    defer if (node) |value| allocator.free(value);
    if (node == null) return false;
    return authenticationCommand(allocator, io, configuration.environment, "status", 5);
}

pub fn login(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) bool {
    if (configured(allocator, io, configuration)) return true;
    return authenticationCommand(allocator, io, configuration.environment, "login", 15 * 60);
}

pub fn logout(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) bool {
    return authenticationCommand(allocator, io, configuration.environment, "logout", 15);
}

pub fn serve(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, public_protocol: openai_protocol.Protocol, model_id: []const u8, payload: []const u8, requested_stream: bool, request: *std.http.Server.Request) !?inference_usage.Sample {
    const responses_payload = try openai_protocol.request(allocator, public_protocol, .responses, payload);
    defer allocator.free(responses_payload);
    const upstream_payload = try prepareRequest(allocator, responses_payload, model_id);
    defer allocator.free(upstream_payload);
    const bridge_payload = try bridgeRequest(allocator, configuration.data_dir, model_id, upstream_payload);
    defer allocator.free(bridge_payload);
    const paths = try materialize(allocator, io, configuration.data_dir);
    defer {
        allocator.free(paths.bridge);
        allocator.free(paths.h2);
    }
    const node = try discoverNode(allocator, io, configuration.environment) orelse return error.CursorNodeUnavailable;
    defer allocator.free(node);
    var result = try runBridge(allocator, io, configuration.environment, node, paths.bridge, bridge_payload);
    defer result.deinit();
    if (!successful(result.term)) {
        const message = std.mem.trim(u8, result.stderr, " \t\r\n");
        var output: Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"error\":{\"message\":");
        try std.json.Stringify.value(if (message.len > 0) message else "Cursor provider request failed", .{}, &output.writer);
        try output.writer.writeAll("}}");
        try request.respond(output.writer.buffered(), .{
            .status = .bad_gateway,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return null;
    }
    const converted = try openai_protocol.response(allocator, .responses, public_protocol, result.stdout);
    defer allocator.free(converted);
    const sample = inference_usage.parseSample(allocator, converted);
    try respond(allocator, public_protocol, converted, requested_stream, request);
    return sample;
}

const Paths = struct { bridge: []u8, h2: []u8 };

fn materialize(allocator: std.mem.Allocator, io: Io, data_dir: []const u8) !Paths {
    const directory = try std.fs.path.join(allocator, &.{ data_dir, "providers", "cursor", "runtime" });
    defer allocator.free(directory);
    _ = try Io.Dir.cwd().createDirPathStatus(io, directory, @enumFromInt(0o700));
    const bridge = try std.fs.path.join(allocator, &.{ directory, "cursor-provider.mjs" });
    errdefer allocator.free(bridge);
    const h2 = try std.fs.path.join(allocator, &.{ directory, "h2-bridge.mjs" });
    errdefer allocator.free(h2);
    try materializeAsset(allocator, io, bridge, bridge_source);
    try materializeAsset(allocator, io, h2, h2_source);
    return .{ .bridge = bridge, .h2 = h2 };
}

fn materializeAsset(allocator: std.mem.Allocator, io: Io, path: []const u8, data: []const u8) !void {
    const current = Io.Dir.cwd().statFile(io, path, .{}) catch null;
    if (current) |stat| if (stat.kind == .file and stat.size == data.len) return;
    var random: [8]u8 = undefined;
    io.random(&random);
    const suffix = std.fmt.bytesToHex(random, .lower);
    const temporary = try std.fmt.allocPrint(allocator, "{s}.tmp-{s}", .{ path, suffix[0..] });
    defer allocator.free(temporary);
    defer Io.Dir.cwd().deleteFile(io, temporary) catch {};
    try Io.Dir.cwd().writeFile(io, .{ .sub_path = temporary, .data = data, .flags = .{ .permissions = @enumFromInt(0o600) } });
    try Io.Dir.renameAbsolute(temporary, path, io);
}

fn discoverNode(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map) !?[]const u8 {
    if (try connector_runtime.findExecutable(allocator, io, environment, "LOCAL_STUDIO_CURSOR_NODE_BIN", "node")) |node_candidate| {
        if (environment.get("LOCAL_STUDIO_CURSOR_NODE_BIN") != null) return node_candidate;
        allocator.free(node_candidate);
    }
    if (try connector_runtime.findExecutable(allocator, io, environment, "LOCAL_STUDIO_CURSOR_AGENT_BIN", "agent")) |agent| {
        defer allocator.free(agent);
        const resolved = if (std.fs.path.isAbsolute(agent))
            Io.Dir.realPathFileAbsoluteAlloc(io, agent, allocator) catch null
        else
            Io.Dir.cwd().realPathFileAlloc(io, agent, allocator) catch null;
        if (resolved) |value| {
            defer allocator.free(value);
            const sibling = try std.fs.path.join(allocator, &.{ std.fs.path.dirname(value) orelse ".", if (@import("builtin").os.tag == .windows) "node.exe" else "node" });
            if (executableFile(io, sibling)) return sibling;
            allocator.free(sibling);
        }
    }
    return connector_runtime.findExecutable(allocator, io, environment, "LOCAL_STUDIO_NODE_BIN", "node");
}

fn authenticationCommand(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, command: []const u8, timeout_seconds: i64) bool {
    const agent = connector_runtime.findExecutable(allocator, io, environment, "LOCAL_STUDIO_CURSOR_AGENT_BIN", "agent") catch return false;
    defer if (agent) |value| allocator.free(value);
    const executable = agent orelse return false;
    const result = std.process.run(allocator, io, .{
        .argv = &.{ executable, command },
        .environ_map = environment,
        .stdout_limit = .limited(256 * 1024),
        .stderr_limit = .limited(256 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(timeout_seconds) } },
    }) catch return false;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    return successful(result.term);
}

fn runBridge(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, node: []const u8, bridge: []const u8, payload: []const u8) !BridgeResult {
    var child = try std.process.spawn(io, .{
        .argv = &.{ node, bridge },
        .environ_map = environment,
        .stdin = .pipe,
        .stdout = .pipe,
        .stderr = .pipe,
        .pgid = 0,
    });
    defer child.kill(io);
    try child.stdin.?.writeStreamingAll(io, payload);
    child.stdin.?.close(io);
    child.stdin = null;
    var multi_reader_buffer: Io.File.MultiReader.Buffer(2) = undefined;
    var multi_reader: Io.File.MultiReader = undefined;
    multi_reader.init(allocator, io, multi_reader_buffer.toStreams(), &.{ child.stdout.?, child.stderr.? });
    defer multi_reader.deinit();
    const stdout_reader = multi_reader.reader(0);
    const stderr_reader = multi_reader.reader(1);
    while (multi_reader.fill(64 * 1024, .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(15 * 60) } })) |_| {
        if (stdout_reader.buffered().len > max_response_bytes or stderr_reader.buffered().len > 256 * 1024) return error.CursorProviderOutputTooLarge;
    } else |failure| switch (failure) {
        error.EndOfStream => {},
        else => return failure,
    }
    try multi_reader.checkAnyError();
    const stdout = try allocator.dupe(u8, stdout_reader.buffered());
    errdefer allocator.free(stdout);
    const stderr = try allocator.dupe(u8, stderr_reader.buffered());
    errdefer allocator.free(stderr);
    return .{ .allocator = allocator, .stdout = stdout, .stderr = stderr, .term = try child.wait(io) };
}

fn bridgeRequest(allocator: std.mem.Allocator, data_dir: []const u8, model_id: []const u8, request_document: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"dataDirectory\":");
    try std.json.Stringify.value(data_dir, .{}, &output.writer);
    try output.writer.writeAll(",\"modelId\":");
    try std.json.Stringify.value(model_id, .{}, &output.writer);
    try output.writer.writeAll(",\"request\":");
    try output.writer.writeAll(request_document);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn prepareRequest(allocator: std.mem.Allocator, document: []const u8, model_id: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInferencePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInferencePayload;
    try parsed.value.object.put(parsed.arena.allocator(), "model", .{ .string = try parsed.arena.allocator().dupe(u8, model_id) });
    try parsed.value.object.put(parsed.arena.allocator(), "stream", .{ .bool = false });
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn respond(allocator: std.mem.Allocator, protocol: openai_protocol.Protocol, converted: []const u8, requested_stream: bool, request: *std.http.Server.Request) !void {
    if (!requested_stream) {
        try request.respond(converted, .{ .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return;
    }
    var write_buffer: [16 * 1024]u8 = undefined;
    var downstream = try request.respondStreaming(&write_buffer, .{
        .respond_options = .{
            .keep_alive = false,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "text/event-stream; charset=utf-8" },
                .{ .name = "Cache-Control", .value = "no-cache" },
                .{ .name = "X-Accel-Buffering", .value = "no" },
            },
        },
    });
    switch (protocol) {
        .chat_completions => {
            const chunk = try chatChunk(allocator, converted);
            defer allocator.free(chunk);
            try downstream.writer.print("data: {s}\n\ndata: [DONE]\n\n", .{chunk});
        },
        .responses => try openai_protocol.writeResponsesStream(allocator, &downstream.writer, converted),
    }
    try downstream.end();
}

fn chatChunk(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInferenceResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInferenceResponse;
    const choices = parsed.value.object.getPtr("choices") orelse return error.InvalidInferenceResponse;
    if (choices.* != .array) return error.InvalidInferenceResponse;
    for (choices.array.items) |*choice| {
        if (choice.* != .object) continue;
        if (choice.object.fetchSwapRemove("message")) |entry| try choice.object.put(parsed.arena.allocator(), "delta", entry.value);
    }
    try parsed.value.object.put(parsed.arena.allocator(), "object", .{ .string = "chat.completion.chunk" });
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn executableFile(io: Io, path: []const u8) bool {
    const stat = Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return stat.kind == .file and stat.permissions.toMode() & 0o111 != 0;
}

fn successful(term: std.process.Child.Term) bool {
    return switch (term) {
        .exited => |code| code == 0,
        else => false,
    };
}
