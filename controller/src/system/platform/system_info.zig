const std = @import("std");
const builtin = @import("builtin");

pub const Snapshot = struct {
    allocator: std.mem.Allocator,
    hostname: []u8,
    os: []u8,
    release: []u8,
    cpu_model: ?[]u8,
    cpu_cores: usize,
    memory_total_bytes: u64,
    memory_gb: u64,
    apple_silicon: bool,

    pub fn deinit(snapshot: *Snapshot) void {
        snapshot.allocator.free(snapshot.hostname);
        snapshot.allocator.free(snapshot.os);
        snapshot.allocator.free(snapshot.release);
        if (snapshot.cpu_model) |model| snapshot.allocator.free(model);
        snapshot.* = undefined;
    }
};

pub fn detect(allocator: std.mem.Allocator) !Snapshot {
    var hostname_buffer: [std.posix.HOST_NAME_MAX]u8 = undefined;
    const hostname = try allocator.dupe(u8, try std.posix.gethostname(&hostname_buffer));
    errdefer allocator.free(hostname);

    const uts = std.posix.uname();
    const system_name = std.mem.sliceTo(&uts.sysname, 0);
    const release = std.mem.sliceTo(&uts.release, 0);
    const os = try std.fmt.allocPrint(allocator, "{s} {s}", .{ system_name, release });
    errdefer allocator.free(os);
    const owned_release = try allocator.dupe(u8, release);
    errdefer allocator.free(owned_release);

    const cpu_model = try detectCpuModel(allocator);
    errdefer if (cpu_model) |model| allocator.free(model);
    const memory_bytes = std.process.totalSystemMemory() catch 0;
    const bytes_per_gib: u64 = 1024 * 1024 * 1024;
    return .{
        .allocator = allocator,
        .hostname = hostname,
        .os = os,
        .release = owned_release,
        .cpu_model = cpu_model,
        .cpu_cores = std.Thread.getCpuCount() catch 1,
        .memory_total_bytes = memory_bytes,
        .memory_gb = if (memory_bytes == 0) 0 else (memory_bytes + bytes_per_gib / 2) / bytes_per_gib,
        .apple_silicon = builtin.os.tag == .macos and builtin.cpu.arch == .aarch64,
    };
}

fn detectCpuModel(allocator: std.mem.Allocator) !?[]u8 {
    if (comptime builtin.os.tag == .macos) {
        return try readSysctlString(allocator, "machdep.cpu.brand_string") orelse
            try readSysctlString(allocator, "hw.model");
    }
    return null;
}

fn readSysctlString(allocator: std.mem.Allocator, name: [*:0]const u8) !?[]u8 {
    var size: usize = 0;
    if (std.c.sysctlbyname(name, null, &size, null, 0) != 0 or size == 0) return null;
    const buffer = try allocator.alloc(u8, size);
    defer allocator.free(buffer);
    if (std.c.sysctlbyname(name, buffer.ptr, &size, null, 0) != 0) return null;
    const value = std.mem.trim(u8, std.mem.sliceTo(buffer[0..size], 0), " \t\r\n");
    if (value.len == 0) return null;
    return try allocator.dupe(u8, value);
}
