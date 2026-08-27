const std = @import("std");
const repository = @import("store.zig");
const catalog = @import("../../agent/mcp/catalog.zig");
const connectors = @import("../../agent/connectors/service.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 2 * 1024 * 1024;
const initialize_document = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"clientInfo\":{\"name\":\"Local Studio\",\"version\":\"2.1.0\"}}}";

const Flow = struct {
    allocator: std.mem.Allocator,
    provider: []u8,
    provider_name: []u8,
    resource: []u8,
    token_endpoint: []u8,
    client_id: []u8,
    client_secret: ?[]u8,
    scopes: []u8,
    state: []u8,
    account: []u8,
    verifier: []u8,
    redirect_uri: []u8,
    listener: Io.net.Server,
    closed: std.atomic.Value(bool) = .init(false),
    error_message: ?[]u8 = null,

    fn close(flow: *Flow, io: Io) void {
        if (!flow.closed.swap(true, .acq_rel)) flow.listener.deinit(io);
    }

    fn deinit(flow: *Flow, io: Io) void {
        flow.close(io);
        flow.allocator.free(flow.provider);
        flow.allocator.free(flow.provider_name);
        flow.allocator.free(flow.resource);
        flow.allocator.free(flow.token_endpoint);
        flow.allocator.free(flow.client_id);
        if (flow.client_secret) |value| flow.allocator.free(value);
        flow.allocator.free(flow.scopes);
        flow.allocator.free(flow.state);
        flow.allocator.free(flow.account);
        flow.allocator.free(flow.verifier);
        flow.allocator.free(flow.redirect_uri);
        if (flow.error_message) |value| flow.allocator.free(value);
        flow.allocator.destroy(flow);
    }
};

const Discovery = struct {
    allocator: std.mem.Allocator,
    resource: []u8,
    authorization_endpoint: []u8,
    token_endpoint: []u8,
    registration_endpoint: ?[]u8,
    scopes: []u8,

    fn deinit(value: *Discovery) void {
        value.allocator.free(value.resource);
        value.allocator.free(value.authorization_endpoint);
        value.allocator.free(value.token_endpoint);
        if (value.registration_endpoint) |endpoint| value.allocator.free(endpoint);
        value.allocator.free(value.scopes);
        value.* = undefined;
    }
};

const Registration = struct {
    allocator: std.mem.Allocator,
    client_id: []u8,
    client_secret: ?[]u8,

    fn deinit(value: *Registration) void {
        value.allocator.free(value.client_id);
        if (value.client_secret) |secret| value.allocator.free(secret);
        value.* = undefined;
    }
};

pub const State = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []u8,
    environment: *const std.process.Environ.Map,
    mutex: Io.Mutex = .init,
    tasks: Io.Group = .init,
    flows: std.ArrayList(*Flow) = .empty,

    pub fn init(allocator: std.mem.Allocator, io: Io, data_dir: []const u8, environment: *const std.process.Environ.Map) !State {
        return .{
            .allocator = allocator,
            .io = io,
            .data_dir = try allocator.dupe(u8, data_dir),
            .environment = environment,
        };
    }

    pub fn deinit(state: *State) void {
        for (state.flows.items) |flow| flow.close(state.io);
        state.tasks.cancel(state.io);
        for (state.flows.items) |flow| flow.deinit(state.io);
        state.flows.deinit(state.allocator);
        state.allocator.free(state.data_dir);
        state.* = undefined;
    }

    pub fn authorizePayload(state: *State, client: *http.Client, database: *sqlite.Database, document: []const u8) ![]u8 {
        const provider = try providerFromDocument(state.allocator, document);
        defer state.allocator.free(provider);
        const remote = catalog.oauthRemote(provider) orelse return error.OAuthConnectorNotFound;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.cancelProviderLocked(provider);
        const address = try Io.net.IpAddress.parse("127.0.0.1", 0);
        var listener = try address.listen(state.io, .{ .reuse_address = false });
        errdefer listener.deinit(state.io);
        const redirect_uri = try std.fmt.allocPrint(state.allocator, "http://127.0.0.1:{d}/callback", .{listener.socket.address.getPort()});
        errdefer state.allocator.free(redirect_uri);
        var discovery = try discover(state.allocator, client, remote.url);
        defer discovery.deinit();
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        const configured_client = if (remote.client_id_env) |name| state.environment.get(name) orelse store.clientId(provider) else null;
        var registration = if (configured_client) |client_id|
            Registration{ .allocator = state.allocator, .client_id = try state.allocator.dupe(u8, client_id), .client_secret = null }
        else if (discovery.registration_endpoint) |endpoint|
            try registerClient(state.allocator, client, endpoint, redirect_uri)
        else
            return error.OAuthClientRequired;
        defer registration.deinit();
        var verifier_random: [64]u8 = undefined;
        var state_random: [32]u8 = undefined;
        var account_random: [12]u8 = undefined;
        state.io.random(&verifier_random);
        state.io.random(&state_random);
        state.io.random(&account_random);
        const verifier = try base64Url(state.allocator, &verifier_random);
        errdefer state.allocator.free(verifier);
        const state_value = try base64Url(state.allocator, &state_random);
        errdefer state.allocator.free(state_value);
        const account = try base64Url(state.allocator, &account_random);
        errdefer state.allocator.free(account);
        const flow = try state.allocator.create(Flow);
        errdefer state.allocator.destroy(flow);
        flow.* = .{
            .allocator = state.allocator,
            .provider = try state.allocator.dupe(u8, provider),
            .provider_name = try state.allocator.dupe(u8, remote.name),
            .resource = try state.allocator.dupe(u8, discovery.resource),
            .token_endpoint = try state.allocator.dupe(u8, discovery.token_endpoint),
            .client_id = try state.allocator.dupe(u8, registration.client_id),
            .client_secret = if (registration.client_secret) |value| try state.allocator.dupe(u8, value) else null,
            .scopes = try state.allocator.dupe(u8, discovery.scopes),
            .state = state_value,
            .account = account,
            .verifier = verifier,
            .redirect_uri = redirect_uri,
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
        try url.writer.writeAll(discovery.authorization_endpoint);
        try url.writer.writeByte(if (std.mem.findScalar(u8, discovery.authorization_endpoint, '?') == null) '?' else '&');
        try url.writer.writeAll("response_type=code&client_id=");
        try queryEncode(&url.writer, flow.client_id);
        try url.writer.writeAll("&redirect_uri=");
        try queryEncode(&url.writer, flow.redirect_uri);
        try url.writer.writeAll("&state=");
        try queryEncode(&url.writer, flow.state);
        try url.writer.writeAll("&code_challenge=");
        try queryEncode(&url.writer, challenge);
        try url.writer.writeAll("&code_challenge_method=S256&resource=");
        try queryEncode(&url.writer, flow.resource);
        if (flow.scopes.len > 0) {
            try url.writer.writeAll("&scope=");
            try queryEncode(&url.writer, flow.scopes);
        }
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"flow\":\"pkce\",\"authorizeUrl\":");
        try std.json.Stringify.value(url.writer.buffered(), .{}, &output.writer);
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn cancelPayload(state: *State, document: []const u8) ![]u8 {
        const provider = try providerFromDocument(state.allocator, document);
        defer state.allocator.free(provider);
        return state.cancelProviderPayload(provider);
    }

    pub fn cancelProviderPayload(state: *State, provider: []const u8) ![]u8 {
        _ = catalog.oauthRemote(provider) orelse return error.OAuthConnectorNotFound;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.cancelProviderLocked(provider);
        return state.allocator.dupe(u8, "{\"cancelled\":true}");
    }

    pub fn statusPayload(state: *State, provider: []const u8) ![]u8 {
        const remote = catalog.oauthRemote(provider) orelse return error.OAuthConnectorNotFound;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        const configured_client = if (remote.client_id_env) |name| state.environment.get(name) orelse store.clientId(provider) else null;
        const configured = remote.client_id_env == null or configured_client != null;
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"connectorId\":");
        try std.json.Stringify.value(provider, .{}, &output.writer);
        try output.writer.print(",\"configured\":{},\"clientId\":", .{configured});
        if (configured_client) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
        var count: usize = 0;
        for (store.grants.items) |grant| {
            if (std.mem.eql(u8, grant.provider, provider)) count += 1;
        }
        try output.writer.print(",\"connected\":{},\"account\":null,\"expiresAt\":null,\"scopes\":[", .{count > 0});
        var wrote_scope = false;
        for (store.grants.items) |grant| {
            if (!std.mem.eql(u8, grant.provider, provider)) continue;
            for (grant.scopes) |scope| {
                if (wrote_scope) try output.writer.writeByte(',');
                try std.json.Stringify.value(scope, .{}, &output.writer);
                wrote_scope = true;
            }
            break;
        }
        try output.writer.writeAll("],\"accounts\":[");
        var wrote_account = false;
        for (store.grants.items) |grant| {
            if (!std.mem.eql(u8, grant.provider, provider)) continue;
            if (wrote_account) try output.writer.writeByte(',');
            try output.writer.writeAll("{\"id\":");
            try std.json.Stringify.value(grant.account, .{}, &output.writer);
            try output.writer.writeAll(",\"label\":");
            try std.json.Stringify.value(grant.label, .{}, &output.writer);
            try output.writer.writeAll(",\"expiresAt\":");
            if (grant.expires_at_ms) |value| try output.writer.print("{d}", .{value}) else try output.writer.writeAll("null");
            try output.writer.writeAll(",\"scopes\":[");
            for (grant.scopes, 0..) |scope, index| {
                if (index > 0) try output.writer.writeByte(',');
                try std.json.Stringify.value(scope, .{}, &output.writer);
            }
            try output.writer.writeAll("]}");
            wrote_account = true;
        }
        try output.writer.writeAll("],\"pending\":null,\"error\":");
        const active = state.latestFlow(provider);
        if (active) |flow| if (flow.error_message) |message| try std.json.Stringify.value(message, .{}, &output.writer) else try output.writer.writeAll("null") else try output.writer.writeAll("null");
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn clientPayload(state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidOAuthPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidOAuthPayload;
        const provider = stringField(parsed.value.object, "connectorId") orelse return error.ConnectorIdRequired;
        const remote = catalog.oauthRemote(provider) orelse return error.OAuthConnectorNotFound;
        if (remote.client_id_env == null) return error.OAuthClientNotConfigurable;
        const client_id = stringField(parsed.value.object, "clientId") orelse return error.OAuthClientRequired;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.cancelProviderLocked(provider);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        try repository.setClientId(state.allocator, &store, provider, client_id);
        var index: usize = 0;
        while (index < store.grants.items.len) {
            if (!std.mem.eql(u8, store.grants.items[index].provider, provider)) {
                index += 1;
                continue;
            }
            const account = try state.allocator.dupe(u8, store.grants.items[index].account);
            defer state.allocator.free(account);
            _ = repository.removeGrant(&store, provider, account);
            try connectors.disconnectRemoteOAuthLocal(state.allocator, state.io, database, provider, account);
        }
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return state.statusPayloadUnlocked(provider);
    }

    pub fn disconnectPayload(state: *State, database: *sqlite.Database, provider: []const u8, account: ?[]const u8) ![]u8 {
        _ = catalog.oauthRemote(provider) orelse return error.OAuthConnectorNotFound;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        state.cancelProviderLocked(provider);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        if (account) |selected| {
            _ = repository.removeGrant(&store, provider, selected);
            try connectors.disconnectRemoteOAuthLocal(state.allocator, state.io, database, provider, selected);
        } else {
            var index: usize = 0;
            while (index < store.grants.items.len) {
                if (!std.mem.eql(u8, store.grants.items[index].provider, provider)) {
                    index += 1;
                    continue;
                }
                const selected = try state.allocator.dupe(u8, store.grants.items[index].account);
                defer state.allocator.free(selected);
                _ = repository.removeGrant(&store, provider, selected);
                try connectors.disconnectRemoteOAuthLocal(state.allocator, state.io, database, provider, selected);
            }
        }
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return state.statusPayloadUnlocked(provider);
    }

    fn statusPayloadUnlocked(state: *State, provider: []const u8) ![]u8 {
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        const remote = catalog.oauthRemote(provider) orelse return error.OAuthConnectorNotFound;
        const configured_client = if (remote.client_id_env) |name| state.environment.get(name) orelse store.clientId(provider) else null;
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"connectorId\":");
        try std.json.Stringify.value(provider, .{}, &output.writer);
        try output.writer.print(",\"configured\":{},\"clientId\":", .{remote.client_id_env == null or configured_client != null});
        if (configured_client) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
        var count: usize = 0;
        for (store.grants.items) |grant| {
            if (std.mem.eql(u8, grant.provider, provider)) count += 1;
        }
        try output.writer.print(",\"connected\":{},\"account\":null,\"expiresAt\":null,\"scopes\":[],\"accounts\":[", .{count > 0});
        var wrote = false;
        for (store.grants.items) |grant| {
            if (!std.mem.eql(u8, grant.provider, provider)) continue;
            if (wrote) try output.writer.writeByte(',');
            try output.writer.writeAll("{\"id\":");
            try std.json.Stringify.value(grant.account, .{}, &output.writer);
            try output.writer.writeAll(",\"label\":");
            try std.json.Stringify.value(grant.label, .{}, &output.writer);
            try output.writer.writeAll(",\"expiresAt\":null,\"scopes\":[]}");
            wrote = true;
        }
        try output.writer.writeAll("],\"pending\":null,\"error\":null}");
        return output.toOwnedSlice();
    }

    fn latestFlow(state: *State, provider: []const u8) ?*Flow {
        var index = state.flows.items.len;
        while (index > 0) {
            index -= 1;
            const flow = state.flows.items[index];
            if (std.mem.eql(u8, flow.provider, provider)) return flow;
        }
        return null;
    }

    fn cancelProviderLocked(state: *State, provider: []const u8) void {
        for (state.flows.items) |flow| if (std.mem.eql(u8, flow.provider, provider)) flow.close(state.io);
    }
};

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
    const completed = if (valid) completeFlow(state, client, database, flow, code.?) catch false else false;
    if (!completed) {
        if (state.mutex.lock(state.io)) |_| {
            if (flow.error_message) |value| state.allocator.free(value);
            flow.error_message = state.allocator.dupe(u8, "The provider rejected the MCP sign-in") catch null;
            state.mutex.unlock(state.io);
        } else |_| {}
    }
    const html = if (completed)
        "<!doctype html><html><body><h1>Account connected</h1><p>You can close this tab and return to Local Studio.</p></body></html>"
    else
        "<!doctype html><html><body><h1>Sign-in failed</h1><p>Return to Local Studio and try again.</p></body></html>";
    request.respond(html, .{ .status = if (completed) .ok else .bad_request, .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "text/html; charset=utf-8" }} }) catch {};
    flow.close(state.io);
}

fn completeFlow(state: *State, client: *http.Client, database: *sqlite.Database, flow: *Flow, code: []const u8) !bool {
    var form: Io.Writer.Allocating = .init(state.allocator);
    defer form.deinit();
    try form.writer.writeAll("grant_type=authorization_code&code=");
    try queryEncode(&form.writer, code);
    try form.writer.writeAll("&code_verifier=");
    try queryEncode(&form.writer, flow.verifier);
    try form.writer.writeAll("&client_id=");
    try queryEncode(&form.writer, flow.client_id);
    try form.writer.writeAll("&redirect_uri=");
    try queryEncode(&form.writer, flow.redirect_uri);
    try form.writer.writeAll("&resource=");
    try queryEncode(&form.writer, flow.resource);
    if (flow.client_secret) |secret| {
        try form.writer.writeAll("&client_secret=");
        try queryEncode(&form.writer, secret);
    }
    const response = try fetch(state.allocator, client, flow.token_endpoint, .POST, form.writer.buffered(), "application/x-www-form-urlencoded");
    defer state.allocator.free(response.body);
    if (response.status.class() != .success) return false;
    var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, response.body, .{}) catch return false;
    defer parsed.deinit();
    if (parsed.value != .object) return false;
    const access = stringField(parsed.value.object, "access_token") orelse return false;
    var scopes: std.ArrayList([]u8) = .empty;
    errdefer {
        for (scopes.items) |scope| state.allocator.free(scope);
        scopes.deinit(state.allocator);
    }
    var scope_values = std.mem.tokenizeAny(u8, stringField(parsed.value.object, "scope") orelse flow.scopes, " ,\t\r\n");
    while (scope_values.next()) |scope| try scopes.append(state.allocator, try state.allocator.dupe(u8, scope));
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    var store = try repository.load(state.allocator, state.io, state.data_dir);
    defer store.deinit();
    var account_count: usize = 1;
    for (store.grants.items) |grant| {
        if (std.mem.eql(u8, grant.provider, flow.provider)) account_count += 1;
    }
    const label = try std.fmt.allocPrint(state.allocator, "{s} account {d}", .{ flow.provider_name, account_count });
    errdefer state.allocator.free(label);
    const replacement = repository.Grant{
        .allocator = state.allocator,
        .provider = try state.allocator.dupe(u8, flow.provider),
        .account = try state.allocator.dupe(u8, flow.account),
        .label = label,
        .resource = try state.allocator.dupe(u8, flow.resource),
        .token_endpoint = try state.allocator.dupe(u8, flow.token_endpoint),
        .client_id = try state.allocator.dupe(u8, flow.client_id),
        .client_secret = if (flow.client_secret) |value| try state.allocator.dupe(u8, value) else null,
        .access_token = try state.allocator.dupe(u8, access),
        .refresh_token = if (stringField(parsed.value.object, "refresh_token")) |value| try state.allocator.dupe(u8, value) else null,
        .scopes = try scopes.toOwnedSlice(state.allocator),
        .expires_at_ms = if (positiveInteger(parsed.value.object, "expires_in")) |seconds| nowMillis(state.io) + seconds * 1000 else null,
    };
    try repository.upsertGrant(state.allocator, &store, replacement);
    try repository.save(state.allocator, state.io, state.data_dir, &store);
    try connectors.connectRemoteOAuthLocal(state.allocator, state.io, database, flow.provider, flow.account, label, flow.resource, catalog.oauthRemote(flow.provider).?.protocol_era);
    return true;
}

fn discover(allocator: std.mem.Allocator, client: *http.Client, endpoint: []const u8) !Discovery {
    const resource_candidates = try protectedResourceMetadataCandidates(allocator, endpoint);
    defer {
        for (resource_candidates) |value| allocator.free(value);
        allocator.free(resource_candidates);
    }
    var resource_body: ?[]u8 = null;
    for (resource_candidates) |candidate| {
        const response = fetch(allocator, client, candidate, .GET, null, null) catch continue;
        if (response.status.class() == .success) {
            resource_body = response.body;
            break;
        }
        allocator.free(response.body);
    }
    if (resource_body == null) {
        const challenged_url = try protectedResourceMetadataUrl(allocator, client, endpoint);
        defer allocator.free(challenged_url);
        const response = try fetch(allocator, client, challenged_url, .GET, null, null);
        if (response.status.class() == .success) resource_body = response.body else allocator.free(response.body);
    }
    const protected_resource_body = resource_body orelse return error.McpOAuthDiscoveryRejected;
    defer allocator.free(protected_resource_body);
    var resource_parsed = std.json.parseFromSlice(std.json.Value, allocator, protected_resource_body, .{}) catch return error.InvalidMcpOAuthMetadata;
    defer resource_parsed.deinit();
    if (resource_parsed.value != .object) return error.InvalidMcpOAuthMetadata;
    const resource = stringField(resource_parsed.value.object, "resource") orelse return error.InvalidMcpOAuthMetadata;
    const servers = resource_parsed.value.object.get("authorization_servers") orelse return error.InvalidMcpOAuthMetadata;
    if (servers != .array or servers.array.items.len == 0 or servers.array.items[0] != .string) return error.InvalidMcpOAuthMetadata;
    const issuer = servers.array.items[0].string;
    const metadata_candidates = try authorizationMetadataCandidates(allocator, issuer);
    defer {
        for (metadata_candidates) |value| allocator.free(value);
        allocator.free(metadata_candidates);
    }
    var metadata_body: ?[]u8 = null;
    for (metadata_candidates) |candidate| {
        const response = fetch(allocator, client, candidate, .GET, null, null) catch continue;
        if (response.status.class() == .success) {
            metadata_body = response.body;
            break;
        }
        allocator.free(response.body);
    }
    const body = metadata_body orelse return error.McpOAuthDiscoveryRejected;
    defer allocator.free(body);
    var metadata = std.json.parseFromSlice(std.json.Value, allocator, body, .{}) catch return error.InvalidMcpOAuthMetadata;
    defer metadata.deinit();
    if (metadata.value != .object) return error.InvalidMcpOAuthMetadata;
    if (!arrayContains(metadata.value.object, "code_challenge_methods_supported", "S256")) return error.McpOAuthPkceRequired;
    const authorization_endpoint = stringField(metadata.value.object, "authorization_endpoint") orelse return error.InvalidMcpOAuthMetadata;
    const token_endpoint = stringField(metadata.value.object, "token_endpoint") orelse return error.InvalidMcpOAuthMetadata;
    try requireHttps(authorization_endpoint);
    try requireHttps(token_endpoint);
    const registration_endpoint = stringField(metadata.value.object, "registration_endpoint");
    if (registration_endpoint) |value| try requireHttps(value);
    const scopes = try joinScopes(allocator, resource_parsed.value.object.get("scopes_supported"));
    return .{
        .allocator = allocator,
        .resource = try allocator.dupe(u8, resource),
        .authorization_endpoint = try allocator.dupe(u8, authorization_endpoint),
        .token_endpoint = try allocator.dupe(u8, token_endpoint),
        .registration_endpoint = if (registration_endpoint) |value| try allocator.dupe(u8, value) else null,
        .scopes = scopes,
    };
}

fn protectedResourceMetadataCandidates(allocator: std.mem.Allocator, endpoint: []const u8) ![][]u8 {
    try requireHttps(endpoint);
    const scheme = std.mem.indexOf(u8, endpoint, "://") orelse return error.InvalidConnectorUrl;
    const path_start = std.mem.indexOfScalarPos(u8, endpoint, scheme + 3, '/');
    const origin = if (path_start) |index| endpoint[0..index] else endpoint;
    const raw_path = if (path_start) |index| endpoint[index..] else "";
    const path_value = std.mem.trim(u8, raw_path, "/");
    var candidates: std.ArrayList([]u8) = .empty;
    errdefer {
        for (candidates.items) |value| allocator.free(value);
        candidates.deinit(allocator);
    }
    if (path_value.len > 0) try candidates.append(allocator, try std.fmt.allocPrint(allocator, "{s}/.well-known/oauth-protected-resource/{s}", .{ origin, path_value }));
    try candidates.append(allocator, try std.fmt.allocPrint(allocator, "{s}/.well-known/oauth-protected-resource", .{origin}));
    return candidates.toOwnedSlice(allocator);
}

fn protectedResourceMetadataUrl(allocator: std.mem.Allocator, client: *http.Client, endpoint: []const u8) ![]u8 {
    const uri = std.Uri.parse(endpoint) catch return error.InvalidConnectorUrl;
    try requireHttps(endpoint);
    var request = try client.request(.POST, uri, .{
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .authorization = .omit, .user_agent = .omit, .connection = .omit, .accept_encoding = .omit, .content_type = .omit },
        .extra_headers = &.{
            .{ .name = "Content-Type", .value = "application/json" },
            .{ .name = "Accept", .value = "application/json, text/event-stream" },
            .{ .name = "MCP-Protocol-Version", .value = "2025-11-25" },
        },
    });
    defer request.deinit();
    request.transfer_encoding = .{ .content_length = initialize_document.len };
    var write_buffer: [16 * 1024]u8 = undefined;
    var body = try request.sendBody(&write_buffer);
    try body.writer.writeAll(initialize_document);
    try body.end();
    var redirect_buffer: [16 * 1024]u8 = undefined;
    var response = try request.receiveHead(&redirect_buffer);
    if (response.head.status != .unauthorized) return error.McpOAuthChallengeRequired;
    var challenge: ?[]const u8 = null;
    var headers = response.head.iterateHeaders();
    while (headers.next()) |header| if (std.ascii.eqlIgnoreCase(header.name, "www-authenticate")) {
        challenge = header.value;
        break;
    };
    const value = challenge orelse return error.McpOAuthChallengeRequired;
    const metadata = bearerParameter(value, "resource_metadata") orelse return error.McpOAuthResourceMetadataRequired;
    try requireHttps(metadata);
    return allocator.dupe(u8, metadata);
}

fn registerClient(allocator: std.mem.Allocator, client: *http.Client, endpoint: []const u8, redirect_uri: []const u8) !Registration {
    var document: Io.Writer.Allocating = .init(allocator);
    defer document.deinit();
    try document.writer.writeAll("{\"client_name\":\"Local Studio\",\"redirect_uris\":[");
    try std.json.Stringify.value(redirect_uri, .{}, &document.writer);
    try document.writer.writeAll("],\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"response_types\":[\"code\"],\"token_endpoint_auth_method\":\"none\"}");
    const response = try fetch(allocator, client, endpoint, .POST, document.writer.buffered(), "application/json");
    defer allocator.free(response.body);
    if (response.status.class() != .success) return error.McpOAuthRegistrationRejected;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response.body, .{}) catch return error.InvalidMcpOAuthResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidMcpOAuthResponse;
    const client_id = stringField(parsed.value.object, "client_id") orelse return error.InvalidMcpOAuthResponse;
    return .{
        .allocator = allocator,
        .client_id = try allocator.dupe(u8, client_id),
        .client_secret = if (stringField(parsed.value.object, "client_secret")) |value| try allocator.dupe(u8, value) else null,
    };
}

const FetchResponse = struct { status: http.Status, body: []u8 };

fn fetch(allocator: std.mem.Allocator, client: *http.Client, url: []const u8, method: http.Method, payload: ?[]const u8, content_type: ?[]const u8) !FetchResponse {
    try requireHttps(url);
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    var headers: [2]http.Header = undefined;
    var count: usize = 0;
    headers[count] = .{ .name = "Accept", .value = "application/json" };
    count += 1;
    if (content_type) |value| {
        headers[count] = .{ .name = "Content-Type", .value = value };
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

fn authorizationMetadataCandidates(allocator: std.mem.Allocator, issuer: []const u8) ![][]u8 {
    try requireHttps(issuer);
    const scheme = std.mem.indexOf(u8, issuer, "://") orelse return error.InvalidMcpOAuthMetadata;
    const path_start = std.mem.indexOfScalarPos(u8, issuer, scheme + 3, '/');
    const origin = if (path_start) |index| issuer[0..index] else issuer;
    const path_value = if (path_start) |index| std.mem.trimEnd(u8, issuer[index..], "/") else "";
    var candidates: std.ArrayList([]u8) = .empty;
    errdefer {
        for (candidates.items) |value| allocator.free(value);
        candidates.deinit(allocator);
    }
    if (path_value.len > 0) {
        try candidates.append(allocator, try std.fmt.allocPrint(allocator, "{s}/.well-known/oauth-authorization-server{s}", .{ origin, path_value }));
        try candidates.append(allocator, try std.fmt.allocPrint(allocator, "{s}/.well-known/openid-configuration{s}", .{ origin, path_value }));
        try candidates.append(allocator, try std.fmt.allocPrint(allocator, "{s}{s}/.well-known/openid-configuration", .{ origin, path_value }));
    } else {
        try candidates.append(allocator, try std.fmt.allocPrint(allocator, "{s}/.well-known/oauth-authorization-server", .{origin}));
        try candidates.append(allocator, try std.fmt.allocPrint(allocator, "{s}/.well-known/openid-configuration", .{origin}));
    }
    return candidates.toOwnedSlice(allocator);
}

fn providerFromDocument(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidOAuthPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidOAuthPayload;
    const provider = stringField(parsed.value.object, "connectorId") orelse return error.ConnectorIdRequired;
    return allocator.dupe(u8, provider);
}

fn bearerParameter(value: []const u8, expected: []const u8) ?[]const u8 {
    var fields = std.mem.splitScalar(u8, value, ',');
    while (fields.next()) |field_value| {
        const field = std.mem.trim(u8, field_value, " \t\r\n");
        const separator = std.mem.findScalar(u8, field, '=') orelse continue;
        const name = std.mem.trim(u8, field[0..separator], " \t");
        const bare_name = if (std.mem.lastIndexOfScalar(u8, name, ' ')) |index| name[index + 1 ..] else name;
        if (!std.mem.eql(u8, bare_name, expected)) continue;
        const raw = std.mem.trim(u8, field[separator + 1 ..], " \t");
        return if (raw.len >= 2 and raw[0] == '"' and raw[raw.len - 1] == '"') raw[1 .. raw.len - 1] else raw;
    }
    return null;
}

fn joinScopes(allocator: std.mem.Allocator, value: ?std.json.Value) ![]u8 {
    const array = if (value) |candidate| if (candidate == .array) candidate.array.items else &.{} else &.{};
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    for (array, 0..) |scope, index| {
        if (scope != .string or scope.string.len == 0 or scope.string.len > 4096) return error.InvalidMcpOAuthMetadata;
        if (index > 0) try output.writer.writeByte(' ');
        try output.writer.writeAll(scope.string);
    }
    return output.toOwnedSlice();
}

fn arrayContains(object: std.json.ObjectMap, name: []const u8, expected: []const u8) bool {
    const value = object.get(name) orelse return false;
    if (value != .array) return false;
    for (value.array.items) |item| if (item == .string and std.mem.eql(u8, item.string, expected)) return true;
    return false;
}

fn requireHttps(value: []const u8) !void {
    const uri = std.Uri.parse(value) catch return error.InvalidMcpOAuthUrl;
    if (!std.ascii.eqlIgnoreCase(uri.scheme, "https") or uri.host == null or uri.user != null or uri.password != null or uri.fragment != null) return error.InvalidMcpOAuthUrl;
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

fn positiveInteger(object: std.json.ObjectMap, name: []const u8) ?i64 {
    const value = object.get(name) orelse return null;
    return if (value == .integer and value.integer > 0) value.integer else null;
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

fn nowMillis(io: Io) i64 {
    return @max(Io.Clock.real.now(io).toSeconds(), 0) * 1000;
}
