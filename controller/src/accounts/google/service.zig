const std = @import("std");
const repository = @import("store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const agent_connectors = @import("../../agent/connectors/service.zig");
const harness_nodes = @import("../../agent/harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 2 * 1024 * 1024;

const Flow = struct {
    allocator: std.mem.Allocator,
    service: repository.Service,
    state: []u8,
    verifier: []u8,
    redirect_uri: []u8,
    client_id: []u8,
    client_secret: ?[]u8,
    listener: Io.net.Server,
    closed: std.atomic.Value(bool) = .init(false),

    fn close(flow: *Flow, io: Io) void {
        if (!flow.closed.swap(true, .acq_rel)) flow.listener.deinit(io);
    }

    fn deinit(flow: *Flow, io: Io) void {
        flow.close(io);
        flow.allocator.free(flow.state);
        flow.allocator.free(flow.verifier);
        flow.allocator.free(flow.redirect_uri);
        flow.allocator.free(flow.client_id);
        if (flow.client_secret) |value| flow.allocator.free(value);
        flow.allocator.destroy(flow);
    }
};

pub const State = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []u8,
    mutex: Io.Mutex = .init,
    tasks: Io.Group = .init,
    flows: std.ArrayList(*Flow) = .empty,

    pub fn init(allocator: std.mem.Allocator, io: Io, data_dir: []const u8) !State {
        return .{ .allocator = allocator, .io = io, .data_dir = try allocator.dupe(u8, data_dir) };
    }

    pub fn deinit(state: *State) void {
        for (state.flows.items) |flow| flow.close(state.io);
        state.tasks.cancel(state.io);
        for (state.flows.items) |flow| flow.deinit(state.io);
        state.flows.deinit(state.allocator);
        state.allocator.free(state.data_dir);
        state.* = undefined;
    }

    pub fn accountPayload(state: *State) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        return writeAccount(state.allocator, &store);
    }

    pub fn clientPayload(state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidGooglePayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidGooglePayload;
        const client_id = stringField(parsed.value.object, "clientId") orelse return error.GoogleClientRequired;
        const client_secret = stringField(parsed.value.object, "clientSecret");
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.cancelAllLocked();
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        const replacing = store.client_id == null or !std.mem.eql(u8, store.client_id.?, client_id);
        if (store.client_id) |value| state.allocator.free(value);
        store.client_id = try state.allocator.dupe(u8, client_id);
        if (client_secret) |incoming| {
            if (store.client_secret) |value| state.allocator.free(value);
            store.client_secret = try state.allocator.dupe(u8, incoming);
        }
        if (replacing) {
            for (store.accounts.items) |*account| account.deinit();
            store.accounts.clearRetainingCapacity();
            try agent_connectors.clearGoogleLocal(state.allocator, state.io, database);
        }
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return writeAccount(state.allocator, &store);
    }

    pub fn authorizePayload(state: *State, client: *http.Client, database: *sqlite.Database, document: []const u8) ![]u8 {
        const service = try serviceFromDocument(state.allocator, document);
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.cancelServiceLocked(service);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        const client_id = store.client_id orelse return error.GoogleClientRequired;
        var verifier_random: [64]u8 = undefined;
        var state_random: [32]u8 = undefined;
        state.io.random(&verifier_random);
        state.io.random(&state_random);
        const verifier = try base64Url(state.allocator, &verifier_random);
        errdefer state.allocator.free(verifier);
        const state_value = try base64Url(state.allocator, &state_random);
        errdefer state.allocator.free(state_value);
        const address = try Io.net.IpAddress.parse("127.0.0.1", 0);
        var listener = try address.listen(state.io, .{ .reuse_address = false });
        errdefer listener.deinit(state.io);
        const redirect_uri = try std.fmt.allocPrint(state.allocator, "http://127.0.0.1:{d}/callback", .{listener.socket.address.getPort()});
        errdefer state.allocator.free(redirect_uri);
        const flow = try state.allocator.create(Flow);
        errdefer state.allocator.destroy(flow);
        flow.* = .{
            .allocator = state.allocator,
            .service = service,
            .state = state_value,
            .verifier = verifier,
            .redirect_uri = redirect_uri,
            .client_id = try state.allocator.dupe(u8, client_id),
            .client_secret = if (store.client_secret) |value| try state.allocator.dupe(u8, value) else null,
            .listener = listener,
        };
        errdefer flow.deinit(state.io);
        try state.flows.append(state.allocator, flow);
        state.tasks.concurrent(state.io, runCallback, .{ state, client, database, flow }) catch |failure| {
            _ = state.flows.pop();
            return failure;
        };
        var digest: [32]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(flow.verifier, &digest, .{});
        const challenge = try base64Url(state.allocator, &digest);
        defer state.allocator.free(challenge);
        var url: Io.Writer.Allocating = .init(state.allocator);
        defer url.deinit();
        try url.writer.writeAll("https://accounts.google.com/o/oauth2/v2/auth?client_id=");
        try queryEncode(&url.writer, flow.client_id);
        try url.writer.writeAll("&redirect_uri=");
        try queryEncode(&url.writer, flow.redirect_uri);
        try url.writer.writeAll("&response_type=code&scope=");
        try queryEncode(&url.writer, scopes(service));
        try url.writer.writeAll("&state=");
        try queryEncode(&url.writer, flow.state);
        try url.writer.writeAll("&code_challenge=");
        try queryEncode(&url.writer, challenge);
        try url.writer.writeAll("&code_challenge_method=S256&access_type=offline&prompt=select_account%20consent&include_granted_scopes=true");
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"authorizationUrl\":");
        try std.json.Stringify.value(url.writer.buffered(), .{}, &output.writer);
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn cancelPayload(state: *State) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.cancelAllLocked();
        return state.allocator.dupe(u8, "{\"cancelled\":true}");
    }

    pub fn disconnectPayload(state: *State, client: *http.Client, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidGooglePayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidGooglePayload;
        const service = try repository.Service.parse(stringField(parsed.value.object, "account") orelse return error.InvalidGoogleService);
        const account_key = stringField(parsed.value.object, "accountKey") orelse return error.GoogleAccountKeyRequired;
        if (!repository.validKey(account_key)) return error.GoogleAccountKeyRequired;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        const account = store.find(account_key) orelse return error.GoogleAccountNotFound;
        const connection = account.connection(service);
        if (connection.*) |*value| {
            revoke(client, value.refresh_token) catch {};
            value.deinit();
            connection.* = null;
        }
        try agent_connectors.disconnectGoogleLocal(state.allocator, state.io, database, service.name(), account_key);
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return writeAccount(state.allocator, &store);
    }

    fn cancelServiceLocked(state: *State, service: repository.Service) void {
        for (state.flows.items) |flow| if (flow.service == service and !flow.closed.load(.acquire)) flow.close(state.io);
    }

    fn cancelAllLocked(state: *State) void {
        for (state.flows.items) |flow| flow.close(state.io);
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

fn runCallback(state: *State, client: *http.Client, database: *sqlite.Database, flow: *Flow) Io.Cancelable!void {
    var stream = flow.listener.accept(state.io) catch return;
    defer stream.close(state.io);
    var send_buffer: [8192]u8 = undefined;
    var receive_buffer: [8192]u8 = undefined;
    var reader = stream.reader(state.io, &receive_buffer);
    var writer = stream.writer(state.io, &send_buffer);
    var server: http.Server = .init(&reader.interface, &writer.interface);
    var request = server.receiveHead() catch return;
    const callback_state = queryValue(state.allocator, request.head.target, "state") catch null;
    defer if (callback_state) |value| state.allocator.free(value);
    const code = queryValue(state.allocator, request.head.target, "code") catch null;
    defer if (code) |value| state.allocator.free(value);
    const valid = callback_state != null and code != null and std.mem.eql(u8, callback_state.?, flow.state) and std.mem.startsWith(u8, request.head.target, "/callback?");
    const success = if (valid) completeFlow(state, client, database, flow, code.?) catch false else false;
    const html = if (success)
        "<!doctype html><html><body><h1>Google Workspace connected</h1><p>You can close this tab and return to Local Studio.</p></body></html>"
    else
        "<!doctype html><html><body><h1>Google sign-in failed</h1><p>Return to Local Studio and start again.</p></body></html>";
    request.respond(html, .{ .status = if (success) .ok else .bad_request, .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "text/html; charset=utf-8" }} }) catch {};
    flow.close(state.io);
}

fn completeFlow(state: *State, client: *http.Client, database: *sqlite.Database, flow: *Flow, code: []const u8) !bool {
    var form: Io.Writer.Allocating = .init(state.allocator);
    defer form.deinit();
    try form.writer.writeAll("client_id=");
    try queryEncode(&form.writer, flow.client_id);
    try form.writer.writeAll("&code=");
    try queryEncode(&form.writer, code);
    try form.writer.writeAll("&code_verifier=");
    try queryEncode(&form.writer, flow.verifier);
    try form.writer.writeAll("&grant_type=authorization_code&redirect_uri=");
    try queryEncode(&form.writer, flow.redirect_uri);
    if (flow.client_secret) |value| {
        try form.writer.writeAll("&client_secret=");
        try queryEncode(&form.writer, value);
    }
    const token_response = try fetchJson(state.allocator, client, "https://oauth2.googleapis.com/token", .POST, form.writer.buffered(), null);
    defer state.allocator.free(token_response.body);
    if (token_response.status.class() != .success) return false;
    var token = std.json.parseFromSlice(std.json.Value, state.allocator, token_response.body, .{}) catch return false;
    defer token.deinit();
    if (token.value != .object) return false;
    const access = stringField(token.value.object, "access_token") orelse return false;
    const refresh = stringField(token.value.object, "refresh_token");
    const scope_value = stringField(token.value.object, "scope") orelse return false;
    if (!requiredScopesPresent(flow.service, scope_value)) return false;
    const profile_response = try fetchJson(state.allocator, client, "https://openidconnect.googleapis.com/v1/userinfo", .GET, null, access);
    defer state.allocator.free(profile_response.body);
    if (profile_response.status.class() != .success) return false;
    var profile = std.json.parseFromSlice(std.json.Value, state.allocator, profile_response.body, .{}) catch return false;
    defer profile.deinit();
    if (profile.value != .object) return false;
    const email = stringField(profile.value.object, "email") orelse return false;
    const account_key_buffer = repository.accountKey(email);
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    var store = try repository.load(state.allocator, state.io, state.data_dir);
    defer store.deinit();
    var account = store.find(&account_key_buffer);
    if (account == null) {
        try store.accounts.append(state.allocator, .{
            .allocator = state.allocator,
            .key = try state.allocator.dupe(u8, &account_key_buffer),
            .email = try state.allocator.dupe(u8, email),
        });
        account = &store.accounts.items[store.accounts.items.len - 1];
    }
    const slot = account.?.connection(flow.service);
    const effective_refresh = refresh orelse if (slot.*) |connection| connection.refresh_token else return false;
    if (slot.*) |*connection| connection.deinit();
    var scopes_list: std.ArrayList([]u8) = .empty;
    errdefer {
        for (scopes_list.items) |scope| state.allocator.free(scope);
        scopes_list.deinit(state.allocator);
    }
    var scope_iterator = std.mem.tokenizeAny(u8, scope_value, " \t\r\n");
    while (scope_iterator.next()) |scope| try scopes_list.append(state.allocator, try state.allocator.dupe(u8, scope));
    var timestamp_buffer: [24]u8 = undefined;
    slot.* = .{
        .allocator = state.allocator,
        .refresh_token = try state.allocator.dupe(u8, effective_refresh),
        .scopes = try scopes_list.toOwnedSlice(state.allocator),
        .connected_at = try state.allocator.dupe(u8, formatTimestamp(state.io, &timestamp_buffer)),
    };
    try repository.save(state.allocator, state.io, state.data_dir, &store);
    try agent_connectors.connectGoogleLocal(state.allocator, state.io, database, flow.service.name(), &account_key_buffer, email);
    return true;
}

fn writeAccount(allocator: std.mem.Allocator, store: *repository.Store) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"account\":{\"configured\":");
    try output.writer.writeAll(if (store.client_id != null) "true" else "false");
    try output.writer.writeAll(",\"clientId\":");
    if (store.client_id) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"hasClientSecret\":");
    try output.writer.writeAll(if (store.client_secret != null) "true" else "false");
    try output.writer.writeAll(",\"transport\":\"rest\",\"accounts\":[");
    for (store.accounts.items, 0..) |account, index| {
        if (index > 0) try output.writer.writeByte(',');
        try output.writer.writeAll("{\"key\":");
        try std.json.Stringify.value(account.key, .{}, &output.writer);
        try output.writer.writeAll(",\"email\":");
        try std.json.Stringify.value(account.email, .{}, &output.writer);
        try output.writer.writeAll(",\"connections\":{\"gmail\":");
        try writeConnectionView(&output.writer, account.gmail, .gmail);
        try output.writer.writeAll(",\"google-calendar\":");
        try writeConnectionView(&output.writer, account.calendar, .calendar);
        try output.writer.writeAll("}}");
    }
    try output.writer.writeAll("]}}");
    return output.toOwnedSlice();
}

fn writeConnectionView(writer: *Io.Writer, connection: ?repository.Connection, service: repository.Service) !void {
    try writer.writeAll("{\"connected\":");
    try writer.writeAll(if (connection != null) "true" else "false");
    try writer.writeAll(",\"scopes\":[");
    if (connection) |value| for (value.scopes, 0..) |scope, index| {
        if (index > 0) try writer.writeByte(',');
        try std.json.Stringify.value(scope, .{}, writer);
    };
    try writer.writeAll("],\"endpoint\":");
    if (connection != null) try std.json.Stringify.value(service.endpoint(), .{}, writer) else try writer.writeAll("\"\"");
    try writer.writeAll(",\"connectedAt\":");
    if (connection) |value| try std.json.Stringify.value(value.connected_at, .{}, writer) else try writer.writeAll("null");
    try writer.writeByte('}');
}

const FetchResponse = struct { status: http.Status, body: []u8 };

fn fetchJson(allocator: std.mem.Allocator, client: *http.Client, url: []const u8, method: http.Method, payload: ?[]const u8, access: ?[]const u8) !FetchResponse {
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const authorization = if (access) |value| try std.fmt.allocPrint(allocator, "Bearer {s}", .{value}) else null;
    defer if (authorization) |value| allocator.free(value);
    var headers: [3]http.Header = undefined;
    var count: usize = 0;
    headers[count] = .{ .name = "Accept", .value = "application/json" };
    count += 1;
    if (payload != null) {
        headers[count] = .{ .name = "Content-Type", .value = "application/x-www-form-urlencoded" };
        count += 1;
    }
    if (authorization) |value| {
        headers[count] = .{ .name = "Authorization", .value = value };
        count += 1;
    }
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = method,
        .payload = payload,
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .content_type = .omit },
        .extra_headers = headers[0..count],
        .response_writer = &output,
    });
    return .{ .status = response.status, .body = try allocator.dupe(u8, output.buffered()) };
}

fn revoke(client: *http.Client, refresh_token: []const u8) !void {
    var form_buffer: [512 * 1024]u8 = undefined;
    var form: Io.Writer = .fixed(&form_buffer);
    try form.writeAll("token=");
    try queryEncode(&form, refresh_token);
    const response = try fetchJson(std.heap.page_allocator, client, "https://oauth2.googleapis.com/revoke", .POST, form.buffered(), null);
    defer std.heap.page_allocator.free(response.body);
}

fn serviceFromDocument(allocator: std.mem.Allocator, document: []const u8) !repository.Service {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidGooglePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidGooglePayload;
    return repository.Service.parse(stringField(parsed.value.object, "account") orelse return error.InvalidGoogleService);
}

fn requiredScopesPresent(service: repository.Service, value: []const u8) bool {
    var required = std.mem.tokenizeScalar(u8, if (service == .gmail) "https://www.googleapis.com/auth/gmail.readonly" else "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.readonly", ' ');
    while (required.next()) |scope| if (std.mem.indexOf(u8, value, scope) == null) return false;
    return true;
}

fn scopes(service: repository.Service) []const u8 {
    return if (service == .gmail)
        "openid email https://www.googleapis.com/auth/gmail.readonly"
    else
        "openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.readonly";
}

fn base64Url(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const size = std.base64.url_safe_no_pad.Encoder.calcSize(value.len);
    const output = try allocator.alloc(u8, size);
    _ = std.base64.url_safe_no_pad.Encoder.encode(output, value);
    return output;
}

fn queryValue(allocator: std.mem.Allocator, target: []const u8, expected: []const u8) !?[]u8 {
    const query_start = std.mem.findScalar(u8, target, '?') orelse return null;
    var parameters = std.mem.splitScalar(u8, target[query_start + 1 ..], '&');
    while (parameters.next()) |parameter| {
        const separator = std.mem.findScalar(u8, parameter, '=') orelse continue;
        if (!std.mem.eql(u8, parameter[0..separator], expected)) continue;
        const storage = try allocator.dupe(u8, parameter[separator + 1 ..]);
        return std.Uri.percentDecodeInPlace(storage);
    }
    return null;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0 or trimmed.len > 256 * 1024) null else trimmed;
}

fn queryEncode(writer: *Io.Writer, value: []const u8) !void {
    const hex = "0123456789ABCDEF";
    for (value) |byte| {
        if (std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '_' or byte == '.' or byte == '~') {
            try writer.writeByte(byte);
        } else {
            try writer.writeByte('%');
            try writer.writeByte(hex[byte >> 4]);
            try writer.writeByte(hex[byte & 15]);
        }
    }
}

fn formatTimestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds, 0)) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{ year_day.year, month_day.month.numeric(), month_day.day_index + 1, day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute() }) catch unreachable;
}
