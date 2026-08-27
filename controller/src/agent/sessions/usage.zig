const std = @import("std");

const Io = std.Io;

pub const Totals = struct {
    input: u64 = 0,
    output: u64 = 0,
    cache_read: u64 = 0,
    cache_write: u64 = 0,
    reasoning: u64 = 0,
    total: u64 = 0,
    calls: u64 = 0,
    compactions: u64 = 0,

    pub fn addDocument(totals: *Totals, allocator: std.mem.Allocator, document: []const u8) void {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return;
        defer parsed.deinit();
        addValue(totals, parsed.value);
    }

    pub fn write(totals: Totals, writer: *Io.Writer) !void {
        try writer.print("{{\"input\":{d},\"output\":{d},\"cacheRead\":{d},\"cacheWrite\":{d},\"reasoning\":{d},\"total\":{d},\"cost\":0,\"calls\":{d},\"compactions\":{d}}}", .{
            totals.input,
            totals.output,
            totals.cache_read,
            totals.cache_write,
            totals.reasoning,
            totals.total,
            totals.calls,
            totals.compactions,
        });
    }
};

pub fn fromTranscript(allocator: std.mem.Allocator, document: []const u8) Totals {
    var totals: Totals = .{};
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return totals;
    defer parsed.deinit();
    if (parsed.value != .object) return totals;
    const entries = parsed.value.object.get("entries") orelse return totals;
    if (entries != .array) return totals;
    for (entries.array.items) |entry| addValue(&totals, entry);
    return totals;
}

fn addValue(totals: *Totals, value: std.json.Value) void {
    if (value != .object) return;
    const message = if (value.object.get("message")) |entry| entry else value;
    if (message != .object) return;
    if (message.object.get("usage")) |usage| {
        if (usage != .object) return;
        const input = number(usage.object, &.{ "input", "input_tokens", "prompt_tokens" });
        const output = number(usage.object, &.{ "output", "output_tokens", "completion_tokens" });
        const cache_read = number(usage.object, &.{ "cacheRead", "cache_read", "cache_read_tokens" });
        const cache_write = number(usage.object, &.{ "cacheWrite", "cache_write", "cache_write_tokens" });
        const reasoning = number(usage.object, &.{ "reasoning", "reasoning_tokens" });
        totals.input += input;
        totals.output += output;
        totals.cache_read += cache_read;
        totals.cache_write += cache_write;
        totals.reasoning += reasoning;
        totals.total += orelseValue(
            number(usage.object, &.{ "totalTokens", "total_tokens", "total" }),
            input + output + cache_read + cache_write + reasoning,
        );
        totals.calls += 1;
    }
    const event_type = stringField(value.object, "type") orelse "";
    if (std.mem.indexOf(u8, event_type, "compact") != null) totals.compactions += 1;
}

fn number(object: std.json.ObjectMap, names: []const []const u8) u64 {
    for (names) |name| {
        const value = object.get(name) orelse continue;
        switch (value) {
            .integer => |item| if (item >= 0) return @intCast(item),
            .float => |item| if (item >= 0 and item <= @as(f64, @floatFromInt(std.math.maxInt(u64)))) return @intFromFloat(item),
            else => {},
        }
    }
    return 0;
}

fn orelseValue(value: u64, fallback: u64) u64 {
    return if (value > 0) value else fallback;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}
