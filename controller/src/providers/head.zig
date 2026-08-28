const std = @import("std");
const config = @import("../app/config.zig");
const oauth_credentials = @import("../accounts/oauth_credentials.zig");
const cursor_gateway = @import("cursor_gateway.zig");
const model_catalog = @import("../inference/models/catalog.zig");

const Io = std.Io;
const codex_id = "openai-codex";
const openrouter_id = "openrouter";
const cursor_id = "cursor";
const codex_client_id = "app_EMoamEEZ73f0CkXaXp7hrann";
const auth_origin = "https://auth.openai.com";
const max_response_bytes = 2 * 1024 * 1024;
const login_timeout_seconds = 15 * 60;

const Status = enum { running, success, error_state, cancelled };

const Job = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    provider_id: []u8,
    auth_type: []u8,
    status: Status = .running,
    pending_prompt: bool = false,
    error_message: ?[]u8 = null,
    events: std.ArrayList([]u8) = .empty,
    event_seq: u64 = 0,
    cancelled: std.atomic.Value(bool) = .init(false),

    fn deinit(job: *Job) void {
        job.allocator.free(job.id);
        job.allocator.free(job.provider_id);
        job.allocator.free(job.auth_type);
        if (job.error_message) |value| job.allocator.free(value);
        for (job.events.items) |event| job.allocator.free(event);
        job.events.deinit(job.allocator);
        job.allocator.destroy(job);
    }
};

pub const State = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []u8,
    configuration: *const config.Config,
    mutex: Io.Mutex = .init,
    tasks: Io.Group = .init,
    jobs: std.StringHashMapUnmanaged(*Job) = .empty,

    pub fn init(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) !State {
        return .{ .allocator = allocator, .io = io, .data_dir = try allocator.dupe(u8, configuration.data_dir), .configuration = configuration };
    }

    pub fn deinit(state: *State) void {
        var iterator = state.jobs.valueIterator();
        while (iterator.next()) |job| job.*.cancelled.store(true, .release);
        state.tasks.cancel(state.io);
        iterator = state.jobs.valueIterator();
        while (iterator.next()) |job| job.*.deinit();
        state.jobs.deinit(state.allocator);
        state.allocator.free(state.data_dir);
        state.* = undefined;
    }

    pub fn listPayload(state: *State) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const codex_configured = try storedCredential(state, codex_id);
        const openrouter_configured = try storedCredential(state, openrouter_id);
        const cursor_configured = cursorConfigured(state);
        var codex_models = try model_catalog.providerModels(state.allocator, codex_id);
        defer codex_models.deinit();
        var openrouter_models = try model_catalog.providerModels(state.allocator, openrouter_id);
        defer openrouter_models.deinit();
        var cursor_models = try model_catalog.providerModels(state.allocator, cursor_id);
        defer cursor_models.deinit();
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.print("{{\"providers\":[{{\"id\":\"openai-codex\",\"name\":\"OpenAI Codex\",\"oauth\":{{\"label\":\"OpenAI (ChatGPT subscription)\"}},\"configured\":{},", .{codex_configured});
        if (codex_configured) try output.writer.writeAll("\"authSource\":\"controller\",\"authLabel\":\"ChatGPT OAuth\",\"credentialType\":\"oauth\",");
        try output.writer.print("\"modelCount\":{d},\"controllerOwned\":true}},{{\"id\":\"openrouter\",\"name\":\"OpenRouter\",\"apiKey\":{{\"label\":\"OpenRouter API key\"}},\"configured\":{},", .{ codex_models.count, openrouter_configured });
        if (openrouter_configured) try output.writer.writeAll("\"authSource\":\"controller\",\"authLabel\":\"OpenRouter API key\",\"credentialType\":\"api_key\",");
        try output.writer.print("\"modelCount\":{d},\"controllerOwned\":true}},{{\"id\":\"cursor\",\"name\":\"Cursor\",\"oauth\":{{\"label\":\"Cursor subscription\"}},\"configured\":{},", .{ openrouter_models.count, cursor_configured });
        if (cursor_configured) try output.writer.writeAll("\"authSource\":\"local\",\"authLabel\":\"Cursor CLI\",\"credentialType\":\"oauth\",");
        try output.writer.print("\"modelCount\":{d},\"controllerOwned\":true}}]}}", .{cursor_models.count});
        return output.toOwnedSlice();
    }

    pub fn catalogPayload(state: *State) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const codex_configured = try storedCredential(state, codex_id);
        const openrouter_configured = try storedCredential(state, openrouter_id);
        const cursor_configured = cursorConfigured(state);
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"providers\":[");
        var wrote = false;
        for ([_]struct { id: []const u8, configured: bool }{
            .{ .id = codex_id, .configured = codex_configured },
            .{ .id = openrouter_id, .configured = openrouter_configured },
            .{ .id = cursor_id, .configured = cursor_configured },
        }) |provider| if (provider.configured) {
            var models = try model_catalog.providerModels(state.allocator, provider.id);
            defer models.deinit();
            if (wrote) try output.writer.writeByte(',');
            try output.writer.writeAll("{\"provider\":");
            try std.json.Stringify.value(provider.id, .{}, &output.writer);
            try output.writer.writeAll(",\"models\":");
            try output.writer.writeAll(models.document);
            try output.writer.writeByte('}');
            wrote = true;
        };
        try output.writer.writeAll("]}");
        return output.toOwnedSlice();
    }

    pub fn startLogin(state: *State, client: *std.http.Client, provider_id: []const u8, auth_type: []const u8) ![]u8 {
        const is_codex = std.mem.eql(u8, provider_id, codex_id);
        const is_openrouter = std.mem.eql(u8, provider_id, openrouter_id);
        const is_cursor = std.mem.eql(u8, provider_id, cursor_id);
        if (!is_codex and !is_openrouter and !is_cursor) return error.ProviderNotFound;
        if ((is_codex or is_cursor) and !std.mem.eql(u8, auth_type, "oauth")) return error.InvalidAuthType;
        if (is_openrouter and !std.mem.eql(u8, auth_type, "api_key")) return error.InvalidAuthType;
        var random: [16]u8 = undefined;
        state.io.random(&random);
        const job_id_buffer = std.fmt.bytesToHex(random, .lower);
        const job = try state.allocator.create(Job);
        errdefer state.allocator.destroy(job);
        job.* = .{
            .allocator = state.allocator,
            .id = try state.allocator.dupe(u8, job_id_buffer[0..]),
            .provider_id = try state.allocator.dupe(u8, provider_id),
            .auth_type = try state.allocator.dupe(u8, auth_type),
            .pending_prompt = is_openrouter,
        };
        errdefer {
            state.allocator.free(job.id);
            state.allocator.free(job.provider_id);
            state.allocator.free(job.auth_type);
        }
        try state.mutex.lock(state.io);
        var locked = true;
        defer if (locked) state.mutex.unlock(state.io);
        var iterator = state.jobs.valueIterator();
        while (iterator.next()) |existing| if (existing.*.status == .running and std.mem.eql(u8, existing.*.provider_id, provider_id)) existing.*.cancelled.store(true, .release);
        try state.jobs.put(state.allocator, job.id, job);
        if (is_codex) {
            state.tasks.concurrent(state.io, runCodexLogin, .{ state, client, job }) catch |failure| {
                _ = state.jobs.remove(job.id);
                return failure;
            };
        } else if (is_cursor) {
            state.tasks.concurrent(state.io, runCursorLogin, .{ state, client, job }) catch |failure| {
                _ = state.jobs.remove(job.id);
                return failure;
            };
        }
        locked = false;
        state.mutex.unlock(state.io);
        return std.fmt.allocPrint(state.allocator, "{{\"jobId\":\"{s}\"}}", .{job.id});
    }

    pub fn jobPayload(state: *State, provider_id: []const u8, job_id: []const u8, after: u64) !?[]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const job = state.jobs.get(job_id) orelse return null;
        if (!std.mem.eql(u8, job.provider_id, provider_id)) return null;
        return @as(?[]u8, try state.writeJobPayload(job, after));
    }

    pub fn jobPayloadAny(state: *State, job_id: []const u8, after: u64) !?[]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const job = state.jobs.get(job_id) orelse return null;
        return @as(?[]u8, try state.writeJobPayload(job, after));
    }

    fn writeJobPayload(state: *State, job: *const Job, after: u64) ![]u8 {
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"jobId\":");
        try std.json.Stringify.value(job.id, .{}, &output.writer);
        try output.writer.writeAll(",\"providerId\":");
        try std.json.Stringify.value(job.provider_id, .{}, &output.writer);
        try output.writer.writeAll(",\"authType\":");
        try std.json.Stringify.value(job.auth_type, .{}, &output.writer);
        try output.writer.writeAll(",\"status\":");
        try std.json.Stringify.value(statusName(job.status), .{}, &output.writer);
        if (job.error_message) |message| {
            try output.writer.writeAll(",\"error\":");
            try std.json.Stringify.value(message, .{}, &output.writer);
        }
        try output.writer.writeAll(",\"events\":[");
        var wrote = false;
        for (job.events.items) |event| {
            var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, event, .{}) catch continue;
            defer parsed.deinit();
            if (parsed.value != .object) continue;
            const seq = parsed.value.object.get("seq") orelse continue;
            if (seq != .integer or seq.integer <= after) continue;
            if (wrote) try output.writer.writeByte(',');
            try output.writer.writeAll(event);
            wrote = true;
        }
        try output.writer.writeByte(']');
        if (job.pending_prompt and job.status == .running) {
            try output.writer.writeAll(",\"pendingPrompt\":{\"id\":1,\"type\":\"secret\",\"message\":\"Enter your OpenRouter API key\",\"placeholder\":\"sk-or-v1-...\"}");
        }
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn cancel(state: *State, provider_id: []const u8, job_id: []const u8) !bool {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const job = state.jobs.get(job_id) orelse return false;
        if (!std.mem.eql(u8, job.provider_id, provider_id)) return false;
        job.cancelled.store(true, .release);
        if (job.status == .running) job.status = .cancelled;
        return true;
    }

    pub fn cancelAny(state: *State, job_id: []const u8) !bool {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const job = state.jobs.get(job_id) orelse return false;
        job.cancelled.store(true, .release);
        if (job.status == .running) job.status = .cancelled;
        return true;
    }

    pub fn respond(state: *State, provider_id: []const u8, job_id: []const u8, prompt_id: u64, value: []const u8) !bool {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const job = state.jobs.get(job_id) orelse return false;
        if (!std.mem.eql(u8, job.provider_id, provider_id)) return false;
        return state.respondLocked(job, prompt_id, value);
    }

    pub fn respondAny(state: *State, job_id: []const u8, prompt_id: u64, value: []const u8) !bool {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const job = state.jobs.get(job_id) orelse return false;
        return state.respondLocked(job, prompt_id, value);
    }

    fn respondLocked(state: *State, job: *Job, prompt_id: u64, value: []const u8) !bool {
        if (!std.mem.eql(u8, job.provider_id, openrouter_id) or prompt_id != 1 or !job.pending_prompt or job.status != .running) return false;
        const api_key = std.mem.trim(u8, value, " \t\r\n");
        if (api_key.len == 0) return error.InvalidApiKey;
        const access = try state.allocator.dupe(u8, api_key);
        errdefer state.allocator.free(access);
        const refresh = try state.allocator.dupe(u8, api_key);
        errdefer state.allocator.free(refresh);
        const account_id = try state.allocator.dupe(u8, openrouter_id);
        var credential_value: oauth_credentials.Credential = .{
            .allocator = state.allocator,
            .access = access,
            .refresh = refresh,
            .account_id = account_id,
            .expires_at_ms = std.math.maxInt(i64),
        };
        defer credential_value.deinit();
        try oauth_credentials.save(state.allocator, state.io, state.data_dir, openrouter_id, &credential_value);
        job.pending_prompt = false;
        job.status = .success;
        return true;
    }

    pub fn logout(state: *State, provider_id: []const u8) !bool {
        if (!std.mem.eql(u8, provider_id, codex_id) and !std.mem.eql(u8, provider_id, openrouter_id) and !std.mem.eql(u8, provider_id, cursor_id)) return false;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var iterator = state.jobs.valueIterator();
        while (iterator.next()) |job| if (std.mem.eql(u8, job.*.provider_id, provider_id)) job.*.cancelled.store(true, .release);
        if (std.mem.eql(u8, provider_id, cursor_id)) {
            _ = cursor_gateway.logout(state.allocator, state.io, state.configuration);
        } else try oauth_credentials.remove(state.allocator, state.io, state.data_dir, provider_id);
        return true;
    }

    pub fn credential(state: *State, client: *std.http.Client, provider_id: []const u8) !?oauth_credentials.Credential {
        if (!std.mem.eql(u8, provider_id, codex_id) and !std.mem.eql(u8, provider_id, openrouter_id)) return null;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var current = (try oauth_credentials.load(state.allocator, state.io, state.data_dir, provider_id)) orelse return null;
        if (std.mem.eql(u8, provider_id, openrouter_id)) return current;
        const now_ms = @max(Io.Clock.real.now(state.io).toSeconds(), 0) * 1000;
        if (current.expires_at_ms > now_ms + 60_000) return current;
        const refreshed = refreshCredential(state.allocator, state.io, client, current.refresh) catch {
            current.deinit();
            return error.CredentialRefreshFailed;
        };
        current.deinit();
        try oauth_credentials.save(state.allocator, state.io, state.data_dir, provider_id, &refreshed);
        return refreshed;
    }
};

pub fn isCodexModel(allocator: std.mem.Allocator, model_id: []const u8) !bool {
    return model_catalog.providerHasModel(allocator, codex_id, model_id);
}

pub fn isProviderModel(allocator: std.mem.Allocator, provider_id: []const u8, model_id: []const u8) !bool {
    if (!std.mem.eql(u8, provider_id, openrouter_id) and !std.mem.eql(u8, provider_id, cursor_id)) return false;
    return model_catalog.providerHasModel(allocator, provider_id, model_id);
}

fn storedCredential(state: *State, provider_id: []const u8) !bool {
    if (try oauth_credentials.load(state.allocator, state.io, state.data_dir, provider_id)) |value| {
        var credential_value = value;
        credential_value.deinit();
        return true;
    }
    return false;
}

fn cursorConfigured(state: *State) bool {
    return cursor_gateway.configured(state.allocator, state.io, state.configuration);
}

fn runCursorLogin(state: *State, _: *std.http.Client, job: *Job) Io.Cancelable!void {
    if (cursorConfigured(state)) {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        if (job.status == .running) job.status = .success;
        return;
    }
    if (!cursor_gateway.login(state.allocator, state.io, state.configuration)) return finishFailure(state, job, error.CursorLoginFailed);
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    if (job.status == .running) job.status = .success;
}

fn runCodexLogin(state: *State, client: *std.http.Client, job: *Job) Io.Cancelable!void {
    const device = requestDeviceCode(state.allocator, client) catch |failure| return finishFailure(state, job, failure);
    defer {
        state.allocator.free(device.device_auth_id);
        state.allocator.free(device.user_code);
    }
    addDeviceEvent(state, job, device.user_code, device.interval_seconds) catch |failure| return finishFailure(state, job, failure);
    const started = Io.Clock.awake.now(state.io);
    var interval = @max(device.interval_seconds, 1);
    while (started.durationTo(Io.Clock.awake.now(state.io)).toSeconds() < login_timeout_seconds) {
        if (job.cancelled.load(.acquire)) return finishCancelled(state, job);
        const result = pollDeviceCode(state.allocator, client, device.device_auth_id, device.user_code) catch |failure| return finishFailure(state, job, failure);
        switch (result) {
            .pending => {},
            .slow_down => interval = @min(interval + 5, 60),
            .complete => |code| {
                defer {
                    state.allocator.free(code.authorization_code);
                    state.allocator.free(code.code_verifier);
                }
                var credential_value = exchangeCode(state.allocator, state.io, client, code.authorization_code, code.code_verifier) catch |failure| return finishFailure(state, job, failure);
                defer credential_value.deinit();
                if (job.cancelled.load(.acquire)) return finishCancelled(state, job);
                state.mutex.lock(state.io) catch return;
                defer state.mutex.unlock(state.io);
                oauth_credentials.save(state.allocator, state.io, state.data_dir, codex_id, &credential_value) catch |failure| {
                    setFailureLocked(state, job, failure);
                    return;
                };
                if (job.status == .running) job.status = .success;
                return;
            },
        }
        state.io.sleep(.fromSeconds(@intCast(interval)), .awake) catch |failure| switch (failure) {
            error.Canceled => return error.Canceled,
        };
    }
    finishFailure(state, job, error.LoginTimedOut);
}

const DeviceCode = struct { device_auth_id: []u8, user_code: []u8, interval_seconds: u64 };
const AuthorizationCode = struct { authorization_code: []u8, code_verifier: []u8 };
const PollResult = union(enum) { pending, slow_down, complete: AuthorizationCode };

fn requestDeviceCode(allocator: std.mem.Allocator, client: *std.http.Client) !DeviceCode {
    const response = try fetchJson(allocator, client, auth_origin ++ "/api/accounts/deviceauth/usercode", "{\"client_id\":\"" ++ codex_client_id ++ "\"}", "application/json");
    defer allocator.free(response.body);
    if (response.status.class() != .success) return error.DeviceCodeRequestFailed;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response.body, .{}) catch return error.InvalidDeviceCodeResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidDeviceCodeResponse;
    const device_auth_id = stringField(parsed.value.object, "device_auth_id") orelse return error.InvalidDeviceCodeResponse;
    const user_code = stringField(parsed.value.object, "user_code") orelse return error.InvalidDeviceCodeResponse;
    const interval = parsed.value.object.get("interval") orelse return error.InvalidDeviceCodeResponse;
    const interval_seconds: u64 = switch (interval) {
        .integer => |value| if (value >= 0) @intCast(value) else return error.InvalidDeviceCodeResponse,
        .string => |value| std.fmt.parseInt(u64, std.mem.trim(u8, value, " \t\r\n"), 10) catch return error.InvalidDeviceCodeResponse,
        else => return error.InvalidDeviceCodeResponse,
    };
    const device_copy = try allocator.dupe(u8, device_auth_id);
    errdefer allocator.free(device_copy);
    return .{ .device_auth_id = device_copy, .user_code = try allocator.dupe(u8, user_code), .interval_seconds = interval_seconds };
}

fn pollDeviceCode(allocator: std.mem.Allocator, client: *std.http.Client, device_auth_id: []const u8, user_code: []const u8) !PollResult {
    var payload: Io.Writer.Allocating = .init(allocator);
    defer payload.deinit();
    try payload.writer.writeAll("{\"device_auth_id\":");
    try std.json.Stringify.value(device_auth_id, .{}, &payload.writer);
    try payload.writer.writeAll(",\"user_code\":");
    try std.json.Stringify.value(user_code, .{}, &payload.writer);
    try payload.writer.writeByte('}');
    const response = try fetchJson(allocator, client, auth_origin ++ "/api/accounts/deviceauth/token", payload.writer.buffered(), "application/json");
    defer allocator.free(response.body);
    if (response.status == .forbidden or response.status == .not_found) return .pending;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response.body, .{}) catch return error.InvalidDevicePollResponse;
    defer parsed.deinit();
    if (response.status.class() == .success) {
        if (parsed.value != .object) return error.InvalidDevicePollResponse;
        const code = stringField(parsed.value.object, "authorization_code") orelse return error.InvalidDevicePollResponse;
        const verifier = stringField(parsed.value.object, "code_verifier") orelse return error.InvalidDevicePollResponse;
        const code_copy = try allocator.dupe(u8, code);
        errdefer allocator.free(code_copy);
        return .{ .complete = .{ .authorization_code = code_copy, .code_verifier = try allocator.dupe(u8, verifier) } };
    }
    if (parsed.value == .object) {
        const error_value = parsed.value.object.get("error");
        const error_code = if (error_value) |value| switch (value) {
            .string => value.string,
            .object => stringField(value.object, "code") orelse "",
            else => "",
        } else "";
        if (std.mem.eql(u8, error_code, "deviceauth_authorization_pending")) return .pending;
        if (std.mem.eql(u8, error_code, "slow_down")) return .slow_down;
    }
    return error.DeviceAuthorizationFailed;
}

fn exchangeCode(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, authorization_code: []const u8, code_verifier: []const u8) !oauth_credentials.Credential {
    var form: Io.Writer.Allocating = .init(allocator);
    defer form.deinit();
    try form.writer.writeAll("grant_type=authorization_code&client_id=");
    try formEncode(&form.writer, codex_client_id);
    try form.writer.writeAll("&code=");
    try formEncode(&form.writer, authorization_code);
    try form.writer.writeAll("&code_verifier=");
    try formEncode(&form.writer, code_verifier);
    try form.writer.writeAll("&redirect_uri=");
    try formEncode(&form.writer, auth_origin ++ "/deviceauth/callback");
    return tokenCredential(allocator, io, client, form.writer.buffered());
}

fn refreshCredential(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, refresh_token: []const u8) !oauth_credentials.Credential {
    var form: Io.Writer.Allocating = .init(allocator);
    defer form.deinit();
    try form.writer.writeAll("grant_type=refresh_token&refresh_token=");
    try formEncode(&form.writer, refresh_token);
    try form.writer.writeAll("&client_id=");
    try formEncode(&form.writer, codex_client_id);
    return tokenCredential(allocator, io, client, form.writer.buffered());
}

fn tokenCredential(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, form: []const u8) !oauth_credentials.Credential {
    const response = try fetchJson(allocator, client, auth_origin ++ "/oauth/token", form, "application/x-www-form-urlencoded");
    defer allocator.free(response.body);
    if (response.status.class() != .success) return error.TokenExchangeFailed;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response.body, .{}) catch return error.InvalidTokenResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidTokenResponse;
    const access = stringField(parsed.value.object, "access_token") orelse return error.InvalidTokenResponse;
    const refresh = stringField(parsed.value.object, "refresh_token") orelse return error.InvalidTokenResponse;
    const expires = parsed.value.object.get("expires_in") orelse return error.InvalidTokenResponse;
    if (expires != .integer or expires.integer <= 0) return error.InvalidTokenResponse;
    const account_id = try accountId(allocator, access);
    errdefer allocator.free(account_id);
    const access_copy = try allocator.dupe(u8, access);
    errdefer allocator.free(access_copy);
    const refresh_copy = try allocator.dupe(u8, refresh);
    return .{
        .allocator = allocator,
        .access = access_copy,
        .refresh = refresh_copy,
        .account_id = account_id,
        .expires_at_ms = @max(Io.Clock.real.now(io).toSeconds(), 0) * 1000 + expires.integer * 1000,
    };
}

const FetchResponse = struct { status: std.http.Status, body: []u8 };

fn fetchJson(allocator: std.mem.Allocator, client: *std.http.Client, url: []const u8, payload: []const u8, content_type: []const u8) !FetchResponse {
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var body: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = .POST,
        .payload = payload,
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .content_type = .omit },
        .extra_headers = &.{
            .{ .name = "Content-Type", .value = content_type },
            .{ .name = "Accept", .value = "application/json" },
        },
        .response_writer = &body,
    });
    return .{ .status = response.status, .body = try allocator.dupe(u8, body.buffered()) };
}

fn accountId(allocator: std.mem.Allocator, access_token: []const u8) ![]u8 {
    var parts = std.mem.splitScalar(u8, access_token, '.');
    _ = parts.next() orelse return error.InvalidAccessToken;
    const payload = parts.next() orelse return error.InvalidAccessToken;
    const decoded_length = std.base64.url_safe_no_pad.Decoder.calcSizeForSlice(payload) catch return error.InvalidAccessToken;
    const decoded = try allocator.alloc(u8, decoded_length);
    defer allocator.free(decoded);
    std.base64.url_safe_no_pad.Decoder.decode(decoded, payload) catch return error.InvalidAccessToken;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, decoded, .{}) catch return error.InvalidAccessToken;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidAccessToken;
    const auth = parsed.value.object.get("https://api.openai.com/auth") orelse return error.InvalidAccessToken;
    if (auth != .object) return error.InvalidAccessToken;
    const value = stringField(auth.object, "chatgpt_account_id") orelse return error.InvalidAccessToken;
    return allocator.dupe(u8, value);
}

fn addDeviceEvent(state: *State, job: *Job, user_code: []const u8, interval_seconds: u64) !void {
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    if (job.status != .running) return;
    job.event_seq += 1;
    var output: Io.Writer.Allocating = .init(state.allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"seq\":{d},\"event\":{{\"type\":\"device_code\",\"userCode\":", .{job.event_seq});
    try std.json.Stringify.value(user_code, .{}, &output.writer);
    try output.writer.print(",\"verificationUri\":\"https://auth.openai.com/codex/device\",\"intervalSeconds\":{d},\"expiresInSeconds\":{d}}}}}", .{ interval_seconds, login_timeout_seconds });
    try job.events.append(state.allocator, try output.toOwnedSlice());
}

fn finishFailure(state: *State, job: *Job, failure: anyerror) void {
    state.mutex.lock(state.io) catch return;
    defer state.mutex.unlock(state.io);
    setFailureLocked(state, job, failure);
}

fn setFailureLocked(state: *State, job: *Job, failure: anyerror) void {
    if (job.status != .running) return;
    job.status = .error_state;
    job.error_message = state.allocator.dupe(u8, @errorName(failure)) catch null;
}

fn finishCancelled(state: *State, job: *Job) void {
    state.mutex.lock(state.io) catch return;
    defer state.mutex.unlock(state.io);
    if (job.status == .running) job.status = .cancelled;
}

fn statusName(status: Status) []const u8 {
    return switch (status) {
        .running => "running",
        .success => "success",
        .error_state => "error",
        .cancelled => "cancelled",
    };
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string and value.string.len > 0) value.string else null;
}

fn formEncode(writer: *Io.Writer, value: []const u8) !void {
    const hex = "0123456789ABCDEF";
    for (value) |byte| {
        if (std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '_' or byte == '.' or byte == '~') {
            try writer.writeByte(byte);
        } else if (byte == ' ') {
            try writer.writeByte('+');
        } else {
            try writer.writeByte('%');
            try writer.writeByte(hex[byte >> 4]);
            try writer.writeByte(hex[byte & 15]);
        }
    }
}
