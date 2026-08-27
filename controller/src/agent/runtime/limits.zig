const std = @import("std");

pub const harness_event_bytes: usize = 16 * 1024 * 1024;
pub const harness_events: usize = 4000;

pub const chat = struct {
    pub const model_bytes: usize = 1024;
    pub const error_body_bytes: usize = 1024 * 1024;
    pub const stream_line_bytes: usize = 32 * 1024 * 1024;
    pub const stream_bytes: usize = 64 * 1024 * 1024;
    pub const stream_events: usize = 100_000;
    pub const tool_calls: usize = 128;
    pub const tool_identity_bytes: usize = 1024;
    pub const tool_description_bytes: usize = 4096;
    pub const tool_arguments_bytes: usize = 4 * 1024 * 1024;
    pub const provider_state_bytes: usize = 4 * 1024 * 1024;
    pub const tool_rounds: usize = 16;
    pub const tools: usize = 512;
    pub const tool_result_bytes: usize = 2 * 1024 * 1024;
    pub const history_entries: usize = 200;
    pub const history_bytes: usize = 8 * 1024 * 1024;
};

pub fn checkedAdd(current: usize, additional: usize, maximum: usize) !usize {
    const next = std.math.add(usize, current, additional) catch return error.ResourceLimitExceeded;
    if (next > maximum) return error.ResourceLimitExceeded;
    return next;
}

pub fn boundedCopy(allocator: std.mem.Allocator, value: []const u8, maximum: usize, marker: []const u8) ![]u8 {
    if (value.len <= maximum) return allocator.dupe(u8, value);
    const output = try allocator.alloc(u8, maximum + marker.len);
    @memcpy(output[0..maximum], value[0..maximum]);
    @memcpy(output[maximum..], marker);
    return output;
}
