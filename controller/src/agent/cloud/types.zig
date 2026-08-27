const std = @import("std");

pub const Provisioned = struct {
    allocator: std.mem.Allocator,
    provider_id: []u8,
    node_id: []u8,
    address: []u8,
    workspace: []u8,

    pub fn deinit(worker: *Provisioned) void {
        worker.allocator.free(worker.provider_id);
        worker.allocator.free(worker.node_id);
        worker.allocator.free(worker.address);
        worker.allocator.free(worker.workspace);
        worker.* = undefined;
    }
};
