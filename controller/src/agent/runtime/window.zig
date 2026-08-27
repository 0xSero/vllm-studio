const std = @import("std");

pub fn Window(comptime T: type) type {
    return struct {
        items: std.ArrayList(T) = .empty,
        head: usize = 0,
        maximum: usize,

        const Self = @This();

        pub fn append(self: *Self, allocator: std.mem.Allocator, value: T, deinit_value: *const fn (*T) void) !void {
            if (self.maximum == 0) {
                var discarded = value;
                deinit_value(&discarded);
                return;
            }
            if (self.values().len == self.maximum) {
                deinit_value(&self.items.items[self.head]);
                self.head += 1;
            }
            if (self.head > 0 and (self.head >= self.maximum or self.head * 2 >= self.items.items.len)) self.compact();
            try self.items.append(allocator, value);
        }

        pub fn values(self: *const Self) []const T {
            return self.items.items[self.head..];
        }

        pub fn pop(self: *Self) ?T {
            if (self.values().len == 0) return null;
            const value = self.items.pop().?;
            if (self.items.items.len == self.head) {
                self.items.clearRetainingCapacity();
                self.head = 0;
            }
            return value;
        }

        pub fn deinit(self: *Self, allocator: std.mem.Allocator, deinit_value: *const fn (*T) void) void {
            for (self.items.items[self.head..]) |*value| deinit_value(value);
            self.items.deinit(allocator);
            self.* = undefined;
        }

        fn compact(self: *Self) void {
            const remaining = self.items.items[self.head..];
            std.mem.copyForwards(T, self.items.items[0..remaining.len], remaining);
            self.items.items.len = remaining.len;
            self.head = 0;
        }
    };
}
