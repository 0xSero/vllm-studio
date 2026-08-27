const std = @import("std");
const lifecycle = @import("../../inference/runtime/lifecycle.zig");
const recipe_repository = @import("../../inference/recipes/store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const telemetry = @import("../telemetry.zig");

const Io = std.Io;
const http = std.http;

pub fn payload(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, recipe_column: recipe_repository.PayloadColumn, inference_port: u16, default_trust_remote_code: bool, system: anytype, supervisor: *lifecycle.Supervisor) ![]u8 {
    const status_document = try supervisor.statusPayload(database, recipe_column, inference_port, default_trust_remote_code);
    defer allocator.free(status_document);
    var status = std.json.parseFromSlice(std.json.Value, allocator, status_document, .{}) catch return error.InvalidStatusPayload;
    defer status.deinit();
    if (status.value != .object) return error.InvalidStatusPayload;
    const process_value = status.value.object.get("process");
    const process = if (process_value != null and process_value.? == .object) process_value.?.object else null;

    const gpu_document = try telemetry.gpuPayload(allocator, io, system);
    defer allocator.free(gpu_document);
    var gpu_payload = std.json.parseFromSlice(std.json.Value, allocator, gpu_document, .{}) catch return error.InvalidGpuPayload;
    defer gpu_payload.deinit();
    var power_watts: f64 = 0;
    var power_limit_watts: f64 = 0;
    var vram_used_gb: f64 = 0;
    var vram_capacity_gb: f64 = 0;
    if (gpu_payload.value == .object) {
        if (gpu_payload.value.object.get("gpus")) |gpus| if (gpus == .array) {
            for (gpus.array.items) |gpu| {
                if (gpu != .object) continue;
                power_watts += numeric(gpu.object.get("power_draw"));
                power_limit_watts += numeric(gpu.object.get("power_limit"));
                vram_used_gb += numeric(gpu.object.get("memory_used_mb")) / 1024;
                vram_capacity_gb += numeric(gpu.object.get("memory_total_mb")) / 1024;
            }
        };
    }

    var scrape: ?[]u8 = null;
    defer if (scrape) |document| allocator.free(document);
    var prometheus = std.StringHashMap(f64).init(allocator);
    defer prometheus.deinit();
    var scrape_model: ?[]const u8 = null;
    var backend: ?[]const u8 = null;
    var model_path: ?[]const u8 = null;
    var served_model_name: ?[]const u8 = null;
    var model_id: ?[]const u8 = null;
    if (process) |running| {
        backend = optionalString(running, "backend");
        model_path = optionalString(running, "model_path");
        served_model_name = optionalString(running, "served_model_name");
        model_id = served_model_name orelse if (model_path) |path| std.fs.path.basename(path) else "active";
        const port = unsigned(running.get("port")) orelse inference_port;
        scrape = try fetchMetrics(allocator, io, client, @intCast(port));
        if (scrape) |document| scrape_model = try parsePrometheus(&prometheus, document);
    }
    served_model_name = served_model_name orelse scrape_model;
    model_id = model_id orelse scrape_model;
    const names = metricNames(backend orelse "");
    const prompt_tokens = firstMetric(&prometheus, names.prompt_tokens);
    const generation_tokens = firstMetric(&prometheus, names.generation_tokens);
    const ttft_count = prometheus.get(names.ttft_count) orelse 0;
    const ttft_sum = prometheus.get(names.ttft_sum) orelse 0;
    const Metrics = struct {
        lifetime_prompt_tokens: f64 = 0,
        lifetime_completion_tokens: f64 = 0,
        lifetime_requests: f64 = 0,
        lifetime_energy_kwh: f64 = 0,
        lifetime_uptime_hours: f64 = 0,
        current_power_watts: f64,
        vram_used_gb: f64,
        vram_capacity_gb: f64,
        power_limit_watts: f64,
        model_id: ?[]const u8,
        model_path: ?[]const u8,
        served_model_name: ?[]const u8,
        running_requests: f64,
        pending_requests: f64,
        kv_cache_usage: f64,
        prompt_tokens_total: f64,
        generation_tokens_total: f64,
        total_tokens: ?f64 = null,
        total_requests: ?f64 = null,
        prompt_throughput: f64,
        generation_throughput: f64,
        avg_ttft_ms: f64,
        latency_avg: ?f64 = null,
    };
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(Metrics{
        .current_power_watts = power_watts,
        .vram_used_gb = rounded(vram_used_gb),
        .vram_capacity_gb = rounded(vram_capacity_gb),
        .power_limit_watts = @round(power_limit_watts),
        .model_id = model_id,
        .model_path = model_path,
        .served_model_name = served_model_name,
        .running_requests = firstMetric(&prometheus, names.running_requests),
        .pending_requests = firstMetric(&prometheus, names.pending_requests),
        .kv_cache_usage = firstMetric(&prometheus, names.kv_cache_usage),
        .prompt_tokens_total = prompt_tokens,
        .generation_tokens_total = generation_tokens,
        .prompt_throughput = firstMetric(&prometheus, names.prompt_throughput),
        .generation_throughput = firstMetric(&prometheus, names.generation_throughput),
        .avg_ttft_ms = if (ttft_count > 0) rounded((ttft_sum / ttft_count) * 1000) else 0,
    }, .{}, &output.writer);
    return try output.toOwnedSlice();
}

const Names = struct {
    prompt_tokens: []const []const u8,
    generation_tokens: []const []const u8,
    prompt_throughput: []const []const u8,
    generation_throughput: []const []const u8,
    running_requests: []const []const u8,
    pending_requests: []const []const u8,
    kv_cache_usage: []const []const u8,
    ttft_sum: []const u8,
    ttft_count: []const u8,
};

fn metricNames(backend: []const u8) Names {
    if (std.mem.eql(u8, backend, "sglang")) return .{
        .prompt_tokens = &.{ "sglang:prompt_tokens_total", "sglang:prefill_tokens_total" },
        .generation_tokens = &.{ "sglang:generation_tokens_total", "sglang:completion_tokens_total", "sglang:gen_tokens_total" },
        .prompt_throughput = &.{ "sglang:prompt_throughput", "sglang:prefill_throughput" },
        .generation_throughput = &.{ "sglang:gen_throughput", "sglang:generation_throughput" },
        .running_requests = &.{ "sglang:num_running_reqs", "sglang:num_requests_running" },
        .pending_requests = &.{ "sglang:num_queue_reqs", "sglang:num_pending_reqs", "sglang:num_requests_waiting" },
        .kv_cache_usage = &.{ "sglang:token_usage", "sglang:kv_cache_usage_perc" },
        .ttft_sum = "sglang:time_to_first_token_seconds_sum",
        .ttft_count = "sglang:time_to_first_token_seconds_count",
    };
    if (std.mem.eql(u8, backend, "llamacpp")) return .{
        .prompt_tokens = &.{"llamacpp:prompt_tokens_total"},
        .generation_tokens = &.{"llamacpp:tokens_predicted_total"},
        .prompt_throughput = &.{"llamacpp:prompt_tokens_seconds"},
        .generation_throughput = &.{"llamacpp:predicted_tokens_seconds"},
        .running_requests = &.{"llamacpp:requests_processing"},
        .pending_requests = &.{"llamacpp:requests_deferred"},
        .kv_cache_usage = &.{"llamacpp:kv_cache_usage_ratio"},
        .ttft_sum = "llamacpp:time_to_first_token_seconds_sum",
        .ttft_count = "llamacpp:time_to_first_token_seconds_count",
    };
    return .{
        .prompt_tokens = &.{"vllm:prompt_tokens_total"},
        .generation_tokens = &.{"vllm:generation_tokens_total"},
        .prompt_throughput = &.{ "vllm:prompt_throughput", "vllm:prefill_throughput" },
        .generation_throughput = &.{ "vllm:gen_throughput", "vllm:generation_throughput" },
        .running_requests = &.{"vllm:num_requests_running"},
        .pending_requests = &.{"vllm:num_requests_waiting"},
        .kv_cache_usage = &.{"vllm:kv_cache_usage_perc"},
        .ttft_sum = "vllm:time_to_first_token_seconds_sum",
        .ttft_count = "vllm:time_to_first_token_seconds_count",
    };
}

fn fetchMetrics(allocator: std.mem.Allocator, io: Io, client: *http.Client, port: u16) !?[]u8 {
    const Result = anyerror!?[]u8;
    const Selection = union(enum) { fetch: Result, timer: Io.Cancelable!void };
    var selections: [2]Selection = undefined;
    var select = Io.Select(Selection).init(io, &selections);
    try select.concurrent(.fetch, fetchMetricsRequest, .{ allocator, client, port });
    select.concurrent(.timer, metricsTimeout, .{io}) catch {
        select.cancelDiscard();
        return null;
    };
    const selected = try select.await();
    switch (selected) {
        .fetch => |result| {
            select.cancelDiscard();
            return result catch null;
        },
        .timer => |result| {
            result catch |failure| switch (failure) {
                error.Canceled => return error.Canceled,
            };
            select.cancelDiscard();
            return null;
        },
    }
}

fn fetchMetricsRequest(allocator: std.mem.Allocator, client: *http.Client, port: u16) !?[]u8 {
    const url = try std.fmt.allocPrint(allocator, "http://127.0.0.1:{d}/metrics", .{port});
    defer allocator.free(url);
    const storage = try allocator.alloc(u8, 4 * 1024 * 1024);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = client.fetch(.{
        .location = .{ .url = url },
        .method = .GET,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .response_writer = &output,
    }) catch return null;
    if (response.status != .ok) return null;
    return try allocator.dupe(u8, output.buffered());
}

fn metricsTimeout(io: Io) Io.Cancelable!void {
    return io.sleep(.fromMilliseconds(1500), .awake);
}

fn parsePrometheus(metrics: *std.StringHashMap(f64), document: []const u8) !?[]const u8 {
    var model: ?[]const u8 = null;
    var lines = std.mem.splitScalar(u8, document, '\n');
    while (lines.next()) |raw_line| {
        const line = std.mem.trim(u8, raw_line, " \t\r");
        if (line.len == 0 or line[0] == '#') continue;
        if (model == null) model = labelValue(line, "served_model_name=\"") orelse labelValue(line, "model_name=\"");
        const separator = std.mem.lastIndexOfAny(u8, line, " \t") orelse continue;
        const value = std.fmt.parseFloat(f64, std.mem.trim(u8, line[separator + 1 ..], " \t")) catch continue;
        const metric_end = std.mem.indexOfAny(u8, line[0..separator], "{ \t") orelse separator;
        const name = line[0..metric_end];
        if (name.len > 0) try metrics.put(name, value);
    }
    return model;
}

fn labelValue(line: []const u8, marker: []const u8) ?[]const u8 {
    const start = std.mem.indexOf(u8, line, marker) orelse return null;
    const suffix = line[start + marker.len ..];
    const end = std.mem.indexOfScalar(u8, suffix, '"') orelse return null;
    return if (end > 0) suffix[0..end] else null;
}

fn firstMetric(metrics: *const std.StringHashMap(f64), names: []const []const u8) f64 {
    for (names) |name| if (metrics.get(name)) |value| return value;
    return 0;
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string and value.string.len > 0) value.string else null;
}

fn unsigned(value: ?std.json.Value) ?u64 {
    const present = value orelse return null;
    if (present != .integer or present.integer <= 0) return null;
    return @intCast(present.integer);
}

fn numeric(value: ?std.json.Value) f64 {
    const present = value orelse return 0;
    return switch (present) {
        .integer => |number_value| @floatFromInt(number_value),
        .float => |number_value| number_value,
        .number_string => |number_value| std.fmt.parseFloat(f64, number_value) catch 0,
        else => 0,
    };
}

fn rounded(value: f64) f64 {
    return @round(value * 10) / 10;
}
