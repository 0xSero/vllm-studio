const std = @import("std");
const store_repository = @import("../../agent/connectors/oauth_store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const agent_connectors = @import("../../agent/connectors/service.zig");
const harness_nodes = @import("../../agent/harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");
const mcp_oauth = @import("../mcp_oauth/service.zig");

const Io = std.Io;
const http = std.http;
const device_url = "https://github.com/login/device/code";
const token_url = "https://github.com/login/oauth/access_token";
const identity_url = "https://api.github.com/user";
const max_response_bytes = 2 * 1024 * 1024;
const github_scopes = "repo read:org workflow project write:packages gist notifications read:user user:email";

const Pending = struct {
    allocator: std.mem.Allocator,
    device_code: []u8,
    user_code: []u8,
    verification_uri: []u8,
    expires_at_ms: i64,
    next_poll_at_ms: i64,
    interval_ms: i64,

    fn deinit(pending: *Pending) void {
        pending.allocator.free(pending.device_code);
        pending.allocator.free(pending.user_code);
        pending.allocator.free(pending.verification_uri);
        pending.* = undefined;
    }
};

pub const State = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []u8,
    environment: *const std.process.Environ.Map,
    mutex: Io.Mutex = .init,
    pending: ?Pending = null,
    last_error: ?[]u8 = null,
    remote: mcp_oauth.State,

    pub fn init(allocator: std.mem.Allocator, io: Io, data_dir: []const u8, environment: *const std.process.Environ.Map) !State {
        var remote = try mcp_oauth.State.init(allocator, io, data_dir, environment);
        errdefer remote.deinit();
        return .{
            .allocator = allocator,
            .io = io,
            .data_dir = try allocator.dupe(u8, data_dir),
            .environment = environment,
            .remote = remote,
        };
    }

    pub fn deinit(state: *State) void {
        if (state.pending) |*value| value.deinit();
        if (state.last_error) |value| state.allocator.free(value);
        state.remote.deinit();
        state.allocator.free(state.data_dir);
        state.* = undefined;
    }

    pub fn authorizePayload(state: *State, client: *http.Client, database: *sqlite.Database, document: []const u8) ![]u8 {
        const connector_id = try connectorFromDocument(state.allocator, document);
        defer state.allocator.free(connector_id);
        if (!std.mem.eql(u8, connector_id, "github")) return state.remote.authorizePayload(client, database, document);
        try requireGithubDocument(state.allocator, document, false);
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var stored = try store_repository.load(state.allocator, state.io, state.data_dir);
        defer stored.deinit();
        const client_id = state.environment.get("LOCAL_STUDIO_GITHUB_CLIENT_ID") orelse stored.client_id orelse return error.OAuthClientRequired;
        var form: Io.Writer.Allocating = .init(state.allocator);
        defer form.deinit();
        try form.writer.writeAll("client_id=");
        try formEncode(&form.writer, client_id);
        try form.writer.writeAll("&scope=");
        try formEncode(&form.writer, github_scopes);
        const response = try postForm(state.allocator, client, device_url, form.writer.buffered());
        defer state.allocator.free(response.body);
        if (response.status.class() != .success) return error.OAuthProviderRejected;
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, response.body, .{}) catch return error.InvalidOAuthProviderResponse;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidOAuthProviderResponse;
        const device_code = stringField(parsed.value.object, "device_code") orelse return error.InvalidOAuthProviderResponse;
        const user_code = stringField(parsed.value.object, "user_code") orelse return error.InvalidOAuthProviderResponse;
        const verification_uri = stringField(parsed.value.object, "verification_uri") orelse return error.InvalidOAuthProviderResponse;
        const now = nowMillis(state.io);
        const expires_ms = positiveInteger(parsed.value.object, "expires_in") orelse 900;
        const interval_ms = (positiveInteger(parsed.value.object, "interval") orelse 5) * 1000;
        state.clearFlowLocked();
        const device_copy = try state.allocator.dupe(u8, device_code);
        errdefer state.allocator.free(device_copy);
        const user_copy = try state.allocator.dupe(u8, user_code);
        errdefer state.allocator.free(user_copy);
        state.pending = .{
            .allocator = state.allocator,
            .device_code = device_copy,
            .user_code = user_copy,
            .verification_uri = try state.allocator.dupe(u8, verification_uri),
            .expires_at_ms = now + expires_ms * 1000,
            .next_poll_at_ms = now + interval_ms,
            .interval_ms = interval_ms,
        };
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"flow\":\"device\",\"userCode\":");
        try std.json.Stringify.value(user_code, .{}, &output.writer);
        try output.writer.writeAll(",\"verificationUri\":");
        try std.json.Stringify.value(verification_uri, .{}, &output.writer);
        try output.writer.print(",\"expiresAt\":{d}}}", .{now + expires_ms * 1000});
        return output.toOwnedSlice();
    }

    pub fn cancelConnectorPayload(state: *State, connector_id: []const u8) ![]u8 {
        if (!std.mem.eql(u8, connector_id, "github")) return state.remote.cancelProviderPayload(connector_id);
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.clearFlowLocked();
        return state.allocator.dupe(u8, "{\"cancelled\":true}");
    }

    pub fn statusPayload(state: *State, client: *http.Client, database: *sqlite.Database, connector_id: []const u8) ![]u8 {
        if (!std.mem.eql(u8, connector_id, "github")) return state.remote.statusPayload(connector_id);
        try requireGithub(connector_id);
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        try state.pollLocked(client, database);
        return state.writeStatusLocked();
    }

    pub fn clientPayload(state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
        const connector_id = try connectorFromDocument(state.allocator, document);
        defer state.allocator.free(connector_id);
        if (!std.mem.eql(u8, connector_id, "github")) return state.remote.clientPayload(database, document);
        const client_id = try githubClientFromDocument(state.allocator, document);
        defer state.allocator.free(client_id);
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.clearFlowLocked();
        var stored = try store_repository.load(state.allocator, state.io, state.data_dir);
        defer stored.deinit();
        if (stored.client_id == null or !std.mem.eql(u8, stored.client_id.?, client_id)) {
            if (stored.client_id) |value| state.allocator.free(value);
            stored.client_id = try state.allocator.dupe(u8, client_id);
            for (stored.tokens.items) |*value| value.deinit();
            stored.tokens.clearRetainingCapacity();
            try store_repository.save(state.allocator, state.io, state.data_dir, &stored);
            try agent_connectors.disconnectAllOAuthLocal(state.allocator, state.io, database);
        }
        return state.writeStatusLocked();
    }

    pub fn disconnectPayload(state: *State, database: *sqlite.Database, connector_id: []const u8, account: ?[]const u8) ![]u8 {
        if (!std.mem.eql(u8, connector_id, "github")) return state.remote.disconnectPayload(database, connector_id, account);
        try requireGithub(connector_id);
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.clearFlowLocked();
        var stored = try store_repository.load(state.allocator, state.io, state.data_dir);
        defer stored.deinit();
        if (account) |selected| {
            var index: usize = 0;
            while (index < stored.tokens.items.len) {
                const matches = if (stored.tokens.items[index].account) |candidate| std.mem.eql(u8, candidate, selected) else false;
                if (!matches) {
                    index += 1;
                    continue;
                }
                var removed = stored.tokens.orderedRemove(index);
                removed.deinit();
                break;
            }
            try agent_connectors.disconnectOAuthLocal(state.allocator, state.io, database, selected);
        } else {
            for (stored.tokens.items) |*value| value.deinit();
            stored.tokens.clearRetainingCapacity();
            try agent_connectors.disconnectAllOAuthLocal(state.allocator, state.io, database);
        }
        try store_repository.save(state.allocator, state.io, state.data_dir, &stored);
        return state.writeStatusLocked();
    }

    fn pollLocked(state: *State, client: *http.Client, database: *sqlite.Database) !void {
        const pending = if (state.pending) |*value| value else return;
        const now = nowMillis(state.io);
        if (now >= pending.expires_at_ms) {
            try state.setErrorLocked("The sign-in code expired before it was used");
            state.clearPendingLocked();
            return;
        }
        if (now < pending.next_poll_at_ms) return;
        var stored = try store_repository.load(state.allocator, state.io, state.data_dir);
        defer stored.deinit();
        const client_id = state.environment.get("LOCAL_STUDIO_GITHUB_CLIENT_ID") orelse stored.client_id orelse return error.OAuthClientRequired;
        var form: Io.Writer.Allocating = .init(state.allocator);
        defer form.deinit();
        try form.writer.writeAll("client_id=");
        try formEncode(&form.writer, client_id);
        try form.writer.writeAll("&device_code=");
        try formEncode(&form.writer, pending.device_code);
        try form.writer.writeAll("&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code");
        const response = postForm(state.allocator, client, token_url, form.writer.buffered()) catch {
            pending.next_poll_at_ms = now + pending.interval_ms;
            return;
        };
        defer state.allocator.free(response.body);
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, response.body, .{}) catch return error.InvalidOAuthProviderResponse;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidOAuthProviderResponse;
        if (stringField(parsed.value.object, "error")) |provider_error| {
            if (std.mem.eql(u8, provider_error, "authorization_pending")) {
                pending.next_poll_at_ms = now + pending.interval_ms;
                return;
            }
            if (std.mem.eql(u8, provider_error, "slow_down")) {
                pending.interval_ms = @min(pending.interval_ms + 5000, 60_000);
                pending.next_poll_at_ms = now + pending.interval_ms;
                return;
            }
            const message = if (std.mem.eql(u8, provider_error, "access_denied")) "The sign-in was declined" else if (std.mem.eql(u8, provider_error, "expired_token")) "The sign-in code expired before it was used" else "The OAuth provider rejected the sign-in";
            try state.setErrorLocked(message);
            state.clearPendingLocked();
            return;
        }
        const access = stringField(parsed.value.object, "access_token") orelse return error.InvalidOAuthProviderResponse;
        const account = try fetchAccount(state.allocator, client, access);
        defer if (account) |value| state.allocator.free(value);
        var scopes: std.ArrayList([]u8) = .empty;
        errdefer {
            for (scopes.items) |scope| state.allocator.free(scope);
            scopes.deinit(state.allocator);
        }
        const raw_scope = stringField(parsed.value.object, "scope");
        if (raw_scope) |value| {
            var values = std.mem.tokenizeAny(u8, value, " ,\t\r\n");
            while (values.next()) |scope| try scopes.append(state.allocator, try state.allocator.dupe(u8, scope));
        }
        if (scopes.items.len == 0) {
            var configured_scopes = std.mem.tokenizeScalar(u8, github_scopes, ' ');
            while (configured_scopes.next()) |scope| try scopes.append(state.allocator, try state.allocator.dupe(u8, scope));
        }
        var timestamp_buffer: [24]u8 = undefined;
        const account_name = account orelse "github";
        const replacement = store_repository.Token{
            .allocator = state.allocator,
            .access = try state.allocator.dupe(u8, access),
            .account = try state.allocator.dupe(u8, account_name),
            .scopes = try scopes.toOwnedSlice(state.allocator),
            .obtained_at = try state.allocator.dupe(u8, formatTimestamp(state.io, &timestamp_buffer)),
            .expires_at_ms = null,
        };
        var replaced = false;
        for (stored.tokens.items) |*token| {
            const candidate = token.account orelse continue;
            if (!std.mem.eql(u8, candidate, account_name)) continue;
            token.deinit();
            token.* = replacement;
            replaced = true;
            break;
        }
        if (!replaced) try stored.tokens.append(state.allocator, replacement);
        try store_repository.save(state.allocator, state.io, state.data_dir, &stored);
        try agent_connectors.connectOAuthLocal(state.allocator, state.io, database, account_name);
        state.clearFlowLocked();
    }

    fn writeStatusLocked(state: *State) ![]u8 {
        var stored = try store_repository.load(state.allocator, state.io, state.data_dir);
        defer stored.deinit();
        const configured_client = state.environment.get("LOCAL_STUDIO_GITHUB_CLIENT_ID") orelse stored.client_id;
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"connectorId\":\"github\",\"configured\":");
        try output.writer.writeAll(if (configured_client != null) "true" else "false");
        try output.writer.writeAll(",\"clientId\":");
        if (configured_client) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"connected\":");
        try output.writer.writeAll(if (stored.tokens.items.len > 0) "true" else "false");
        try output.writer.writeAll(",\"account\":");
        if (stored.tokens.items.len > 0) if (stored.tokens.items[0].account) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null") else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"expiresAt\":");
        if (stored.tokens.items.len > 0) if (stored.tokens.items[0].expires_at_ms) |value| try output.writer.print("{d}", .{value}) else try output.writer.writeAll("null") else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"scopes\":[");
        if (stored.tokens.items.len > 0) for (stored.tokens.items[0].scopes, 0..) |scope, index| {
            if (index > 0) try output.writer.writeByte(',');
            try std.json.Stringify.value(scope, .{}, &output.writer);
        };
        try output.writer.writeAll("],\"accounts\":[");
        for (stored.tokens.items, 0..) |token, token_index| {
            if (token_index > 0) try output.writer.writeByte(',');
            try output.writer.writeAll("{\"id\":");
            try std.json.Stringify.value(token.account orelse "github", .{}, &output.writer);
            try output.writer.writeAll(",\"label\":");
            try std.json.Stringify.value(token.account orelse "GitHub", .{}, &output.writer);
            try output.writer.writeAll(",\"expiresAt\":");
            if (token.expires_at_ms) |value| try output.writer.print("{d}", .{value}) else try output.writer.writeAll("null");
            try output.writer.writeAll(",\"scopes\":[");
            for (token.scopes, 0..) |scope, scope_index| {
                if (scope_index > 0) try output.writer.writeByte(',');
                try std.json.Stringify.value(scope, .{}, &output.writer);
            }
            try output.writer.writeAll("]}");
        }
        try output.writer.writeAll("],\"pending\":");
        if (state.pending) |pending| {
            try output.writer.writeAll("{\"userCode\":");
            try std.json.Stringify.value(pending.user_code, .{}, &output.writer);
            try output.writer.writeAll(",\"verificationUri\":");
            try std.json.Stringify.value(pending.verification_uri, .{}, &output.writer);
            try output.writer.print(",\"expiresAt\":{d}}}", .{pending.expires_at_ms});
        } else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"error\":");
        if (state.last_error) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    fn clearPendingLocked(state: *State) void {
        if (state.pending) |*value| value.deinit();
        state.pending = null;
    }

    fn clearFlowLocked(state: *State) void {
        state.clearPendingLocked();
        if (state.last_error) |value| state.allocator.free(value);
        state.last_error = null;
    }

    fn setErrorLocked(state: *State, message: []const u8) !void {
        if (state.last_error) |value| state.allocator.free(value);
        state.last_error = try state.allocator.dupe(u8, message);
    }
};

pub fn forward(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, path: []const u8, method: http.Method, document: ?[]const u8) ![]u8 {
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", null)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    return if (method == .GET)
        node_transport.get(allocator, client, &target, path)
    else
        node_transport.send(allocator, client, &target, path, method, document);
}

const FetchResponse = struct { status: http.Status, body: []u8 };

fn postForm(allocator: std.mem.Allocator, client: *http.Client, url: []const u8, form: []const u8) !FetchResponse {
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = .POST,
        .payload = form,
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .content_type = .omit },
        .extra_headers = &.{
            .{ .name = "Content-Type", .value = "application/x-www-form-urlencoded" },
            .{ .name = "Accept", .value = "application/json" },
        },
        .response_writer = &output,
    });
    return .{ .status = response.status, .body = try allocator.dupe(u8, output.buffered()) };
}

fn fetchAccount(allocator: std.mem.Allocator, client: *http.Client, access: []const u8) !?[]u8 {
    const authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{access});
    defer allocator.free(authorization);
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = client.fetch(.{
        .location = .{ .url = identity_url },
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = &.{
            .{ .name = "Accept", .value = "application/json" },
            .{ .name = "Authorization", .value = authorization },
            .{ .name = "User-Agent", .value = "local-studio" },
        },
        .response_writer = &output,
    }) catch return null;
    if (response.status.class() != .success) return null;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, output.buffered(), .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .object) return null;
    const login = stringField(parsed.value.object, "login") orelse return null;
    return @as(?[]u8, try allocator.dupe(u8, login));
}

fn requireGithubDocument(allocator: std.mem.Allocator, document: []const u8, require_client: bool) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidOAuthPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidOAuthPayload;
    try requireGithub(stringField(parsed.value.object, "connectorId") orelse return error.ConnectorIdRequired);
    if (require_client and stringField(parsed.value.object, "clientId") == null) return error.OAuthClientRequired;
}

fn connectorFromDocument(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidOAuthPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidOAuthPayload;
    const connector_id = stringField(parsed.value.object, "connectorId") orelse return error.ConnectorIdRequired;
    return allocator.dupe(u8, connector_id);
}

fn githubClientFromDocument(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidOAuthPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidOAuthPayload;
    try requireGithub(stringField(parsed.value.object, "connectorId") orelse return error.ConnectorIdRequired);
    const client_id = stringField(parsed.value.object, "clientId") orelse return error.OAuthClientRequired;
    return allocator.dupe(u8, client_id);
}

fn requireGithub(connector_id: []const u8) !void {
    if (!std.mem.eql(u8, connector_id, "github")) return error.OAuthConnectorNotFound;
}

fn positiveInteger(object: std.json.ObjectMap, name: []const u8) ?i64 {
    const value = object.get(name) orelse return null;
    return if (value == .integer and value.integer > 0) value.integer else null;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0 or trimmed.len > 256 * 1024) null else trimmed;
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

fn nowMillis(io: Io) i64 {
    return @max(Io.Clock.real.now(io).toSeconds(), 0) * 1000;
}

fn formatTimestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds, 0)) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{ year_day.year, month_day.month.numeric(), month_day.day_index + 1, day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute() }) catch unreachable;
}
