const std = @import("std");

var generation = std.atomic.Value(u64).init(0);

pub fn current() u64 {
    return generation.load(.acquire);
}

pub fn notify() void {
    _ = generation.fetchAdd(1, .acq_rel);
}
