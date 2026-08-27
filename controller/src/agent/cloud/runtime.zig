const std = @import("std");
const account_repository = @import("../../accounts/store.zig");
const config = @import("../../app/config.zig");
const cloud_store = @import("store.zig");
const cloud_types = @import("types.zig");
const daytona = @import("daytona.zig");
const vercel = @import("vercel.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;
const http = std.http;

pub const Provider = enum { daytona, vercel };

pub const Selection = struct {
    allocator: std.mem.Allocator,
    provider: Provider,
    profile_id: []u8,
    artifact: []u8,
    vcpus: u8,
    memory_gib: u16,
    storage_gib: ?u16,

    pub fn deinit(selection: *Selection) void {
        selection.allocator.free(selection.profile_id);
        selection.allocator.free(selection.artifact);
        selection.* = undefined;
    }
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []u8,
    daytona: daytona.Manager,
    vercel: vercel.Manager,
    lifecycle_mutex: Io.Mutex = .init,

    pub fn init(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) !Manager {
        var daytona_manager = try daytona.Manager.init(allocator, io, configuration.data_dir, configuration.environment, configuration.port, configuration.api_key);
        errdefer daytona_manager.deinit();
        var vercel_manager = try vercel.Manager.init(allocator, io, configuration.data_dir, configuration.environment);
        errdefer vercel_manager.deinit();
        return .{
            .allocator = allocator,
            .io = io,
            .data_dir = try allocator.dupe(u8, configuration.data_dir),
            .daytona = daytona_manager,
            .vercel = vercel_manager,
        };
    }

    pub fn deinit(manager: *Manager) void {
        manager.daytona.deinit();
        manager.vercel.deinit();
        manager.allocator.free(manager.data_dir);
        manager.* = undefined;
    }

    pub fn selection(manager: *Manager, account_id: []const u8) !Selection {
        var accounts = try account_repository.load(manager.allocator, manager.io, manager.data_dir);
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse return error.SandboxAccountNotFound;
        const provider: Provider = if (std.mem.eql(u8, account.provider, "daytona")) .daytona else if (std.mem.eql(u8, account.provider, "vercel")) .vercel else return error.SandboxProviderRequired;
        var configuration = std.json.parseFromSlice(std.json.Value, manager.allocator, account.configuration_json, .{}) catch return error.InvalidSandboxProfile;
        defer configuration.deinit();
        if (configuration.value != .object) return error.InvalidSandboxProfile;
        const profile_id = stringField(configuration.value.object, "defaultProfile") orelse "standard";
        const resources = try profileResources(configuration.value.object, profile_id, provider);
        const artifact = switch (provider) {
            .daytona => try manager.daytona.defaultSnapshot(profile_id),
            .vercel => try manager.allocator.dupe(u8, stringField(configuration.value.object, "workerImage") orelse return error.VercelImageRequired),
        };
        errdefer manager.allocator.free(artifact);
        return .{
            .allocator = manager.allocator,
            .provider = provider,
            .profile_id = try manager.allocator.dupe(u8, profile_id),
            .artifact = artifact,
            .vcpus = resources.vcpus,
            .memory_gib = resources.memory_gib,
            .storage_gib = resources.storage_gib,
        };
    }

    pub fn provision(manager: *Manager, client: *http.Client, database: *sqlite.Database, selection_value: *const Selection, worker_id: []const u8, session_id: []const u8, account_id: []const u8, requested_harness: []const u8, checkout: []const u8) !cloud_types.Provisioned {
        return switch (selection_value.provider) {
            .daytona => manager.daytona.provision(client, database, worker_id, session_id, account_id, requested_harness, selection_value.artifact, selection_value.vcpus, selection_value.memory_gib, selection_value.storage_gib orelse return error.InvalidSandboxProfile, checkout),
            .vercel => manager.vercel.provision(client, database, worker_id, session_id, account_id, requested_harness, selection_value.artifact, selection_value.vcpus, checkout),
        };
    }

    pub fn listPayload(manager: *Manager, database: *sqlite.Database) ![]u8 {
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        return cloud_store.listPayload(manager.allocator, database);
    }

    pub fn resumeSession(manager: *Manager, client: *http.Client, database: *sqlite.Database, session_id: []const u8) !void {
        try manager.lifecycle_mutex.lock(manager.io);
        defer manager.lifecycle_mutex.unlock(manager.io);
        var worker = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk (try cloud_store.latest(manager.allocator, database, session_id)) orelse return;
        };
        defer worker.deinit();
        if (!std.mem.eql(u8, worker.status, "paused") and !std.mem.eql(u8, worker.status, "stopped")) return;
        if (std.mem.eql(u8, worker.provider, "daytona")) return manager.daytona.@"resume"(client, database, &worker);
        return error.SandboxResumeUnavailable;
    }

    pub fn archiveSession(manager: *Manager, client: *http.Client, database: *sqlite.Database, session_id: []const u8) !void {
        try manager.lifecycle_mutex.lock(manager.io);
        defer manager.lifecycle_mutex.unlock(manager.io);
        {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            try cloud_store.requestDelete(database, session_id);
        }
        try manager.reconcileProviders(client, database);
    }

    pub fn reconcile(manager: *Manager, client: *http.Client, database: *sqlite.Database) !void {
        try manager.lifecycle_mutex.lock(manager.io);
        defer manager.lifecycle_mutex.unlock(manager.io);
        try manager.reconcileProviders(client, database);
    }

    fn reconcileProviders(manager: *Manager, client: *http.Client, database: *sqlite.Database) !void {
        try manager.daytona.reconcile(client, database);
        try manager.vercel.reconcile(client, database);
    }

    pub fn runReconciler(manager: *Manager, client: *http.Client, database: *sqlite.Database) Io.Cancelable!void {
        while (true) {
            manager.reconcile(client, database) catch |failure| std.log.warn("Sandbox reconciliation failed: {t}", .{failure});
            try manager.io.sleep(.fromSeconds(30), .awake);
        }
    }
};

pub fn workspacePath(allocator: std.mem.Allocator, session_id: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "/home/node/workspaces/{s}", .{session_id});
}

const Resources = struct {
    vcpus: u8,
    memory_gib: u16,
    storage_gib: ?u16,
};

fn profileResources(object: std.json.ObjectMap, profile_id: []const u8, provider: Provider) !Resources {
    const profiles = object.get("profiles") orelse return defaultProfileResources(profile_id, provider);
    if (profiles != .array) return error.InvalidSandboxProfile;
    for (profiles.array.items) |profile| {
        if (profile != .object) continue;
        const id = stringField(profile.object, "id") orelse continue;
        if (!std.mem.eql(u8, id, profile_id)) continue;
        const cpu = try positiveInteger(profile.object.get("cpu") orelse return error.InvalidSandboxProfile, 32);
        const memory = try positiveInteger(profile.object.get("memoryGiB") orelse return error.InvalidSandboxProfile, 256);
        const storage = profile.object.get("storage") orelse return error.InvalidSandboxProfile;
        if (storage != .object) return error.InvalidSandboxProfile;
        const mode = stringField(storage.object, "mode") orelse return error.InvalidSandboxProfile;
        const storage_gib: ?u16 = switch (provider) {
            .daytona => if (std.mem.eql(u8, mode, "fixed")) try positiveInteger(storage.object.get("gib") orelse return error.InvalidSandboxProfile, 1024) else return error.InvalidSandboxProfile,
            .vercel => if (std.mem.eql(u8, mode, "provider-managed")) null else return error.InvalidSandboxProfile,
        };
        if (provider == .vercel and memory != cpu * 2) return error.InvalidSandboxProfile;
        return .{ .vcpus = @intCast(cpu), .memory_gib = memory, .storage_gib = storage_gib };
    }
    return error.InvalidSandboxProfile;
}

fn defaultProfileResources(profile_id: []const u8, provider: Provider) !Resources {
    const vcpus: u8 = if (std.mem.eql(u8, profile_id, "light"))
        1
    else if (std.mem.eql(u8, profile_id, "standard"))
        2
    else if (std.mem.eql(u8, profile_id, "large"))
        4
    else
        return error.InvalidSandboxProfile;
    return .{
        .vcpus = vcpus,
        .memory_gib = @as(u16, vcpus) * 2,
        .storage_gib = if (provider == .daytona) @as(u16, vcpus) * 10 else null,
    };
}

fn positiveInteger(value: std.json.Value, maximum: u16) !u16 {
    const integer: i64 = switch (value) {
        .integer => |number| number,
        .float => |number| if (@floor(number) == number) @intFromFloat(number) else return error.InvalidSandboxProfile,
        else => return error.InvalidSandboxProfile,
    };
    if (integer < 1 or integer > maximum) return error.InvalidSandboxProfile;
    return @intCast(integer);
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0 or trimmed.len > 1024 * 1024) null else trimmed;
}
