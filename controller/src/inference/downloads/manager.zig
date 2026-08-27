const std = @import("std");
const config_module = @import("../../app/config.zig");
const downloads = @import("store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const huggingface = @import("huggingface.zig");
const records = @import("records.zig");
const download_targets = @import("targets.zig");

const Io = std.Io;
const max_active_downloads = 8;
const max_download_record_bytes = 8 * 1024 * 1024;
const progress_interval = Io.Duration.fromMilliseconds(750);

pub const Request = struct {
    model_id: []const u8,
    revision: ?[]const u8,
    destination_dir: ?[]const u8,
    allow_patterns: []const []const u8,
    ignore_patterns: []const []const u8,
    token: ?[]const u8,
};

pub const Action = union(enum) {
    payload: []u8,
    conflict: []u8,

    pub fn deinit(action: *Action, allocator: std.mem.Allocator) void {
        switch (action.*) {
            .payload, .conflict => |value| allocator.free(value),
        }
        action.* = undefined;
    }
};

const Reservation = struct {
    allocator: std.mem.Allocator,
    key: []u8,
    target: []u8,
    download_id: []u8,

    fn deinit(reservation: *Reservation) void {
        reservation.allocator.free(reservation.key);
        reservation.allocator.free(reservation.target);
        reservation.allocator.free(reservation.download_id);
        reservation.allocator.destroy(reservation);
    }
};

const Active = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    token: ?[]u8,
    reservation: *Reservation,
    group: Io.Group = .init,
    cancel_requested: std.atomic.Value(bool) = .init(false),
    handles: usize = 0,
    finished: bool = false,

    fn deinit(active: *Active) void {
        active.allocator.free(active.id);
        if (active.token) |value| active.allocator.free(value);
        active.reservation.deinit();
        active.allocator.destroy(active);
    }
};

pub const State = struct {
    allocator: std.mem.Allocator,
    io: Io,
    mutex: Io.Mutex = .init,
    reservations: std.ArrayListUnmanaged(*Reservation) = .empty,
    active: std.StringHashMapUnmanaged(*Active) = .empty,
    retired: std.ArrayListUnmanaged(*Active) = .empty,

    pub fn init(allocator: std.mem.Allocator, io: Io) State {
        return .{ .allocator = allocator, .io = io };
    }

    pub fn deinit(state: *State) void {
        state.mutex.lock(state.io) catch return;
        var owners: [max_active_downloads * 2]*Active = undefined;
        var count: usize = 0;
        var iterator = state.active.valueIterator();
        while (iterator.next()) |owner| {
            if (count == owners.len) @panic("download owner bound exceeded");
            owners[count] = owner.*;
            count += 1;
        }
        for (state.retired.items) |owner| {
            if (count == owners.len) @panic("download owner bound exceeded");
            owners[count] = owner;
            count += 1;
        }
        var orphans: [max_active_downloads]*Reservation = undefined;
        var orphan_count: usize = 0;
        for (state.reservations.items) |reservation| {
            var owned = false;
            for (owners[0..count]) |owner| if (owner.reservation == reservation) {
                owned = true;
                break;
            };
            if (owned) continue;
            if (orphan_count == orphans.len) @panic("download reservation bound exceeded");
            orphans[orphan_count] = reservation;
            orphan_count += 1;
        }
        state.active.clearRetainingCapacity();
        state.retired.clearRetainingCapacity();
        state.reservations.clearRetainingCapacity();
        state.mutex.unlock(state.io);
        for (owners[0..count]) |owner| owner.cancel_requested.store(true, .release);
        for (owners[0..count]) |owner| owner.group.cancel(state.io);
        for (owners[0..count]) |owner| owner.deinit();
        for (orphans[0..orphan_count]) |reservation| reservation.deinit();
        state.active.deinit(state.allocator);
        state.retired.deinit(state.allocator);
        state.reservations.deinit(state.allocator);
        state.* = undefined;
    }

    pub fn startPayload(state: *State, configuration: *const config_module.Config, client: *std.http.Client, database: *sqlite.Database, models_dir: []const u8, request: Request) !Action {
        const model_id = std.mem.trim(u8, request.model_id, " \t\r\n");
        if (model_id.len == 0) return error.ModelIdRequired;
        if (model_id.len > 2048) return error.InvalidDownloadField;
        if (request.destination_dir) |value| if (value.len > 2048) return error.InvalidDownloadField;
        try state.pruneRetired();
        const id = try randomId(state.allocator, state.io);
        defer state.allocator.free(id);
        const target = try download_targets.resolve(state.allocator, state.io, models_dir, model_id, request.destination_dir);
        defer state.allocator.free(target);
        const reservation_result = try state.acquireReservation(target, id);
        const reservation = switch (reservation_result) {
            .acquired => |value| value,
            .conflict => |detail| return .{ .conflict = detail },
        };
        var reservation_transferred = false;
        defer if (!reservation_transferred) state.releaseReservation(reservation);
        _ = try Io.Dir.cwd().createDirPathStatus(state.io, models_dir, @enumFromInt(0o700));
        try Io.Dir.accessAbsolute(state.io, models_dir, .{ .write = true });
        const default_ignores = [_][]const u8{ ".gitattributes", ".gitignore" };
        const ignores = try state.allocator.alloc([]const u8, default_ignores.len + request.ignore_patterns.len);
        defer state.allocator.free(ignores);
        for (default_ignores, 0..) |value, index| ignores[index] = value;
        for (request.ignore_patterns, default_ignores.len..) |value, index| ignores[index] = value;
        var selection = try huggingface.select(state.allocator, state.io, client, configuration.environment, model_id, request.revision, request.token, request.allow_patterns, ignores);
        defer selection.deinit();
        const file_paths = try state.allocator.alloc([]const u8, selection.files.len);
        defer state.allocator.free(file_paths);
        for (selection.files, file_paths) |file, *path| path.* = file.path;
        const reusable = reusable: {
            try database.lock(state.io);
            defer database.unlock(state.io);
            break :reusable try downloads.findReusablePayload(state.allocator, database, model_id, target, file_paths);
        };
        if (reusable) |payload| {
            defer state.allocator.free(payload);
            return .{ .payload = try records.envelope(state.allocator, payload) };
        }
        const now = try records.timestamp(state.allocator, state.io);
        defer state.allocator.free(now);
        const data = try records.create(state.allocator, id, model_id, selection.revision, target, now, selection.files);
        defer state.allocator.free(data);
        if (data.len > max_download_record_bytes) return error.DownloadRecordTooLarge;
        {
            try database.lock(state.io);
            defer database.unlock(state.io);
            try downloads.save(database, id, data);
        }
        const response = try records.envelope(state.allocator, data);
        errdefer state.allocator.free(response);
        const owner = try state.createActive(id, request.token, reservation);
        reservation_transferred = true;
        errdefer owner.deinit();
        errdefer state.removeFailedActive(owner);
        try state.installActive(owner);
        owner.group.concurrent(state.io, runDownload, .{ state, configuration, client, database, owner }) catch |failure| {
            state.removeFailedActive(owner);
            return failure;
        };
        return .{ .payload = response };
    }

    pub fn pausePayload(state: *State, database: *sqlite.Database, id: []const u8) !?[]u8 {
        const payload = try records.setStatus(state.allocator, state.io, database, id, "paused", null) orelse return null;
        defer state.allocator.free(payload);
        try state.cancelActive(id);
        return try records.envelope(state.allocator, payload);
    }

    pub fn cancelPayload(state: *State, database: *sqlite.Database, id: []const u8) !?[]u8 {
        const payload = try records.setStatus(state.allocator, state.io, database, id, "canceled", null) orelse return null;
        defer state.allocator.free(payload);
        try state.cancelActive(id);
        return try records.envelope(state.allocator, payload);
    }

    pub fn resumePayload(state: *State, configuration: *const config_module.Config, client: *std.http.Client, database: *sqlite.Database, id: []const u8, token: ?[]const u8) !?Action {
        try state.pruneRetired();
        const current = current: {
            try database.lock(state.io);
            defer database.unlock(state.io);
            break :current try downloads.getPayload(state.allocator, database, id);
        } orelse return null;
        defer state.allocator.free(current);
        var parsed = try std.json.parseFromSlice(std.json.Value, state.allocator, current, .{});
        defer parsed.deinit();
        const object = parsed.value.object;
        if (std.mem.eql(u8, object.get("status").?.string, "completed")) return .{ .payload = try records.envelope(state.allocator, current) };
        const target = object.get("target_dir").?.string;
        const reservation_result = try state.acquireReservation(target, id);
        const reservation = switch (reservation_result) {
            .acquired => |value| value,
            .conflict => |detail| return .{ .conflict = detail },
        };
        var reservation_transferred = false;
        defer if (!reservation_transferred) state.releaseReservation(reservation);
        const queued = try records.setStatus(state.allocator, state.io, database, id, "queued", "") orelse return null;
        defer state.allocator.free(queued);
        const response = try records.envelope(state.allocator, queued);
        errdefer state.allocator.free(response);
        const owner = try state.createActive(id, token, reservation);
        reservation_transferred = true;
        errdefer owner.deinit();
        errdefer state.removeFailedActive(owner);
        try state.installActive(owner);
        owner.group.concurrent(state.io, runDownload, .{ state, configuration, client, database, owner }) catch |failure| {
            state.removeFailedActive(owner);
            return failure;
        };
        return .{ .payload = response };
    }

    fn acquireReservation(state: *State, target: []const u8, id: []const u8) !ReserveResult {
        const key = try download_targets.physicalKey(state.allocator, state.io, target);
        errdefer state.allocator.free(key);
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        if (state.reservations.items.len >= max_active_downloads) return error.TooManyActiveDownloads;
        for (state.reservations.items) |reservation| if (download_targets.contains(reservation.key, key) or download_targets.contains(key, reservation.key)) {
            const detail = try std.fmt.allocPrint(state.allocator, "Download target \"{s}\" is reserved by active download {s}", .{ target, reservation.download_id });
            state.allocator.free(key);
            return .{ .conflict = detail };
        };
        const target_copy = try state.allocator.dupe(u8, target);
        errdefer state.allocator.free(target_copy);
        const id_copy = try state.allocator.dupe(u8, id);
        errdefer state.allocator.free(id_copy);
        const reservation = try state.allocator.create(Reservation);
        errdefer state.allocator.destroy(reservation);
        reservation.* = .{ .allocator = state.allocator, .key = key, .target = target_copy, .download_id = id_copy };
        try state.reservations.append(state.allocator, reservation);
        return .{ .acquired = reservation };
    }

    fn releaseReservation(state: *State, reservation: *Reservation) void {
        state.mutex.lock(state.io) catch return;
        for (state.reservations.items, 0..) |candidate, index| if (candidate == reservation) {
            _ = state.reservations.swapRemove(index);
            break;
        };
        state.mutex.unlock(state.io);
        reservation.deinit();
    }

    fn createActive(state: *State, id: []const u8, token: ?[]const u8, reservation: *Reservation) !*Active {
        const id_copy = try state.allocator.dupe(u8, id);
        errdefer state.allocator.free(id_copy);
        const token_copy = if (token) |value| try state.allocator.dupe(u8, value) else null;
        errdefer if (token_copy) |value| state.allocator.free(value);
        const owner = try state.allocator.create(Active);
        errdefer state.allocator.destroy(owner);
        owner.* = .{
            .allocator = state.allocator,
            .id = id_copy,
            .token = token_copy,
            .reservation = reservation,
        };
        return owner;
    }

    fn installActive(state: *State, owner: *Active) !void {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const entry = try state.active.getOrPut(state.allocator, owner.id);
        if (entry.found_existing) return error.DownloadAlreadyActive;
        entry.value_ptr.* = owner;
    }

    fn removeFailedActive(state: *State, owner: *Active) void {
        state.mutex.lock(state.io) catch return;
        if (state.active.get(owner.id) == owner) _ = state.active.remove(owner.id);
        for (state.reservations.items, 0..) |reservation, index| if (reservation == owner.reservation) {
            _ = state.reservations.swapRemove(index);
            break;
        };
        state.mutex.unlock(state.io);
    }

    fn cancelActive(state: *State, id: []const u8) !void {
        try state.mutex.lock(state.io);
        const owner = state.active.get(id) orelse {
            state.mutex.unlock(state.io);
            return;
        };
        owner.handles += 1;
        owner.cancel_requested.store(true, .release);
        state.mutex.unlock(state.io);
        owner.group.cancel(state.io);
        try state.mutex.lock(state.io);
        owner.handles -= 1;
        state.mutex.unlock(state.io);
        try state.pruneRetired();
    }

    fn retire(state: *State, owner: *Active) void {
        const previous = state.io.swapCancelProtection(.blocked);
        defer _ = state.io.swapCancelProtection(previous);
        state.mutex.lock(state.io) catch return;
        defer state.mutex.unlock(state.io);
        state.retired.ensureUnusedCapacity(state.allocator, 1) catch {
            owner.finished = true;
            return;
        };
        if (state.active.get(owner.id) == owner) _ = state.active.remove(owner.id);
        for (state.reservations.items, 0..) |reservation, index| if (reservation == owner.reservation) {
            _ = state.reservations.swapRemove(index);
            break;
        };
        owner.finished = true;
        state.retired.appendAssumeCapacity(owner);
    }

    fn pruneRetired(state: *State) !void {
        var ready: std.ArrayList(*Active) = .empty;
        defer ready.deinit(state.allocator);
        try state.mutex.lock(state.io);
        var locked = true;
        defer if (locked) state.mutex.unlock(state.io);
        var index: usize = 0;
        while (index < state.retired.items.len) {
            const owner = state.retired.items[index];
            if (!owner.finished or owner.handles > 0) {
                index += 1;
                continue;
            }
            try ready.append(state.allocator, owner);
            _ = state.retired.swapRemove(index);
        }
        state.mutex.unlock(state.io);
        locked = false;
        for (ready.items) |owner| {
            owner.group.cancel(state.io);
            owner.deinit();
        }
    }
};

const ReserveResult = union(enum) {
    acquired: *Reservation,
    conflict: []u8,
};

fn runDownload(state: *State, configuration: *const config_module.Config, client: *std.http.Client, database: *sqlite.Database, owner: *Active) void {
    defer state.retire(owner);
    runDownloadInner(state, configuration, client, database, owner) catch |failure| {
        if (failure != error.Canceled and !owner.cancel_requested.load(.acquire)) {
            const detail = @errorName(failure);
            if (records.setFailureUnlessStopped(state.allocator, state.io, database, owner.id, detail)) |payload| {
                if (payload) |data| {
                    state.allocator.free(data);
                    std.log.err("model download {s} failed: {t}", .{ owner.id, failure });
                }
            } else |_| {
                std.log.err("model download {s} failed: {t}", .{ owner.id, failure });
            }
        }
    };
}

fn runDownloadInner(state: *State, configuration: *const config_module.Config, client: *std.http.Client, database: *sqlite.Database, owner: *Active) !void {
    if (!try records.begin(state.allocator, state.io, database, owner.id)) return;
    const target = try records.targetFor(state.allocator, state.io, database, owner.id);
    defer state.allocator.free(target);
    _ = try Io.Dir.cwd().createDirPathStatus(state.io, target, @enumFromInt(0o700));
    while (try records.nextFile(state.allocator, state.io, database, owner.id)) |file_value| {
        var file = file_value;
        defer file.deinit();
        try downloadFile(state, configuration, client, database, owner, target, &file);
    }
    const completed = try records.allFilesComplete(state.allocator, state.io, database, owner.id);
    const final_payload = try records.setStatus(state.allocator, state.io, database, owner.id, if (completed) "completed" else "failed", if (completed) "" else "Download incomplete") orelse return;
    state.allocator.free(final_payload);
    if (completed) try records.setCompletedAt(state.allocator, state.io, database, owner.id);
}

fn downloadFile(state: *State, configuration: *const config_module.Config, client: *std.http.Client, database: *sqlite.Database, owner: *Active, target: []const u8, file: *records.FileSnapshot) !void {
    const relative = try download_targets.sanitizedRelative(state.allocator, file.path);
    defer state.allocator.free(relative);
    const local_path = try std.fs.path.resolve(state.allocator, &.{ target, relative });
    defer state.allocator.free(local_path);
    if (!download_targets.contains(target, local_path) or std.mem.eql(u8, target, local_path)) return error.InvalidDownloadFilePath;
    const physical_target = try download_targets.physicalKey(state.allocator, state.io, target);
    defer state.allocator.free(physical_target);
    const physical_local = try download_targets.physicalKey(state.allocator, state.io, local_path);
    defer state.allocator.free(physical_local);
    if (!download_targets.contains(physical_target, physical_local) or std.mem.eql(u8, physical_target, physical_local)) return error.InvalidDownloadFilePath;
    const part_path = try std.fmt.allocPrint(state.allocator, "{s}.part", .{local_path});
    defer state.allocator.free(part_path);
    const parent = std.fs.path.dirname(local_path) orelse return error.InvalidDownloadFilePath;
    _ = try Io.Dir.cwd().createDirPathStatus(state.io, parent, @enumFromInt(0o700));
    const final_size = fileSize(state.io, local_path) catch |failure| switch (failure) {
        error.FileNotFound => null,
        else => return failure,
    };
    if (file.size_bytes) |expected| if (final_size != null and final_size.? >= expected) {
        try records.updateFile(state.allocator, state.io, database, owner.id, file.path, "completed", expected, file.size_bytes);
        return;
    };
    const existing = fileSize(state.io, part_path) catch |failure| switch (failure) {
        error.FileNotFound => 0,
        else => return failure,
    } orelse 0;
    try records.updateFile(state.allocator, state.io, database, owner.id, file.path, "downloading", existing, file.size_bytes);
    var model = try records.modelReference(state.allocator, state.io, database, owner.id);
    defer model.deinit();
    var url: Io.Writer.Allocating = .init(state.allocator);
    defer url.deinit();
    const origin_value = configuration.environment.get("LOCAL_STUDIO_HF_ORIGIN") orelse "https://huggingface.co";
    const origin = std.mem.trimEnd(u8, std.mem.trim(u8, origin_value, " \t\r\n"), "/");
    try url.writer.print("{s}/", .{origin});
    try huggingface.writePath(&url.writer, model.model_id);
    try url.writer.writeAll("/resolve/");
    try huggingface.writeQueryValue(&url.writer, model.revision orelse "main");
    try url.writer.writeByte('/');
    try huggingface.writePath(&url.writer, file.path);
    const uri = try std.Uri.parse(url.writer.buffered());
    try transferFile(state, client, database, owner, file, local_path, part_path, uri, owner.token, existing, 5);
}

fn transferFile(state: *State, client: *std.http.Client, database: *sqlite.Database, owner: *Active, file: *records.FileSnapshot, local_path: []const u8, part_path: []const u8, uri: std.Uri, token: ?[]const u8, existing: u64, redirects_remaining: u8) !void {
    var header_storage: [2]std.http.Header = undefined;
    var header_count: usize = 0;
    var authorization: ?[]u8 = null;
    defer if (authorization) |value| state.allocator.free(value);
    if (token) |value| {
        authorization = try std.fmt.allocPrint(state.allocator, "Bearer {s}", .{value});
        header_storage[header_count] = .{ .name = "Authorization", .value = authorization.? };
        header_count += 1;
    }
    var range: ?[]u8 = null;
    defer if (range) |value| state.allocator.free(value);
    if (existing > 0) {
        range = try std.fmt.allocPrint(state.allocator, "bytes={d}-", .{existing});
        header_storage[header_count] = .{ .name = "Range", .value = range.? };
        header_count += 1;
    }
    var request = try client.request(.GET, uri, .{
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .authorization = .omit, .accept_encoding = .omit },
        .extra_headers = header_storage[0..header_count],
    });
    defer request.deinit();
    try request.sendBodiless();
    var response = try request.receiveHead(&.{});
    if (response.head.status.class() == .redirect) {
        if (redirects_remaining == 0) return error.TooManyDownloadRedirects;
        const location = response.head.location orelse return error.DownloadRedirectMissing;
        if (location.len > 8 * 1024) return error.DownloadRedirectTooLong;
        var resolution_buffer: [16 * 1024]u8 = undefined;
        @memcpy(resolution_buffer[0..location.len], location);
        var resolution_slice: []u8 = &resolution_buffer;
        const next_uri = try uri.resolveInPlace(location.len, &resolution_slice);
        var discard_buffer: [1024]u8 = undefined;
        const redirect_body = response.reader(&discard_buffer);
        _ = try redirect_body.discardRemaining();
        const next_token = if (sameOrigin(uri, next_uri)) token else null;
        return transferFile(state, client, database, owner, file, local_path, part_path, next_uri, next_token, existing, redirects_remaining - 1);
    }
    if (response.head.status == .range_not_satisfiable) {
        if (file.size_bytes) |expected| if (existing >= expected) {
            try Io.Dir.renameAbsolute(part_path, local_path, state.io);
            try records.updateFile(state.allocator, state.io, database, owner.id, file.path, "completed", expected, file.size_bytes);
            return;
        };
        return error.DownloadRangeNotSatisfiable;
    }
    if (response.head.status != .ok and response.head.status != .partial_content) return error.DownloadRequestFailed;
    const append = existing > 0 and response.head.status == .partial_content;
    const base_existing = if (append) existing else 0;
    var size_bytes = file.size_bytes;
    if (size_bytes == null) {
        if (response.head.content_length) |length| size_bytes = length +| base_existing;
    }
    if (!append and existing > 0) try records.updateFile(state.allocator, state.io, database, owner.id, file.path, "downloading", 0, size_bytes);
    var output_file = try Io.Dir.cwd().createFile(state.io, part_path, .{ .truncate = !append, .permissions = @enumFromInt(0o600) });
    defer output_file.close(state.io);
    var write_buffer: [64 * 1024]u8 = undefined;
    var writer = output_file.writer(state.io, &write_buffer);
    if (append) try writer.seekTo(existing);
    var read_buffer: [64 * 1024]u8 = undefined;
    const reader = response.reader(&read_buffer);
    var downloaded = base_existing;
    var last_update = Io.Clock.awake.now(state.io);
    while (true) {
        const amount = reader.stream(&writer.interface, .limited(64 * 1024)) catch |failure| switch (failure) {
            error.EndOfStream => break,
            else => return failure,
        };
        downloaded +|= amount;
        const now = Io.Clock.awake.now(state.io);
        if (last_update.durationTo(now).toNanoseconds() < progress_interval.toNanoseconds()) continue;
        try writer.interface.flush();
        try records.updateFile(state.allocator, state.io, database, owner.id, file.path, "downloading", downloaded, size_bytes);
        last_update = now;
    }
    try writer.interface.flush();
    if (size_bytes) |expected| if (downloaded < expected) {
        try records.updateFile(state.allocator, state.io, database, owner.id, file.path, "error", downloaded, size_bytes);
        return error.IncompleteDownload;
    };
    try Io.Dir.renameAbsolute(part_path, local_path, state.io);
    try records.updateFile(state.allocator, state.io, database, owner.id, file.path, "completed", downloaded, size_bytes);
}

fn sameOrigin(first: std.Uri, second: std.Uri) bool {
    if (!std.ascii.eqlIgnoreCase(first.scheme, second.scheme)) return false;
    var first_buffer: [Io.net.HostName.max_len]u8 = undefined;
    var second_buffer: [Io.net.HostName.max_len]u8 = undefined;
    const first_host = first.getHost(&first_buffer) catch return false;
    const second_host = second.getHost(&second_buffer) catch return false;
    if (!std.ascii.eqlIgnoreCase(first_host.bytes, second_host.bytes)) return false;
    return effectivePort(first) == effectivePort(second);
}

fn effectivePort(uri: std.Uri) ?u16 {
    if (uri.port) |port| return port;
    if (std.ascii.eqlIgnoreCase(uri.scheme, "https")) return 443;
    if (std.ascii.eqlIgnoreCase(uri.scheme, "http")) return 80;
    return null;
}

fn fileSize(io: Io, path: []const u8) !?u64 {
    const stat = try Io.Dir.cwd().statFile(io, path, .{});
    if (stat.kind != .file) return error.NotAFile;
    return stat.size;
}

fn randomId(allocator: std.mem.Allocator, io: Io) ![]u8 {
    var bytes: [16]u8 = undefined;
    io.random(&bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return std.fmt.allocPrint(allocator, "{x:0>2}{x:0>2}{x:0>2}{x:0>2}-{x:0>2}{x:0>2}-{x:0>2}{x:0>2}-{x:0>2}{x:0>2}-{x:0>2}{x:0>2}{x:0>2}{x:0>2}{x:0>2}{x:0>2}", .{ bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15] });
}
