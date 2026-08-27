const std = @import("std");

pub const Decoder = struct {
    maximum_line_bytes: usize,
    pending: std.ArrayList(u8) = .empty,

    pub fn deinit(decoder: *Decoder, allocator: std.mem.Allocator) void {
        decoder.pending.deinit(allocator);
        decoder.* = undefined;
    }

    pub fn release(decoder: *Decoder) void {
        decoder.pending.clearRetainingCapacity();
    }

    pub fn next(decoder: *Decoder, allocator: std.mem.Allocator, reader: *std.Io.Reader) !?[]const u8 {
        while (true) {
            const line = try decoder.readLine(allocator, reader) orelse return null;
            const trimmed = std.mem.trim(u8, line, " \t\r");
            if (trimmed.len == 0 or trimmed[0] == ':') {
                decoder.release();
                continue;
            }
            if (!std.mem.startsWith(u8, trimmed, "data:")) {
                decoder.release();
                continue;
            }
            const data = std.mem.trim(u8, trimmed[5..], " \t");
            if (std.mem.eql(u8, data, "[DONE]")) return null;
            return data;
        }
    }

    fn readLine(decoder: *Decoder, allocator: std.mem.Allocator, reader: *std.Io.Reader) !?[]const u8 {
        while (true) {
            const fragment = reader.takeDelimiter('\n') catch |failure| switch (failure) {
                error.StreamTooLong => {
                    const buffered = reader.buffered();
                    if (buffered.len == 0) return error.StreamReadStalled;
                    if (buffered.len > decoder.maximum_line_bytes - decoder.pending.items.len) return error.StreamEventTooLarge;
                    try decoder.pending.appendSlice(allocator, buffered);
                    reader.tossBuffered();
                    continue;
                },
                else => return failure,
            } orelse {
                if (decoder.pending.items.len > 0) return decoder.pending.items;
                return null;
            };
            if (fragment.len > decoder.maximum_line_bytes - decoder.pending.items.len) return error.StreamEventTooLarge;
            if (decoder.pending.items.len == 0) return fragment;
            try decoder.pending.appendSlice(allocator, fragment);
            return decoder.pending.items;
        }
    }
};
