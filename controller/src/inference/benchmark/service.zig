const std = @import("std");
const model_service = @import("../models/service.zig");
const recipe_service = @import("../recipes/service.zig");
const peak_metrics = @import("../../system/metrics/store.zig");
const recipes = @import("../recipes/store.zig");
const sqlite = @import("../../storage/sqlite.zig");

const max_response_bytes = 16 * 1024 * 1024;

pub fn payload(allocator: std.mem.Allocator, io: std.Io, client: *std.http.Client, database: *sqlite.Database, column: recipes.PayloadColumn, llm_instance_path: []const u8, inference_origin: []const u8, default_trust_remote_code: bool, prompt_tokens: usize) ![]u8 {
    const recipe_id = try model_service.activeRecipeId(allocator, io, database, column, llm_instance_path) orelse return allocator.dupe(u8, "{\"error\":\"No model running\"}");
    defer allocator.free(recipe_id);
    const recipe = try recipe_service.detailPayload(allocator, io, database, column, recipe_id, default_trust_remote_code) orelse return allocator.dupe(u8, "{\"error\":\"No model running\"}");
    defer allocator.free(recipe);
    var parsed_recipe = std.json.parseFromSlice(std.json.Value, allocator, recipe, .{}) catch return error.InvalidRecipe;
    defer parsed_recipe.deinit();
    if (parsed_recipe.value != .object) return error.InvalidRecipe;
    const model_path = stringField(parsed_recipe.value.object, "model_path") orelse return error.InvalidRecipe;
    const model_id = nullableStringField(parsed_recipe.value.object, "served_model_name") orelse std.fs.path.basename(std.mem.trimEnd(u8, model_path, "/"));

    var prompt: std.Io.Writer.Allocating = .init(allocator);
    defer prompt.deinit();
    try prompt.writer.writeAll("Please count: ");
    const count = prompt_tokens / 2;
    for (0..count) |index| {
        if (index > 0) try prompt.writer.writeByte(' ');
        try prompt.writer.print("{d}", .{index});
    }
    var body: std.Io.Writer.Allocating = .init(allocator);
    defer body.deinit();
    try body.writer.writeAll("{\"model\":");
    try std.json.Stringify.value(model_id, .{}, &body.writer);
    try body.writer.writeAll(",\"messages\":[{\"role\":\"user\",\"content\":");
    try std.json.Stringify.value(prompt.writer.buffered(), .{}, &body.writer);
    try body.writer.writeAll("}],\"stream\":false}");

    const url = try std.fmt.allocPrint(allocator, "{s}/v1/chat/completions", .{inference_origin});
    defer allocator.free(url);
    const response_storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(response_storage);
    var response_body: std.Io.Writer = .fixed(response_storage);
    const headers = [_]std.http.Header{.{ .name = "Content-Type", .value = "application/json" }};
    const started = std.Io.Clock.awake.now(io);
    const response = client.fetch(.{
        .location = .{ .url = url },
        .method = .POST,
        .payload = body.writer.buffered(),
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .content_type = .omit },
        .extra_headers = &headers,
        .response_writer = &response_body,
    }) catch return error.BenchmarkRequestFailed;
    const elapsed_nanoseconds = started.durationTo(std.Io.Clock.awake.now(io)).toNanoseconds();
    const elapsed_seconds = @max(@as(f64, @floatFromInt(elapsed_nanoseconds)) / std.time.ns_per_s, 0.000001);
    if (response.status.class() != .success) {
        return std.fmt.allocPrint(allocator, "{{\"error\":\"Request failed: {d}\"}}", .{@intFromEnum(response.status)});
    }
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response_body.buffered(), .{}) catch return error.InvalidBenchmarkResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidBenchmarkResponse;
    const usage = parsed.value.object.get("usage") orelse return allocator.dupe(u8, "{\"error\":\"No tokens in response\"}");
    if (usage != .object) return error.InvalidBenchmarkResponse;
    const prompt_actual = nonnegativeNumber(usage.object.get("prompt_tokens")) orelse 0;
    const completion = nonnegativeNumber(usage.object.get("completion_tokens")) orelse 0;
    if (completion <= 0 or prompt_actual <= 0) return allocator.dupe(u8, "{\"error\":\"No tokens in response\"}");
    if (completion > @as(f64, @floatFromInt(std.math.maxInt(i64)))) return error.InvalidBenchmarkResponse;
    const generation_tps = completion / elapsed_seconds;
    const completion_integer: i64 = @intFromFloat(@floor(completion));
    const peak = peak: {
        try database.lock(io);
        defer database.unlock(io);
        break :peak try peak_metrics.updateBenchmarkPayload(allocator, database, model_id, generation_tps, completion_integer);
    };
    defer allocator.free(peak);

    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"success\":true,\"model_id\":");
    try std.json.Stringify.value(model_id, .{}, &output.writer);
    try output.writer.print(",\"benchmark\":{{\"prompt_tokens\":{d},\"completion_tokens\":{d},\"total_time_s\":{d},\"generation_tps\":{d}}},\"peak_metrics\":", .{ prompt_actual, completion, roundTo(elapsed_seconds, 100), roundTo(generation_tps, 10) });
    try output.writer.writeAll(peak);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn roundTo(value: f64, factor: f64) f64 {
    return @round(value * factor) / factor;
}

fn nonnegativeNumber(value: ?std.json.Value) ?f64 {
    const present = value orelse return null;
    const number: f64 = switch (present) {
        .integer => |result| @floatFromInt(result),
        .float => |result| result,
        .number_string => |result| std.fmt.parseFloat(f64, result) catch return null,
        else => return null,
    };
    return if (std.math.isFinite(number) and number >= 0) number else null;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string and value.string.len > 0) value.string else null;
}

fn nullableStringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}
