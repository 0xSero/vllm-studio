const std = @import("std");
const builtin = @import("builtin");
const system_info = @import("platform/system_info.zig");

const Io = std.Io;

const Gpu = struct {
    id: ?[]const u8 = null,
    uuid: ?[]const u8 = null,
    pci_bus_id: ?[]const u8 = null,
    index: usize,
    name: []const u8,
    memory_total_mb: u64,
    memory_used_mb: u64,
    memory_free_mb: u64,
    utilization_pct: f64,
    temp_c: f64,
    power_draw: f64,
    power_limit: f64,
    memory_shared: bool = false,
    memory_usage_available: bool = true,
    utilization_available: bool = true,
    temperature_available: bool = true,
    power_available: bool = true,
};

const Collection = struct {
    arena: std.heap.ArenaAllocator,
    gpus: []const Gpu,

    fn deinit(collection: *Collection) void {
        collection.arena.deinit();
        collection.* = undefined;
    }
};

pub const PlacementDevices = struct {
    arena: std.heap.ArenaAllocator,
    ids: []const []const u8,
    accelerator: []const u8,
    shareable: bool,

    pub fn deinit(devices: *PlacementDevices) void {
        devices.arena.deinit();
        devices.* = undefined;
    }
};

pub fn placementDevices(allocator: std.mem.Allocator, io: Io, system: *const system_info.Snapshot) !PlacementDevices {
    var collection = try collect(allocator, io, system);
    errdefer collection.deinit();
    const storage = collection.arena.allocator();
    const ids = try storage.alloc([]const u8, collection.gpus.len);
    for (collection.gpus, ids) |gpu, *id| id.* = gpu.id orelse gpu.uuid orelse gpu.pci_bus_id orelse try std.fmt.allocPrint(storage, "gpu:{d}", .{gpu.index});
    const result = PlacementDevices{
        .arena = collection.arena,
        .ids = ids,
        .accelerator = if (system.apple_silicon) "metal" else if (ids.len > 0) "cuda" else "cpu",
        .shareable = system.apple_silicon,
    };
    collection = undefined;
    return result;
}

pub fn gpuPayload(allocator: std.mem.Allocator, io: Io, system: *const system_info.Snapshot) ![]u8 {
    var collection = try collect(allocator, io, system);
    defer collection.deinit();
    return stringifyPayload(allocator, collection.gpus);
}

pub fn gpuArrayPayload(allocator: std.mem.Allocator, io: Io, system: *const system_info.Snapshot) ![]u8 {
    var collection = try collect(allocator, io, system);
    defer collection.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(collection.gpus, .{}, &output.writer);
    return output.toOwnedSlice();
}

pub fn availableMemoryBytes(allocator: std.mem.Allocator, io: Io, fallback: u64) u64 {
    return availableMemory(allocator, io, fallback);
}

pub fn cpuUsagePercent(allocator: std.mem.Allocator, io: Io, cpu_cores: usize) ?f64 {
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "ps", "-A", "-o", "%cpu=" },
        .stdout_limit = .limited(2 * 1024 * 1024),
        .stderr_limit = .limited(64 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = Io.Duration.fromSeconds(2) } },
    }) catch return null;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    if (!processSucceeded(result.term)) return null;
    var total: f64 = 0;
    var values = std.mem.tokenizeAny(u8, result.stdout, " \t\r\n");
    while (values.next()) |value| total += std.fmt.parseFloat(f64, value) catch 0;
    const cores: f64 = @floatFromInt(@max(cpu_cores, 1));
    return @min(@max(total / cores, 0), 100);
}

pub const NetworkCounters = struct {
    receive_bytes: u64,
    transmit_bytes: u64,
};

pub fn networkCounters(allocator: std.mem.Allocator, io: Io) ?NetworkCounters {
    return switch (builtin.os.tag) {
        .linux => linuxNetworkCounters(allocator, io),
        .macos => macosNetworkCounters(allocator, io),
        else => null,
    };
}

fn linuxNetworkCounters(allocator: std.mem.Allocator, io: Io) ?NetworkCounters {
    const document = Io.Dir.cwd().readFileAlloc(io, "/proc/net/dev", allocator, .limited(1024 * 1024)) catch return null;
    defer allocator.free(document);
    var counters = NetworkCounters{ .receive_bytes = 0, .transmit_bytes = 0 };
    var lines = std.mem.splitScalar(u8, document, '\n');
    while (lines.next()) |line| {
        const separator = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const name = std.mem.trim(u8, line[0..separator], " \t");
        if (std.mem.eql(u8, name, "lo")) continue;
        var fields = std.mem.tokenizeAny(u8, line[separator + 1 ..], " \t");
        var index: usize = 0;
        while (fields.next()) |field| : (index += 1) {
            if (index == 0) counters.receive_bytes +|= std.fmt.parseInt(u64, field, 10) catch 0;
            if (index == 8) counters.transmit_bytes +|= std.fmt.parseInt(u64, field, 10) catch 0;
        }
    }
    return counters;
}

fn macosNetworkCounters(allocator: std.mem.Allocator, io: Io) ?NetworkCounters {
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "netstat", "-ibn" },
        .stdout_limit = .limited(4 * 1024 * 1024),
        .stderr_limit = .limited(64 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = Io.Duration.fromSeconds(2) } },
    }) catch return null;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    if (!processSucceeded(result.term)) return null;
    var totals = std.StringHashMap(NetworkCounters).init(allocator);
    defer totals.deinit();
    var lines = std.mem.splitScalar(u8, result.stdout, '\n');
    while (lines.next()) |line| {
        var fields = std.mem.tokenizeAny(u8, line, " \t");
        const name = fields.next() orelse continue;
        if (std.mem.eql(u8, name, "Name") or std.mem.eql(u8, name, "lo0")) continue;
        var values: [10][]const u8 = undefined;
        var count: usize = 0;
        values[count] = name;
        count += 1;
        while (fields.next()) |field| {
            if (count >= values.len) break;
            values[count] = field;
            count += 1;
        }
        if (count < 10) continue;
        const receive = std.fmt.parseInt(u64, values[count - 4], 10) catch continue;
        const transmit = std.fmt.parseInt(u64, values[count - 1], 10) catch continue;
        const entry = totals.getOrPut(name) catch return null;
        if (!entry.found_existing) entry.value_ptr.* = .{ .receive_bytes = receive, .transmit_bytes = transmit } else {
            entry.value_ptr.receive_bytes = @max(entry.value_ptr.receive_bytes, receive);
            entry.value_ptr.transmit_bytes = @max(entry.value_ptr.transmit_bytes, transmit);
        }
    }
    var counters = NetworkCounters{ .receive_bytes = 0, .transmit_bytes = 0 };
    var iterator = totals.valueIterator();
    while (iterator.next()) |value| {
        counters.receive_bytes +|= value.receive_bytes;
        counters.transmit_bytes +|= value.transmit_bytes;
    }
    return counters;
}

fn processSucceeded(term: std.process.Child.Term) bool {
    return switch (term) {
        .exited => |code| code == 0,
        else => false,
    };
}

pub fn devicePayload(allocator: std.mem.Allocator, io: Io, system: *const system_info.Snapshot) ![]u8 {
    var collection = try collect(allocator, io, system);
    defer collection.deinit();
    const Accelerator = struct {
        id: []const u8,
        index: usize,
        vendor: []const u8,
        name: []const u8,
        accelerator: []const u8,
        memoryTotalBytes: u64,
        memoryUsedBytes: u64,
        unifiedMemory: bool,
        utilizationPct: ?f64,
        temperatureC: ?f64,
        powerWatts: ?f64,
        powerLimitWatts: ?f64,
        driver: ?u8 = null,
    };
    var accelerators: std.ArrayList(Accelerator) = .empty;
    defer accelerators.deinit(allocator);
    for (collection.gpus) |gpu| {
        const vendor: []const u8 = if (gpu.memory_shared) "apple" else "nvidia";
        const id = gpu.id orelse gpu.uuid orelse gpu.pci_bus_id orelse try std.fmt.allocPrint(collection.arena.allocator(), "{s}:{d}", .{ vendor, gpu.index });
        try accelerators.append(allocator, .{
            .id = id,
            .index = gpu.index,
            .vendor = vendor,
            .name = gpu.name,
            .accelerator = if (gpu.memory_shared) "metal" else "cuda",
            .memoryTotalBytes = gpu.memory_total_mb * 1024 * 1024,
            .memoryUsedBytes = if (gpu.memory_usage_available) gpu.memory_used_mb * 1024 * 1024 else 0,
            .unifiedMemory = gpu.memory_shared,
            .utilizationPct = if (gpu.utilization_available) gpu.utilization_pct else null,
            .temperatureC = if (gpu.temperature_available) gpu.temp_c else null,
            .powerWatts = if (gpu.power_available) gpu.power_draw else null,
            .powerLimitWatts = if (gpu.power_available) gpu.power_limit else null,
        });
    }
    const Host = struct {
        cpuModel: []const u8,
        cpuCount: usize,
        memoryTotalBytes: u64,
        memoryAvailableBytes: u64,
        swapTotalBytes: ?u64,
        platform: []const u8,
        arch: []const u8,
        release: []const u8,
        uptimeSeconds: u64,
    };
    const capabilities: []const []const u8 = if (accelerators.items.len == 0)
        &.{"hostMemory"}
    else if (system.apple_silicon)
        &.{ "memory", "hostMemory" }
    else
        &.{ "memory", "utilization", "temperature", "power", "hostMemory" };
    var timestamp_buffer: [24]u8 = undefined;
    const Payload = struct {
        sampledAt: []const u8,
        accelerators: []const Accelerator,
        host: Host,
        storage: []const std.json.Value = &.{},
        thermals: []const std.json.Value = &.{},
        capabilities: []const []const u8,
    };
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(Payload{
        .sampledAt = formatTimestamp(io, &timestamp_buffer),
        .accelerators = accelerators.items,
        .host = .{
            .cpuModel = system.cpu_model orelse "unknown",
            .cpuCount = system.cpu_cores,
            .memoryTotalBytes = system.memory_total_bytes,
            .memoryAvailableBytes = availableMemory(allocator, io, system.memory_total_bytes),
            .swapTotalBytes = swapTotal(allocator, io),
            .platform = if (builtin.os.tag == .macos) "darwin" else "linux",
            .arch = if (builtin.cpu.arch == .aarch64) "arm64" else "x64",
            .release = system.release,
            .uptimeSeconds = uptime(allocator, io),
        },
        .capabilities = capabilities,
    }, .{}, &output.writer);
    return try output.toOwnedSlice();
}

fn collect(allocator: std.mem.Allocator, io: Io, system: *const system_info.Snapshot) !Collection {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    const storage = arena.allocator();
    if (system.apple_silicon) {
        const gpus = try storage.alloc(Gpu, 1);
        gpus[0] = .{
            .id = "apple-metal-0",
            .index = 0,
            .name = try std.fmt.allocPrint(storage, "{s} GPU", .{system.cpu_model orelse "Apple Silicon"}),
            .memory_total_mb = system.memory_total_bytes / (1024 * 1024),
            .memory_used_mb = 0,
            .memory_free_mb = system.memory_total_bytes / (1024 * 1024),
            .utilization_pct = 0,
            .temp_c = 0,
            .power_draw = 0,
            .power_limit = 0,
            .memory_shared = true,
            .memory_usage_available = false,
            .utilization_available = false,
            .temperature_available = false,
            .power_available = false,
        };
        return .{ .arena = arena, .gpus = gpus };
    }
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "nvidia-smi", "--query-gpu=uuid,pci.bus_id,name,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw,power.limit", "--format=csv,noheader,nounits" },
        .stdout_limit = .limited(4 * 1024 * 1024),
        .stderr_limit = .limited(64 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = Io.Duration.fromSeconds(5) } },
    }) catch return .{ .arena = arena, .gpus = &.{} };
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code != 0) return .{ .arena = arena, .gpus = &.{} },
        else => return .{ .arena = arena, .gpus = &.{} },
    }
    var gpus: std.ArrayList(Gpu) = .empty;
    var lines = std.mem.splitScalar(u8, result.stdout, '\n');
    while (lines.next()) |raw_line| {
        const line = std.mem.trim(u8, raw_line, " \t\r");
        if (line.len == 0) continue;
        var fields: [10][]const u8 = undefined;
        var parts = std.mem.splitScalar(u8, line, ',');
        var field_index: usize = 0;
        while (parts.next()) |part| {
            if (field_index >= fields.len) break;
            fields[field_index] = std.mem.trim(u8, part, " \t\r");
            field_index += 1;
        }
        if (field_index != fields.len) continue;
        try gpus.append(storage, .{
            .uuid = try ownedIdentity(storage, fields[0]),
            .pci_bus_id = try ownedIdentity(storage, fields[1]),
            .index = gpus.items.len,
            .name = if (fields[2].len > 0) try storage.dupe(u8, fields[2]) else "Unknown",
            .memory_total_mb = megabytes(fields[3]),
            .memory_used_mb = megabytes(fields[4]),
            .memory_free_mb = megabytes(fields[5]),
            .utilization_pct = number(fields[6]),
            .temp_c = number(fields[7]),
            .power_draw = number(fields[8]),
            .power_limit = number(fields[9]),
        });
    }
    return .{ .arena = arena, .gpus = try gpus.toOwnedSlice(storage) };
}

fn stringifyPayload(allocator: std.mem.Allocator, gpus: []const Gpu) ![]u8 {
    const Payload = struct {
        count: usize,
        gpus: []const Gpu,
    };
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(Payload{ .count = gpus.len, .gpus = gpus }, .{}, &output.writer);
    return try output.toOwnedSlice();
}

fn ownedIdentity(allocator: std.mem.Allocator, value: []const u8) !?[]const u8 {
    if (value.len == 0 or std.ascii.eqlIgnoreCase(value, "N/A") or std.ascii.eqlIgnoreCase(value, "[Not Supported]")) return null;
    return try allocator.dupe(u8, value);
}

fn number(value: []const u8) f64 {
    return std.fmt.parseFloat(f64, value) catch 0;
}

fn megabytes(value: []const u8) u64 {
    const parsed = number(value);
    if (parsed <= 0) return 0;
    return @intFromFloat(@round(parsed));
}

fn availableMemory(allocator: std.mem.Allocator, io: Io, fallback: u64) u64 {
    if (builtin.os.tag == .linux) return linuxMemoryField(allocator, io, "MemAvailable") orelse fallback;
    if (builtin.os.tag != .macos) return fallback;
    const result = std.process.run(allocator, io, .{
        .argv = &.{"vm_stat"},
        .stdout_limit = .limited(64 * 1024),
        .stderr_limit = .limited(64 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = Io.Duration.fromSeconds(2) } },
    }) catch return fallback;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    const page_size = parseFirstUnsignedAfter(result.stdout, "page size of ") orelse 16_384;
    const free = parseFirstUnsignedAfter(result.stdout, "Pages free:") orelse 0;
    const inactive = parseFirstUnsignedAfter(result.stdout, "Pages inactive:") orelse 0;
    const speculative = parseFirstUnsignedAfter(result.stdout, "Pages speculative:") orelse 0;
    const purgeable = parseFirstUnsignedAfter(result.stdout, "Pages purgeable:") orelse 0;
    const available = (free +| inactive +| speculative +| purgeable) *| page_size;
    return if (available > 0) available else fallback;
}

fn swapTotal(allocator: std.mem.Allocator, io: Io) ?u64 {
    if (builtin.os.tag != .linux) return null;
    return linuxMemoryField(allocator, io, "SwapTotal");
}

fn linuxMemoryField(allocator: std.mem.Allocator, io: Io, field: []const u8) ?u64 {
    const document = std.Io.Dir.cwd().readFileAlloc(io, "/proc/meminfo", allocator, .limited(1024 * 1024)) catch return null;
    defer allocator.free(document);
    var lines = std.mem.splitScalar(u8, document, '\n');
    while (lines.next()) |line| {
        if (!std.mem.startsWith(u8, line, field)) continue;
        const colon = std.mem.indexOfScalar(u8, line, ':') orelse return null;
        var fields = std.mem.tokenizeAny(u8, line[colon + 1 ..], " \t");
        const kilobytes = std.fmt.parseInt(u64, fields.next() orelse return null, 10) catch return null;
        return kilobytes *| 1024;
    }
    return null;
}

fn uptime(allocator: std.mem.Allocator, io: Io) u64 {
    if (builtin.os.tag == .linux) {
        const document = std.Io.Dir.cwd().readFileAlloc(io, "/proc/uptime", allocator, .limited(4096)) catch return 0;
        defer allocator.free(document);
        const first = std.mem.indexOfScalar(u8, document, ' ') orelse document.len;
        const seconds = std.fmt.parseFloat(f64, document[0..first]) catch return 0;
        return if (seconds > 0) @intFromFloat(@round(seconds)) else 0;
    }
    if (builtin.os.tag != .macos) return 0;
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "sysctl", "-n", "kern.boottime" },
        .stdout_limit = .limited(4096),
        .stderr_limit = .limited(4096),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = Io.Duration.fromSeconds(2) } },
    }) catch return 0;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    const boot = parseFirstUnsignedAfter(result.stdout, "sec =") orelse return 0;
    const now = Io.Clock.real.now(io).toSeconds();
    if (now <= boot) return 0;
    return @intCast(now - @as(i64, @intCast(boot)));
}

fn parseFirstUnsignedAfter(document: []const u8, marker: []const u8) ?u64 {
    const marker_start = std.mem.indexOf(u8, document, marker) orelse return null;
    const suffix = std.mem.trimStart(u8, document[marker_start + marker.len ..], " \t");
    var end: usize = 0;
    while (end < suffix.len and std.ascii.isDigit(suffix[end])) : (end += 1) {}
    if (end == 0) return null;
    return std.fmt.parseInt(u64, suffix[0..end], 10) catch null;
}

fn formatTimestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds, 0)) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{
        year_day.year,
        month_day.month.numeric(),
        month_day.day_index + 1,
        day_seconds.getHoursIntoDay(),
        day_seconds.getMinutesIntoHour(),
        day_seconds.getSecondsIntoMinute(),
    }) catch unreachable;
}
