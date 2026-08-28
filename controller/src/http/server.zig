const std = @import("std");
const config_module = @import("../app/config.zig");
const shutdown = @import("../app/shutdown.zig");
const reverse_proxy = @import("reverse_proxy.zig");
const route_registry = @import("route_registry.zig");
const request_tools = @import("request.zig");
const rig_service = @import("../topology/rigs.zig");
const rig_mutations = @import("../topology/rig_mutations.zig");
const worker_service = @import("../topology/workers.zig");
const model_service = @import("../inference/models/service.zig");
const tokenization_service = @import("../inference/tokenization.zig");
const recipe_service = @import("../inference/recipes/service.zig");
const lifecycle = @import("../inference/runtime/lifecycle.zig");
const telemetry = @import("../system/telemetry.zig");
const system_service = @import("../system/service.zig");
const runtime_info = @import("../inference/runtime/info.zig");
const metrics = @import("../system/metrics/service.zig");
const logs = @import("../system/logs.zig");
const studio_settings = @import("../system/settings/service.zig");
const storage_service = @import("../system/storage.zig");
const studio_operations = @import("../system/studio_operations.zig");
const model_files = @import("../inference/models/files.zig");
const model_index = @import("../inference/models/index.zig");
const studio_models = @import("../inference/models/studio.zig");
const runtime_routes = @import("../inference/runtime/routes.zig");
const vram_calculator = @import("../inference/compute/vram.zig");
const benchmark_service = @import("../inference/benchmark/service.zig");
const runtime_jobs_service = @import("../inference/runtime/jobs.zig");
const huggingface_models = @import("../inference/models/huggingface.zig");
const download_manager = @import("../inference/downloads/manager.zig");
const provider_service = @import("../providers/service.zig");
const provider_catalog = @import("../providers/catalog.zig");
const provider_routing = @import("../providers/routing.zig");
const provider_gateway = @import("../providers/gateway.zig");
const anthropic_gateway = @import("../providers/anthropic_gateway.zig");
const openai_protocol = @import("../providers/openai_protocol.zig");
const head_providers = @import("../providers/head.zig");
const codex_gateway = @import("../providers/codex_gateway.zig");
const cursor_gateway = @import("../providers/cursor_gateway.zig");
const harness_runtime = @import("../agent/harness/runtime.zig");
const agent_coordinator = @import("../agent/sessions/coordinator.zig");
const agent_sessions = @import("../agent/sessions/service.zig");
const session_change = @import("../agent/sessions/change.zig");
const automations = @import("../agent/automations/service.zig");
const head_connection = @import("../topology/head_connection.zig");
const agent_enrollments = @import("../topology/enrollments.zig");
const agent_models = @import("../agent/models/service.zig");
const model_catalog = @import("../inference/models/catalog.zig");
const agent_projects = @import("../agent/projects/service.zig");
const agent_connectors = @import("../agent/connectors/service.zig");
const agent_mcp_runtime = @import("../agent/mcp/runtime.zig");
const agent_oauth = @import("../accounts/oauth/service.zig");
const agent_google = @import("../accounts/google/service.zig");
const agent_code_storage = @import("../accounts/code_storage/service.zig");
const agent_discovery = @import("../agent/discovery/service.zig");
const agent_pr = @import("../agent/pull_requests/service.zig");
const agent_terminal = @import("../agent/terminal/service.zig");
const agent_pty = @import("../agent/terminal/pty.zig");
const agent_browser = @import("../agent/browser/service.zig");
const agent_sandboxes = @import("../agent/cloud/runtime.zig");
const agent_messaging = @import("../agent/messaging/service.zig");
const agent_goals = @import("../agent/goals/service.zig");
const agent_git = @import("../agent/git/service.zig");
const agent_subagents = @import("../agent/subagents/service.zig");
const request_auth = @import("../accounts/request_auth.zig");
const compute_plan = @import("../inference/compute/plan.zig");
const compute_lifecycle = @import("../inference/compute/lifecycle.zig");
const recipes = @import("../inference/recipes/store.zig");
const peak_metrics = @import("../system/metrics/store.zig");
const downloads = @import("../inference/downloads/store.zig");
const inference_usage = @import("../inference/usage/store.zig");
const sqlite = @import("../storage/sqlite.zig");
const system_info = @import("../system/platform/system_info.zig");
const topology = @import("../topology/topology.zig");
const workbench = @import("../workbench/service.zig");

const Config = config_module.Config;
const Mode = config_module.Mode;
const Io = std.Io;
const net = Io.net;
const http = std.http;
const max_connection_tasks = 256;
const max_chat_request_bytes = 16 * 1024 * 1024;
const max_agent_request_bytes = 16 * 1024 * 1024;
const max_settings_request_bytes = 64 * 1024;

const ConnectionLimiter = struct {
    active: std.atomic.Value(usize) = .init(0),

    fn acquire(limiter: *ConnectionLimiter) bool {
        const previous = limiter.active.fetchAdd(1, .acq_rel);
        if (previous < max_connection_tasks) return true;
        _ = limiter.active.fetchSub(1, .acq_rel);
        return false;
    }

    fn release(limiter: *ConnectionLimiter) void {
        _ = limiter.active.fetchSub(1, .acq_rel);
    }
};

pub const HttpServer = struct {
    allocator: std.mem.Allocator,
    io: Io,
    config: Config,
    listener: net.Server,
    client: http.Client,
    studio: studio_settings.State,
    model_index_cache: model_index.Cache,
    runtime_jobs: runtime_jobs_service.State,
    downloads: download_manager.State,
    compute: compute_lifecycle.Manager,
    head_provider_state: head_providers.State,
    oauth: agent_oauth.State,
    google: agent_google.State,
    code_storage: agent_code_storage.State,
    harness: harness_runtime.Manager,
    pty: agent_pty.Manager,
    browser: agent_browser.Manager,
    mcp: agent_mcp_runtime.Manager,
    sandboxes: agent_sandboxes.Manager,
    messaging: agent_messaging.Manager,
    connection_limiter: ConnectionLimiter = .{},

    pub fn init(allocator: std.mem.Allocator, io: Io, config: Config) !HttpServer {
        const address = try net.IpAddress.parse(config.host, config.port);
        var studio = try studio_settings.State.init(allocator, config.models_dir);
        errdefer studio.deinit();
        var compute = try compute_lifecycle.Manager.init(allocator, io, config.data_dir);
        errdefer compute.deinit();
        var head_provider_state = try head_providers.State.init(allocator, io, &config);
        errdefer head_provider_state.deinit();
        var oauth = try agent_oauth.State.init(allocator, io, config.data_dir, config.environment);
        errdefer oauth.deinit();
        var google = try agent_google.State.init(allocator, io, config.data_dir);
        errdefer google.deinit();
        var code_storage = try agent_code_storage.State.init(allocator, io, config.data_dir, config.environment);
        errdefer code_storage.deinit();
        var harness = try harness_runtime.Manager.init(allocator, io, &config);
        errdefer harness.deinit();
        var pty = agent_pty.Manager.init(allocator, io, &config);
        errdefer pty.deinit();
        var browser = try agent_browser.Manager.init(allocator, io, config.environment, config.data_dir);
        errdefer browser.deinit();
        var mcp = try agent_mcp_runtime.Manager.init(allocator, io, config.environment, config.data_dir);
        errdefer mcp.deinit();
        var sandboxes = try agent_sandboxes.Manager.init(allocator, io, &config);
        errdefer sandboxes.deinit();
        var messaging = try agent_messaging.Manager.init(allocator, io, &config);
        errdefer messaging.deinit();
        return .{
            .allocator = allocator,
            .io = io,
            .config = config,
            .listener = try address.listen(io, .{ .reuse_address = true }),
            .client = .{ .allocator = allocator, .io = io },
            .studio = studio,
            .model_index_cache = model_index.Cache.init(allocator, io),
            .runtime_jobs = runtime_jobs_service.State.init(allocator, io),
            .downloads = download_manager.State.init(allocator, io),
            .compute = compute,
            .head_provider_state = head_provider_state,
            .oauth = oauth,
            .google = google,
            .code_storage = code_storage,
            .harness = harness,
            .pty = pty,
            .browser = browser,
            .mcp = mcp,
            .sandboxes = sandboxes,
            .messaging = messaging,
        };
    }

    pub fn deinit(server: *HttpServer) void {
        server.listener.deinit(server.io);
        server.compute.deinit();
        server.head_provider_state.deinit();
        server.oauth.deinit();
        server.google.deinit();
        server.code_storage.deinit();
        server.harness.deinit();
        server.pty.deinit();
        server.browser.deinit();
        server.mcp.deinit();
        server.sandboxes.deinit();
        server.messaging.deinit();
        server.downloads.deinit();
        server.client.deinit();
        server.studio.deinit();
        server.model_index_cache.deinit();
        server.runtime_jobs.deinit();
    }

    pub fn run(server: *HttpServer, database: *sqlite.Database, recipe_column: recipes.PayloadColumn, system: *const system_info.Snapshot, worker_pool: *worker_service.Pool, supervisor: *lifecycle.Supervisor, runtime_cache: *runtime_info.Cache) !void {
        var group: Io.Group = .init;
        defer group.cancel(server.io);
        server.browser.start() catch |failure| std.log.warn("bundled browser failed to start: {t}", .{failure});
        try group.concurrent(server.io, warmMcpRuntime, .{ &server.mcp, database });
        if (server.config.mode != .head) try group.concurrent(server.io, runComputeSupervisor, .{&server.compute});
        if (server.config.mode != .worker) try group.concurrent(server.io, automations.runScheduler, .{ server.allocator, server.io, server.config.mode, &server.client, database, &server.harness, &server.sandboxes });
        if (server.config.mode != .worker) try group.concurrent(server.io, agent_coordinator.runEventPump, .{ server.allocator, server.io, server.config.mode, &server.client, database, &server.harness });
        if (server.config.mode == .head) try group.concurrent(server.io, agent_sandboxes.Manager.runReconciler, .{ &server.sandboxes, &server.client, database });
        if (server.config.mode == .head) try group.concurrent(server.io, agent_messaging.Manager.runTelegramPoller, .{ &server.messaging, server.config.mode, &server.client, database, &server.harness });
        if (server.config.mode == .head) try group.concurrent(server.io, agent_messaging.Manager.runDispatcher, .{ &server.messaging, server.config.mode, &server.client, database, &server.harness });
        while (!shutdown.isRequested()) {
            var stream = server.listener.accept(server.io) catch |failure| {
                if (shutdown.isRequested()) return;
                return failure;
            };
            if (!server.connection_limiter.acquire()) {
                rejectOverloadedConnection(server.io, &stream);
                continue;
            }
            group.concurrent(server.io, serveConnection, .{ server.allocator, server.io, server.config.mode, &server.config, &server.studio, &server.model_index_cache, &server.runtime_jobs, &server.downloads, &server.compute, &server.head_provider_state, &server.oauth, &server.google, &server.code_storage, &server.harness, &server.pty, &server.browser, &server.mcp, &server.sandboxes, &server.messaging, &server.client, database, recipe_column, server.config.llm_instance_path, server.config.inference_port, server.config.inference_origin, server.config.default_trust_remote_code, server.config.environment, system, worker_pool, supervisor, runtime_cache, server.config.spike_upstream, server.config.spike_fallback_upstream, &server.connection_limiter, stream }) catch {
                server.connection_limiter.release();
                stream.close(server.io);
            };
        }
    }
};

fn runComputeSupervisor(manager: *compute_lifecycle.Manager) Io.Cancelable!void {
    return manager.run();
}

fn warmMcpRuntime(manager: *agent_mcp_runtime.Manager, database: *sqlite.Database) void {
    manager.warm(database);
}

fn serveConnection(allocator: std.mem.Allocator, io: Io, mode: Mode, configuration: *const Config, studio: *studio_settings.State, model_index_cache: *model_index.Cache, runtime_jobs: *runtime_jobs_service.State, download_state: *download_manager.State, compute: *compute_lifecycle.Manager, head_provider_state: *head_providers.State, oauth: *agent_oauth.State, google: *agent_google.State, code_storage: *agent_code_storage.State, harness: *harness_runtime.Manager, pty: *agent_pty.Manager, browser: *agent_browser.Manager, mcp: *agent_mcp_runtime.Manager, sandboxes: *agent_sandboxes.Manager, messaging: *agent_messaging.Manager, client: *http.Client, database: *sqlite.Database, recipe_column: recipes.PayloadColumn, llm_instance_path: []const u8, inference_port: u16, inference_origin: []const u8, default_trust_remote_code: bool, environment: *const std.process.Environ.Map, system: *const system_info.Snapshot, worker_pool: *worker_service.Pool, supervisor: *lifecycle.Supervisor, runtime_cache: *runtime_info.Cache, spike_upstream: ?[]const u8, spike_fallback_upstream: ?[]const u8, connection_limiter: *ConnectionLimiter, stream: net.Stream) void {
    defer {
        connection_limiter.release();
        var connection = stream;
        connection.close(io);
    }

    var send_buffer: [16 * 1024]u8 = undefined;
    var receive_buffer: [16 * 1024]u8 = undefined;
    var connection_reader = stream.reader(io, &receive_buffer);
    var connection_writer = stream.writer(io, &send_buffer);
    var server: http.Server = .init(&connection_reader.interface, &connection_writer.interface);

    while (true) {
        var request = server.receiveHead() catch |failure| {
            switch (failure) {
                error.HttpHeadersOversize => writeProtocolError(&connection_writer.interface, "431 Request Header Fields Too Large"),
                error.HttpHeadersInvalid => writeProtocolError(&connection_writer.interface, "400 Bad Request"),
                else => {},
            }
            return;
        };
        const keep_connection = serveRequest(allocator, io, mode, configuration, studio, model_index_cache, runtime_jobs, download_state, compute, head_provider_state, oauth, google, code_storage, harness, pty, browser, mcp, sandboxes, messaging, client, database, recipe_column, llm_instance_path, inference_port, inference_origin, default_trust_remote_code, environment, system, worker_pool, supervisor, runtime_cache, spike_upstream, spike_fallback_upstream, &request) catch return;
        if (!keep_connection) return;
    }
}

fn writeProtocolError(writer: *Io.Writer, status: []const u8) void {
    writer.print("HTTP/1.1 {s}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n", .{status}) catch return;
    writer.flush() catch return;
}

fn rejectOverloadedConnection(io: Io, stream: *net.Stream) void {
    defer stream.close(io);
    var buffer: [256]u8 = undefined;
    var writer = stream.writer(io, &buffer);
    writeProtocolError(&writer.interface, "503 Service Unavailable");
}

fn serveRequest(allocator: std.mem.Allocator, io: Io, mode: Mode, configuration: *const Config, studio: *studio_settings.State, model_index_cache: *model_index.Cache, runtime_jobs: *runtime_jobs_service.State, download_state: *download_manager.State, compute: *compute_lifecycle.Manager, head_provider_state: *head_providers.State, oauth: *agent_oauth.State, google: *agent_google.State, code_storage: *agent_code_storage.State, harness: *harness_runtime.Manager, pty: *agent_pty.Manager, browser: *agent_browser.Manager, mcp: *agent_mcp_runtime.Manager, sandboxes: *agent_sandboxes.Manager, messaging: *agent_messaging.Manager, client: *http.Client, database: *sqlite.Database, recipe_column: recipes.PayloadColumn, llm_instance_path: []const u8, inference_port: u16, inference_origin: []const u8, default_trust_remote_code: bool, environment: *const std.process.Environ.Map, system: *const system_info.Snapshot, worker_pool: *worker_service.Pool, supervisor: *lifecycle.Supervisor, runtime_cache: *runtime_info.Cache, spike_upstream: ?[]const u8, spike_fallback_upstream: ?[]const u8, request: *http.Server.Request) !bool {
    if (request.head.method.requestHasBody() and request.head.transfer_encoding == .none and request.head.content_length == null) request.head.keep_alive = false;
    const route = route_registry.find(request.head.method, request.head.target) orelse {
        try request.respond("{\"detail\":\"Not Found\"}", .{
            .status = .not_found,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    };

    if (std.mem.eql(u8, route.path, "/api/agent/messaging/discord/:accountId")) {
        const timestamp = request_tools.header(request, "X-Signature-Timestamp") orelse return respondDownloadError(request, .unauthorized, "Discord signature timestamp is required");
        const signature = request_tools.header(request, "X-Signature-Ed25519") orelse return respondDownloadError(request, .unauthorized, "Discord signature is required");
        const account_id = try request_tools.pathParameter(allocator, request.head.target, "/api/agent/messaging/discord/");
        defer allocator.free(account_id);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = messaging.discordInteractionPayload(database, account_id, timestamp, signature, document) catch |failure| return respondMessagingFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }

    if (!std.mem.eql(u8, route.path, "/health") and !request_auth.authorized(request, configuration.api_key)) {
        try request.respond("{\"detail\":\"Unauthorized\"}", .{
            .status = .unauthorized,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "application/json" },
                .{ .name = "WWW-Authenticate", .value = "Bearer realm=\"local-studio-controller\"" },
            },
        });
        return request.head.keep_alive;
    }

    if (mode == .head and std.mem.eql(u8, route.path, "/studio/diagnostics") and request_tools.header(request, "X-Local-Studio-Worker-Id") == null) {
        const models_dir = try studio.modelsDirectory(allocator, io);
        defer allocator.free(models_dir);
        const response = try studio_operations.diagnosticsPayload(allocator, io, configuration, models_dir, system, runtime_cache);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }

    switch (topology.routeDisposition(mode, route)) {
        .local => {},
        .proxy => {
            return try serveWorkerProxy(allocator, io, client, database, request);
        },
        .reject => {
            try request.respond("{\"detail\":\"Not Found\"}", .{
                .status = .not_found,
                .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
            });
            return request.head.keep_alive;
        },
    }

    if (std.mem.eql(u8, route.path, "/internal/head-link/v1/poll")) {
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        allocator.free(document);
        const response = harness.relayPollPayload() catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return false;
    }
    if (std.mem.eql(u8, route.path, "/internal/head-link/v1/complete")) {
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = harness.relayCompletePayload(document) catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return false;
    }
    if (std.mem.eql(u8, route.path, "/internal/head-link/v1/chat/completions") or std.mem.eql(u8, route.path, "/internal/head-link/v1/responses") or std.mem.eql(u8, route.path, "/internal/head-link/v1/messages")) {
        return harness.serveRelayedModel(route.path, request) catch |failure| return respondHarnessFailure(request, failure);
    }

    if (std.mem.eql(u8, route.path, "/health")) {
        try request.respond("{\"status\":\"ok\",\"service\":\"local-studio-controller\"}", .{
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/setup-checks")) {
        const response = try agent_coordinator.setupPayload(allocator, io, mode, database, harness);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/workbench")) {
        const view_id_value = try request_tools.queryParameter(allocator, request.head.target, "viewId");
        defer if (view_id_value) |value| allocator.free(value);
        const response = workbench.projectionPayload(allocator, io, database, view_id_value orelse "primary") catch |failure| return respondWorkbenchFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/workbench/commands")) {
        const view_id_value = try request_tools.queryParameter(allocator, request.head.target, "viewId");
        defer if (view_id_value) |value| allocator.free(value);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = workbench.commandPayload(allocator, io, database, view_id_value orelse "primary", document) catch |failure| return respondWorkbenchFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/workbench/events")) {
        const view_id_value = try request_tools.queryParameter(allocator, request.head.target, "viewId");
        defer if (view_id_value) |value| allocator.free(value);
        serveWorkbenchEvents(allocator, io, database, view_id_value orelse "primary", request) catch return false;
        return false;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/harnesses")) {
        const response = try agent_coordinator.harnessesPayload(allocator, io, mode, database, harness);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/cloud/workers")) {
        const response = try sandboxes.listPayload(database);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/messaging/access")) {
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const provider = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "provider") else null;
        defer if (provider) |value| allocator.free(value);
        const account_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "accountId") else null;
        defer if (account_id) |value| allocator.free(value);
        const external_user_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "externalUserId") else null;
        defer if (external_user_id) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => messaging.accessPayload(database),
            .POST => messaging.approvePayload(database, document orelse return false),
            .DELETE => messaging.revokePayload(database, provider orelse return respondDownloadError(request, .bad_request, "provider is required"), account_id orelse return respondDownloadError(request, .bad_request, "accountId is required"), external_user_id orelse return respondDownloadError(request, .bad_request, "externalUserId is required")),
            else => unreachable,
        };
        const payload = response catch |failure| return respondMessagingFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/messaging/defaults")) {
        const document = if (request.head.method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (request.head.method == .PUT)
            messaging.updateDefaultsPayload(database, document orelse return false)
        else
            messaging.defaultsPayload(database);
        const payload = response catch |failure| return respondMessagingFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/messaging/react")) {
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = messaging.reactionPayload(client, database, document) catch |failure| return respondMessagingFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/models")) {
        if (request.head.method == .POST) {
            const document = try readBoundedAgentBody(allocator, request) orelse return false;
            allocator.free(document);
        }
        const response = agent_models.payload(allocator, io, configuration, client) catch |failure| return respondDownloadError(request, .bad_gateway, @errorName(failure));
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/providers") and request.head.method == .GET) {
        const response = try head_provider_state.listPayload();
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/providers/:providerId/login") and request.head.method == .POST) {
        const provider_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/api/agent/providers/", "/login");
        defer allocator.free(provider_id);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return respondDownloadError(request, .bad_request, "Invalid JSON body");
        defer parsed.deinit();
        const auth_type = if (parsed.value == .object) if (parsed.value.object.get("type")) |value| if (value == .string) value.string else "" else "" else "";
        const response = head_provider_state.startLogin(client, provider_id, auth_type) catch |failure| return respondHeadProviderFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/providers/login/:jobId") and request.head.method == .GET) {
        const job_id = try request_tools.pathParameter(allocator, request.head.target, "/api/agent/providers/login/");
        defer allocator.free(job_id);
        const response = try head_provider_state.jobPayloadAny(job_id, request_tools.queryUnsigned(request.head.target, "after") orelse 0) orelse return respondDownloadError(request, .not_found, "Model provider login job not found");
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/providers/login/:jobId/cancel") and request.head.method == .POST) {
        const job_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/api/agent/providers/login/", "/cancel");
        defer allocator.free(job_id);
        if (!(try head_provider_state.cancelAny(job_id))) return respondDownloadError(request, .not_found, "Model provider login job not found");
        try request.respond("{\"ok\":true}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/providers/login/:jobId/respond") and request.head.method == .POST) {
        const job_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/api/agent/providers/login/", "/respond");
        defer allocator.free(job_id);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return respondDownloadError(request, .bad_request, "Invalid JSON body");
        defer parsed.deinit();
        const prompt_id = if (parsed.value == .object) parsed.value.object.get("promptId") orelse return respondDownloadError(request, .bad_request, "promptId is required") else return respondDownloadError(request, .bad_request, "Invalid JSON body");
        const value = if (parsed.value == .object) parsed.value.object.get("value") orelse return respondDownloadError(request, .bad_request, "value is required") else unreachable;
        if (prompt_id != .integer or prompt_id.integer < 0 or value != .string) return respondDownloadError(request, .bad_request, "Invalid provider login response");
        if (!(try head_provider_state.respondAny(job_id, @intCast(prompt_id.integer), value.string))) return respondDownloadError(request, .conflict, "No matching model provider login prompt");
        try request.respond("{\"ok\":true}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/providers/:providerId/logout") and request.head.method == .POST) {
        const provider_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/api/agent/providers/", "/logout");
        defer allocator.free(provider_id);
        if (!(try head_provider_state.logout(provider_id))) return respondDownloadError(request, .not_found, "Head model provider not found");
        try request.respond("{\"ok\":true}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/head-connection")) {
        const response = switch (request.head.method) {
            .GET => head_connection.payload(allocator, io, configuration.data_dir),
            .DELETE => head_connection.deletePayload(allocator, io, client, configuration.data_dir),
            .PUT => update: {
                const document = try readBoundedAgentBody(allocator, request) orelse return false;
                defer allocator.free(document);
                break :update head_connection.updatePayload(allocator, io, mode, client, configuration.data_dir, system.hostname, system.os, harness, document);
            },
            else => unreachable,
        };
        const payload = response catch |failure| return respondHeadConnectionFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/enrollments")) {
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = agent_enrollments.upsertPayload(allocator, io, database, document) catch |failure| return respondEnrollmentFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/enrollments/:id")) {
        const node_id = try request_tools.pathParameter(allocator, request.head.target, "/api/agent/enrollments/");
        defer allocator.free(node_id);
        const response = agent_enrollments.deletePayload(allocator, io, database, node_id) catch |failure| return respondEnrollmentFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/automations")) {
        const response = if (request.head.method == .GET)
            automations.listPayload(allocator, io, database)
        else create: {
            const document = try readBoundedJsonBody(allocator, request) orelse return false;
            defer allocator.free(document);
            break :create automations.createPayload(allocator, io, database, document);
        };
        const payload = response catch |failure| return respondAutomationFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/automations/:id")) {
        const automation_id = try request_tools.pathParameter(allocator, request.head.target, "/api/agent/automations/");
        defer allocator.free(automation_id);
        const response = if (request.head.method == .DELETE)
            automations.deletePayload(allocator, io, database, automation_id)
        else patch: {
            const document = try readBoundedJsonBody(allocator, request) orelse return false;
            defer allocator.free(document);
            break :patch automations.patchPayload(allocator, io, database, automation_id, document);
        };
        const payload = response catch |failure| return respondAutomationFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/automations/:id/run")) {
        const automation_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/api/agent/automations/", "/run");
        defer allocator.free(automation_id);
        const response = automations.runPayload(allocator, io, mode, client, database, harness, sandboxes, automation_id) catch |failure| return respondAutomationFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/projects/repositories")) {
        const response = if (mode != .standalone)
            agent_code_storage.forward(allocator, io, client, database, "/internal/node/v1/projects/repositories", .GET, null)
        else
            code_storage.repositoriesPayload(client);
        const payload = response catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/projects/workspace")) {
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = if (mode != .standalone)
            agent_code_storage.forward(allocator, io, client, database, "/internal/node/v1/projects/workspace", .POST, document)
        else
            code_storage.prepareWorkspacePayload(database, document);
        const payload = response catch |failure| return respondProjectFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/projects/refs")) {
        const project_id = try request_tools.queryParameter(allocator, request.head.target, "projectId");
        defer if (project_id) |value| allocator.free(value);
        const selected_project_id = project_id orelse return respondProjectFailure(request, error.ProjectIdRequired);
        try agent_projects.validateProjectId(selected_project_id);
        const internal_path = try std.fmt.allocPrint(allocator, "/internal/node/v1/projects/refs?projectId={s}", .{selected_project_id});
        defer allocator.free(internal_path);
        const response = if (mode != .standalone)
            agent_code_storage.forward(allocator, io, client, database, internal_path, .GET, null)
        else
            code_storage.projectRefsPayload(database, selected_project_id);
        const payload = response catch |failure| return respondProjectFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/projects")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "id") else null;
        defer if (id) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => agent_projects.listPayload(allocator, io, mode, configuration, client, database, node_id),
            .POST => if (std.mem.indexOf(u8, document orelse return false, "\"import\":true") != null)
                if (mode != .standalone)
                    agent_code_storage.forward(allocator, io, client, database, "/internal/node/v1/projects", .POST, document.?)
                else
                    code_storage.importProjectPayload(client, database, document.?)
            else if (std.mem.indexOf(u8, document.?, "\"create\":true") != null)
                if (mode != .standalone)
                    agent_code_storage.forward(allocator, io, client, database, "/internal/node/v1/projects", .POST, document.?)
                else
                    code_storage.createProjectPayload(client, database, document.?)
            else if (std.mem.indexOf(u8, document.?, "\"repository\"") != null)
                if (mode != .standalone)
                    agent_code_storage.forward(allocator, io, client, database, "/internal/node/v1/projects", .POST, document.?)
                else
                    code_storage.addProjectPayload(database, document.?)
            else
                agent_projects.addPayload(allocator, io, mode, configuration, client, database, node_id, document.?),
            .DELETE => agent_projects.deletePayload(allocator, io, mode, client, database, node_id, id orelse return respondProjectFailure(request, error.ProjectIdRequired)),
            else => unreachable,
        };
        const payload = response catch |failure| return respondProjectFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/connectors")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "id") else null;
        defer if (id) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => agent_connectors.listPayload(allocator, io, mode, client, database, node_id),
            .POST => agent_connectors.upsertPayload(allocator, io, mode, client, database, node_id, document orelse return false),
            .DELETE => agent_connectors.deletePayload(allocator, io, mode, client, database, node_id, id orelse return respondConnectorFailure(request, error.ConnectorIdRequired)),
            else => unreachable,
        };
        const payload = response catch |failure| return respondConnectorFailure(request, failure);
        defer allocator.free(payload);
        if (mode == .standalone and request.head.method != .GET) {
            const changed_id = if (id) |value| value else connectorIdFromDocument(allocator, document orelse "") catch null;
            defer if (id == null) if (changed_id) |value| allocator.free(value);
            if (changed_id) |value| mcp.remove(value);
        }
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.startsWith(u8, route.path, "/api/agent/oauth")) {
        const method = request.head.method;
        const authorize_route = std.mem.eql(u8, route.path, "/api/agent/oauth/authorize");
        const remote_suffix = if (mode != .standalone) try allocator.dupe(u8, request.head.target["/api/agent/oauth".len..]) else null;
        defer if (remote_suffix) |value| allocator.free(value);
        const document = if (method == .POST or method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (mode != .standalone) remote: {
            const connector_id = if (authorize_route and method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "connectorId") else null;
            defer if (connector_id) |value| allocator.free(value);
            const internal_path = if (connector_id) |value|
                try std.fmt.allocPrint(allocator, "/internal/node/v1/oauth/authorize?connectorId={s}", .{value})
            else
                try std.fmt.allocPrint(allocator, "/internal/node/v1/oauth{s}", .{remote_suffix.?});
            defer allocator.free(internal_path);
            break :remote agent_oauth.forward(allocator, io, client, database, internal_path, method, if (connector_id == null) document else null);
        } else if (authorize_route)
            if (method == .POST) oauth.authorizePayload(client, database, document orelse return false) else local: {
                const connector_id = try request_tools.queryParameter(allocator, request.head.target, "connectorId");
                defer if (connector_id) |value| allocator.free(value);
                break :local oauth.cancelConnectorPayload(connector_id orelse return respondOAuthFailure(request, error.ConnectorIdRequired));
            }
        else if (std.mem.eql(u8, route.path, "/api/agent/oauth/status")) local: {
            const connector_id = try request_tools.queryParameter(allocator, request.head.target, "connectorId");
            defer if (connector_id) |value| allocator.free(value);
            break :local oauth.statusPayload(client, database, connector_id orelse return respondOAuthFailure(request, error.ConnectorIdRequired));
        } else if (std.mem.eql(u8, route.path, "/api/agent/oauth/client"))
            oauth.clientPayload(database, document orelse return false)
        else local: {
            const connector_id = try request_tools.queryParameter(allocator, request.head.target, "connectorId");
            defer if (connector_id) |value| allocator.free(value);
            const account = try request_tools.queryParameter(allocator, request.head.target, "account");
            defer if (account) |value| allocator.free(value);
            break :local oauth.disconnectPayload(database, connector_id orelse return respondOAuthFailure(request, error.ConnectorIdRequired), account);
        };
        const payload = response catch |failure| return respondOAuthFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.startsWith(u8, route.path, "/api/agent/accounts/google")) {
        const document = if (request.head.method != .GET) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (mode != .standalone) remote: {
            const suffix = request.head.target["/api/agent/accounts/google".len..];
            const internal_path = try std.fmt.allocPrint(allocator, "/internal/node/v1/accounts/google{s}", .{suffix});
            defer allocator.free(internal_path);
            break :remote agent_google.forward(allocator, io, client, database, internal_path, request.head.method, document);
        } else if (std.mem.eql(u8, route.path, "/api/agent/accounts/google/authorize"))
            if (request.head.method == .POST) google.authorizePayload(client, database, document orelse return false) else google.cancelPayload()
        else switch (request.head.method) {
            .GET => google.accountPayload(),
            .PUT => google.clientPayload(database, document orelse return false),
            .DELETE => google.disconnectPayload(client, database, document orelse return false),
            else => unreachable,
        };
        const payload = response catch |failure| return respondGoogleFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/accounts/code-storage")) {
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const account_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "accountId") else null;
        defer if (account_id) |value| allocator.free(value);
        const response = if (mode != .standalone) remote: {
            const internal_path = if (request.head.method == .DELETE) path: {
                const value = account_id orelse return respondDownloadError(request, .bad_request, "accountId is required");
                if (!agent_code_storage.validAccountId(value)) return respondDownloadError(request, .bad_request, "accountId is invalid");
                break :path try std.fmt.allocPrint(allocator, "/internal/node/v1/accounts/code-storage?accountId={s}", .{value});
            } else try allocator.dupe(u8, "/internal/node/v1/accounts/code-storage");
            defer allocator.free(internal_path);
            break :remote agent_code_storage.forward(allocator, io, client, database, internal_path, request.head.method, document);
        } else switch (request.head.method) {
            .GET => code_storage.accountPayload(),
            .POST => code_storage.connectPayload(database, document orelse return false),
            .DELETE => code_storage.disconnectPayload(database, account_id orelse return respondDownloadError(request, .bad_request, "accountId is required")),
            else => unreachable,
        };
        const payload = response catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/accounts/credential-store")) {
        const document = if (request.head.method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (mode != .standalone)
            agent_code_storage.forward(allocator, io, client, database, "/internal/node/v1/accounts/credential-store", request.head.method, document)
        else switch (request.head.method) {
            .GET => code_storage.credentialStorePayload(),
            .PUT => code_storage.updateCredentialStorePayload(document orelse return false),
            else => unreachable,
        };
        const payload = response catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/accounts/sandboxes")) {
        const document = if (request.head.method == .POST or request.head.method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const account_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "accountId") else null;
        defer if (account_id) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => code_storage.sandboxAccountsPayload(),
            .POST => code_storage.connectSandboxPayload(document orelse return false),
            .PUT => code_storage.updateSandboxPayload(document orelse return false),
            .DELETE => code_storage.disconnectSandboxPayload(account_id orelse return respondDownloadError(request, .bad_request, "accountId is required")),
            else => unreachable,
        };
        const payload = response catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/accounts/messaging")) {
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const account_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "accountId") else null;
        defer if (account_id) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => code_storage.messagingAccountsPayload(),
            .POST => code_storage.connectMessagingPayload(client, document orelse return false),
            .DELETE => code_storage.disconnectMessagingPayload(account_id orelse return respondDownloadError(request, .bad_request, "accountId is required")),
            else => unreachable,
        };
        const payload = response catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/connectors/grants")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const probe_id = try request_tools.queryParameter(allocator, request.head.target, "connector");
        defer if (probe_id) |value| allocator.free(value);
        const document = if (request.head.method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const model_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "modelId") else null;
        defer if (model_id) |value| allocator.free(value);
        const connector_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "connectorId") else null;
        defer if (connector_id) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => agent_connectors.grantsPayload(allocator, io, mode, configuration, mcp, client, database, node_id, probe_id),
            .PUT => agent_connectors.putGrantPayload(allocator, io, mode, client, database, node_id, document orelse return false),
            .DELETE => agent_connectors.deleteGrantPayload(allocator, io, mode, client, database, node_id, model_id orelse return respondConnectorFailure(request, error.ConnectorGrantFieldsRequired), connector_id orelse return respondConnectorFailure(request, error.ConnectorGrantFieldsRequired)),
            else => unreachable,
        };
        const payload = response catch |failure| return respondConnectorFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/connectors/call")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const model_id = try request_tools.queryParameter(allocator, request.head.target, "model_id");
        defer if (model_id) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedAgentBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (request.head.method == .GET)
            agent_connectors.inventoryPayload(allocator, io, mode, configuration, mcp, client, database, node_id, model_id orelse "")
        else
            agent_connectors.callPayload(allocator, io, mode, configuration, mcp, client, database, node_id, document orelse return false);
        const payload = response catch |failure| return respondConnectorFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/connectors/test")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = agent_connectors.testPayload(allocator, io, mode, configuration, mcp, client, database, node_id, document) catch |failure| return respondConnectorFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/skills") or std.mem.eql(u8, route.path, "/api/agent/skills/load") or std.mem.eql(u8, route.path, "/api/agent/prompt-templates") or std.mem.eql(u8, route.path, "/api/agent/prompt-templates/load")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const path = if (std.mem.endsWith(u8, route.path, "/load")) try request_tools.queryParameter(allocator, request.head.target, "path") else null;
        defer if (path) |value| allocator.free(value);
        const response = if (std.mem.eql(u8, route.path, "/api/agent/skills"))
            agent_discovery.skillsPayload(allocator, io, mode, configuration, client, database, node_id)
        else if (std.mem.eql(u8, route.path, "/api/agent/skills/load"))
            agent_discovery.skillPayload(allocator, io, mode, configuration, client, database, node_id, path orelse return respondDiscoveryFailure(request, error.DiscoveryPathRequired))
        else if (std.mem.eql(u8, route.path, "/api/agent/prompt-templates"))
            agent_discovery.templatesPayload(allocator, io, mode, configuration, client, database, node_id)
        else
            agent_discovery.templatePayload(allocator, io, mode, configuration, client, database, node_id, path orelse return respondDiscoveryFailure(request, error.DiscoveryPathRequired));
        const payload = response catch |failure| return respondDiscoveryFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/pr") or std.mem.eql(u8, route.path, "/api/agent/pr/merge")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const cwd = if (request.head.method == .GET) try request_tools.queryParameter(allocator, request.head.target, "cwd") else null;
        defer if (cwd) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (request.head.method == .GET)
            agent_pr.getPayload(allocator, io, mode, configuration, client, database, node_id, cwd orelse return respondPrFailure(request, error.PrCwdRequired))
        else
            agent_pr.mergePayload(allocator, io, mode, configuration, client, database, node_id, document orelse return false);
        const payload = response catch |failure| return respondPrFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/git/mirror") and request.head.method == .POST) {
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const payload = code_storage.mirrorPayload(database, document) catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/git") or std.mem.eql(u8, route.path, "/api/agent/git/branches") or std.mem.eql(u8, route.path, "/api/agent/git/worktrees")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const cwd = try request_tools.queryParameter(allocator, request.head.target, "cwd");
        defer if (cwd) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const workspace = cwd orelse return respondGitFailure(request, error.GitCwdRequired);
        const response = if (std.mem.eql(u8, route.path, "/api/agent/git/branches"))
            agent_git.branchesPayload(allocator, io, mode, configuration, client, database, node_id, workspace)
        else if (std.mem.eql(u8, route.path, "/api/agent/git/worktrees"))
            agent_git.worktreesPayload(allocator, io, mode, configuration, client, database, node_id, workspace)
        else if (request.head.method == .POST)
            agent_git.actionPayload(allocator, io, mode, configuration, client, database, node_id, workspace, document orelse return false)
        else
            agent_git.statePayload(allocator, io, mode, configuration, client, database, node_id, workspace);
        const payload = response catch |failure| return respondGitFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.startsWith(u8, route.path, "/api/agent/browser/")) {
        const target = try allocator.dupe(u8, request.head.target);
        defer allocator.free(target);
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedAgentBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (mode == .standalone)
            localBrowserPayload(allocator, browser, client, route.path, target, request.head.method, document)
        else
            agent_browser.remotePayload(allocator, io, client, database, target, request.head.method, document, node_id);
        const payload = response catch |failure| return respondBrowserFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/terminal/pty/stream")) {
        const id = try request_tools.queryParameter(allocator, request.head.target, "id");
        defer if (id) |value| allocator.free(value);
        const session_id = id orelse return respondTerminalFailure(request, error.PtyIdRequired);
        if (mode == .standalone) {
            pty.serveStream(session_id, request) catch return false;
            return false;
        }
        const remote = agent_pty.splitRemoteId(session_id) catch |failure| return respondTerminalFailure(request, failure);
        var target = agent_pty.remoteTarget(allocator, io, database, remote) catch |failure| return respondTerminalFailure(request, failure);
        defer target.deinit();
        var captured = try reverse_proxy.captureRequest(allocator, request);
        defer captured.deinit();
        allocator.free(captured.target);
        captured.target = try std.fmt.allocPrint(allocator, "/internal/node/v1/terminal/pty/stream?id={s}", .{remote.session});
        reverse_proxy.serveWorkerBuffered(allocator, client, target.address, target.api_key, target.id, "", &captured, request) catch return false;
        return false;
    }
    if (std.mem.startsWith(u8, route.path, "/api/agent/terminal/pty/")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const action = std.mem.trimStart(u8, route.path[std.mem.lastIndexOfScalar(u8, route.path, '/').? + 1 ..], "/");
        const response = if (mode != .standalone)
            if (std.mem.eql(u8, action, "open")) agent_pty.openRemotePayload(allocator, io, client, database, node_id, document) else agent_pty.actionRemotePayload(allocator, io, client, database, action, document)
        else if (std.mem.eql(u8, action, "open"))
            pty.openPayload(document)
        else if (std.mem.eql(u8, action, "input"))
            pty.inputPayload(document)
        else if (std.mem.eql(u8, action, "resize"))
            pty.resizePayload(document)
        else
            pty.closePayload(document);
        const payload = response catch |failure| return respondTerminalFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/terminal") or std.mem.eql(u8, route.path, "/api/agent/terminal/resolve-cwd")) {
        const node_id = try request_tools.queryParameter(allocator, request.head.target, "nodeId");
        defer if (node_id) |value| allocator.free(value);
        const cwd = try request_tools.queryParameter(allocator, request.head.target, "cwd");
        defer if (cwd) |value| allocator.free(value);
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = if (std.mem.endsWith(u8, route.path, "/resolve-cwd"))
            agent_terminal.resolvePayload(allocator, io, mode, configuration, client, database, node_id, document)
        else
            agent_terminal.runPayload(allocator, io, mode, configuration, client, database, node_id, cwd orelse return respondTerminalFailure(request, error.TerminalCwdRequired), document);
        const payload = response catch |failure| return respondTerminalFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/goal")) {
        const session_id = try request_tools.queryParameter(allocator, request.head.target, "piSessionId");
        defer if (session_id) |value| allocator.free(value);
        const id = session_id orelse return respondGoalFailure(request, error.SessionIdRequired);
        const document = if (request.head.method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => agent_goals.getPayload(allocator, io, database, id),
            .PUT => agent_goals.putPayload(allocator, io, database, id, document orelse return false),
            .DELETE => agent_goals.deletePayload(allocator, io, database, id),
            else => unreachable,
        };
        const payload = response catch |failure| return respondGoalFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/subagents")) {
        const parent_id = if (request.head.method == .GET) try request_tools.queryParameter(allocator, request.head.target, "piSessionId") else null;
        defer if (parent_id) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedAgentBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (request.head.method == .GET)
            agent_subagents.listPayload(allocator, io, database, parent_id orelse return respondSubagentFailure(request, error.ParentSessionIdRequired))
        else
            agent_subagents.runPayload(allocator, io, mode, client, database, harness, document orelse return false);
        const payload = response catch |failure| return respondSubagentFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/subagents/:runId") or std.mem.eql(u8, route.path, "/api/agent/subagents/:runId/stop")) {
        const run_id = if (std.mem.endsWith(u8, route.path, "/stop"))
            try request_tools.pathParameterBetween(allocator, request.head.target, "/api/agent/subagents/", "/stop")
        else
            try request_tools.pathParameter(allocator, request.head.target, "/api/agent/subagents/");
        defer allocator.free(run_id);
        const parent_id = if (request.head.method == .GET) try request_tools.queryParameter(allocator, request.head.target, "piSessionId") else null;
        defer if (parent_id) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedAgentBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (request.head.method == .GET)
            agent_subagents.getPayload(allocator, io, database, parent_id orelse return respondSubagentFailure(request, error.ParentSessionIdRequired), run_id)
        else
            agent_subagents.stopPayload(allocator, io, mode, client, database, harness, run_id, document orelse return false);
        const payload = response catch |failure| return respondSubagentFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/sessions")) {
        if (request.head.method == .DELETE) return respondDownloadError(request, .method_not_allowed, "Session deletion is disabled. Archive sessions from the UI instead.");
        const project_id = try request_tools.queryParameter(allocator, request.head.target, "projectId");
        defer if (project_id) |value| allocator.free(value);
        const cwd = try request_tools.queryParameter(allocator, request.head.target, "cwd");
        defer if (cwd) |value| allocator.free(value);
        const canonical = if (project_id == null) agent_projects.resolveAllowedPath(allocator, io, environment, cwd orelse return respondSessionFailure(request, error.SessionCwdRequired)) catch |failure| return respondSessionFailure(request, failure) else null;
        defer if (canonical) |value| allocator.free(value);
        const response = agent_sessions.historyPayload(allocator, io, database, canonical, project_id, request_tools.queryFlag(request.head.target, "archived"), request_tools.queryFlag(request.head.target, "includeArchived"), request_tools.boundedLimit(request.head.target)) catch |failure| return respondSessionFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/sessions/all")) {
        const response = agent_sessions.historyPayload(allocator, io, database, null, null, request_tools.queryFlag(request.head.target, "archived"), request_tools.queryFlag(request.head.target, "includeArchived"), request_tools.boundedLimit(request.head.target)) catch |failure| return respondSessionFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/sessions/:id")) {
        const session_id = try request_tools.pathParameter(allocator, request.head.target, "/api/agent/sessions/");
        defer allocator.free(session_id);
        if (request.head.method == .PATCH) {
            const document = try readBoundedJsonBody(allocator, request) orelse return false;
            defer allocator.free(document);
            var archived_session = try agent_sessions.find(allocator, io, database, session_id);
            defer if (archived_session) |*session| session.deinit();
            const response = agent_sessions.archivePayload(allocator, io, database, session_id, document) catch |failure| return respondSessionFailure(request, failure);
            defer allocator.free(response);
            if (std.mem.indexOf(u8, document, "\"archived\":true") != null) {
                sandboxes.archiveSession(client, database, session_id) catch |failure| return respondSessionFailure(request, failure);
                if (archived_session) |session| if (session.project_id) |project_id| {
                    if (mode == .standalone) {
                        code_storage.archiveWorkspace(database, project_id, session.id) catch |failure| return respondProjectFailure(request, failure);
                    } else if (!std.mem.startsWith(u8, session.node_id, "daytona-") and !std.mem.startsWith(u8, session.node_id, "vercel-")) {
                        var archive_document: Io.Writer.Allocating = .init(allocator);
                        defer archive_document.deinit();
                        try archive_document.writer.writeAll("{\"projectId\":");
                        try std.json.Stringify.value(project_id, .{}, &archive_document.writer);
                        try archive_document.writer.writeAll(",\"sessionId\":");
                        try std.json.Stringify.value(session.id, .{}, &archive_document.writer);
                        try archive_document.writer.writeByte('}');
                        const archived = agent_code_storage.forwardTo(allocator, io, client, database, "/internal/node/v1/projects/workspace/archive", .POST, archive_document.writer.buffered(), session.node_id) catch |failure| return respondProjectFailure(request, failure);
                        allocator.free(archived);
                    }
                };
            }
            try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        }
        var session = (try agent_sessions.find(allocator, io, database, session_id)) orelse return respondSessionFailure(request, error.SessionNotFound);
        defer session.deinit();
        const transcript = agent_coordinator.transcriptPayload(allocator, io, mode, client, database, harness, session.id, null) catch |failure| return respondSessionFailure(request, failure);
        defer allocator.free(transcript);
        const response = agent_sessions.transcriptResponse(allocator, &session, transcript) catch |failure| return respondSessionFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/runtime/sessions")) {
        const response = try agent_coordinator.sessionsPayload(allocator, io, database);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/runtime/status")) {
        const session_id_value = try request_tools.queryParameter(allocator, request.head.target, "sessionId");
        defer if (session_id_value) |value| allocator.free(value);
        const session_id = session_id_value orelse "default";
        const response = try agent_coordinator.statusPayload(allocator, io, mode, client, database, harness, session_id, request_tools.queryUnsigned(request.head.target, "after") orelse 0);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/runtime/events")) {
        const session_id_value = try request_tools.queryParameter(allocator, request.head.target, "sessionId");
        defer if (session_id_value) |value| allocator.free(value);
        agent_coordinator.serveEvents(allocator, io, mode, client, database, harness, session_id_value orelse "default", request_tools.queryUnsigned(request.head.target, "after") orelse 0, request) catch |failure| {
            if (failure == error.SessionNotFound) return respondHarnessFailure(request, failure);
            if (failure == error.AssignedHarnessUnavailable) return respondHarnessFailure(request, failure);
            return false;
        };
        return false;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/session-list-changed")) {
        serveSessionListChanged(allocator, io, database, request) catch return false;
        return false;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/runtime/transcript")) {
        const session_id_value = try request_tools.queryParameter(allocator, request.head.target, "sessionId");
        defer if (session_id_value) |value| allocator.free(value);
        const since = try request_tools.queryParameter(allocator, request.head.target, "since");
        defer if (since) |value| allocator.free(value);
        const response = agent_coordinator.transcriptPayload(allocator, io, mode, client, database, harness, session_id_value orelse "default", since) catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/turn")) {
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = agent_coordinator.turnPayloadWithCloud(allocator, io, mode, client, database, harness, sandboxes, document) catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/abort")) {
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = agent_coordinator.controlPayload(allocator, io, mode, client, database, harness, "abort", document) catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/compact")) {
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = agent_coordinator.controlPayload(allocator, io, mode, client, database, harness, "compact", document) catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/api/agent/runtime/extension-ui")) {
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = agent_coordinator.controlPayload(allocator, io, mode, client, database, harness, "extension-ui", document) catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/harness/v1/setup-checks")) {
        const response = try harness.setupPayload();
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/projects/repositories")) {
        const payload = code_storage.repositoriesPayload(client) catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/projects/workspace")) {
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const payload = code_storage.prepareWorkspacePayload(database, document) catch |failure| return respondProjectFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/projects/workspace/archive")) {
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const payload = code_storage.archiveWorkspacePayload(database, document) catch |failure| return respondProjectFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/projects/cloud-checkout")) {
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const payload = code_storage.cloudCheckoutPayload(database, document) catch |failure| return respondProjectFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/projects/refs")) {
        const project_id = try request_tools.queryParameter(allocator, request.head.target, "projectId");
        defer if (project_id) |value| allocator.free(value);
        const payload = code_storage.projectRefsPayload(database, project_id orelse return respondProjectFailure(request, error.ProjectIdRequired)) catch |failure| return respondProjectFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/projects")) {
        const id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "id") else null;
        defer if (id) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => agent_projects.listLocal(allocator, io, configuration, database),
            .POST => if (std.mem.indexOf(u8, document orelse return false, "\"import\":true") != null)
                code_storage.importProjectPayload(client, database, document.?)
            else if (std.mem.indexOf(u8, document.?, "\"create\":true") != null)
                code_storage.createProjectPayload(client, database, document.?)
            else if (std.mem.indexOf(u8, document.?, "\"repository\"") != null)
                code_storage.addProjectPayload(database, document.?)
            else
                agent_projects.addLocal(allocator, io, configuration, database, document.?),
            .DELETE => agent_projects.deleteLocal(allocator, io, database, id orelse return respondProjectFailure(request, error.ProjectIdRequired)),
            else => unreachable,
        };
        const payload = response catch |failure| return respondProjectFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/connectors")) {
        const id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "id") else null;
        defer if (id) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => agent_connectors.listLocal(allocator, io, database),
            .POST => agent_connectors.upsertLocal(allocator, io, database, document orelse return false),
            .DELETE => agent_connectors.deleteLocal(allocator, io, database, id orelse return respondConnectorFailure(request, error.ConnectorIdRequired)),
            else => unreachable,
        };
        const payload = response catch |failure| return respondConnectorFailure(request, failure);
        defer allocator.free(payload);
        if (request.head.method != .GET) {
            const changed_id = if (id) |value| value else connectorIdFromDocument(allocator, document orelse "") catch null;
            defer if (id == null) if (changed_id) |value| allocator.free(value);
            if (changed_id) |value| mcp.remove(value);
        }
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.startsWith(u8, route.path, "/internal/node/v1/oauth")) {
        const method = request.head.method;
        const authorize_route = std.mem.eql(u8, route.path, "/internal/node/v1/oauth/authorize");
        const status_route = std.mem.eql(u8, route.path, "/internal/node/v1/oauth/status");
        const client_route = std.mem.eql(u8, route.path, "/internal/node/v1/oauth/client");
        const document = if (method == .POST or method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (authorize_route)
            if (method == .POST) oauth.authorizePayload(client, database, document orelse return false) else local: {
                const connector_id = try request_tools.queryParameter(allocator, request.head.target, "connectorId");
                defer if (connector_id) |value| allocator.free(value);
                break :local oauth.cancelConnectorPayload(connector_id orelse return respondOAuthFailure(request, error.ConnectorIdRequired));
            }
        else if (status_route) local: {
            const connector_id = try request_tools.queryParameter(allocator, request.head.target, "connectorId");
            defer if (connector_id) |value| allocator.free(value);
            break :local oauth.statusPayload(client, database, connector_id orelse return respondOAuthFailure(request, error.ConnectorIdRequired));
        } else if (client_route)
            oauth.clientPayload(database, document orelse return false)
        else local: {
            const connector_id = try request_tools.queryParameter(allocator, request.head.target, "connectorId");
            defer if (connector_id) |value| allocator.free(value);
            const account = try request_tools.queryParameter(allocator, request.head.target, "account");
            defer if (account) |value| allocator.free(value);
            break :local oauth.disconnectPayload(database, connector_id orelse return respondOAuthFailure(request, error.ConnectorIdRequired), account);
        };
        const payload = response catch |failure| return respondOAuthFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.startsWith(u8, route.path, "/internal/node/v1/accounts/google")) {
        const document = if (request.head.method != .GET) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (std.mem.eql(u8, route.path, "/internal/node/v1/accounts/google/authorize"))
            if (request.head.method == .POST) google.authorizePayload(client, database, document orelse return false) else google.cancelPayload()
        else switch (request.head.method) {
            .GET => google.accountPayload(),
            .PUT => google.clientPayload(database, document orelse return false),
            .DELETE => google.disconnectPayload(client, database, document orelse return false),
            else => unreachable,
        };
        const payload = response catch |failure| return respondGoogleFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/accounts/code-storage")) {
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const account_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "accountId") else null;
        defer if (account_id) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => code_storage.accountPayload(),
            .POST => code_storage.connectPayload(database, document orelse return false),
            .DELETE => code_storage.disconnectPayload(database, account_id orelse return respondDownloadError(request, .bad_request, "accountId is required")),
            else => unreachable,
        };
        const payload = response catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/accounts/credential-store")) {
        const document = if (request.head.method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => code_storage.credentialStorePayload(),
            .PUT => code_storage.updateCredentialStorePayload(document orelse return false),
            else => unreachable,
        };
        const payload = response catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/accounts/sandboxes")) {
        const document = if (request.head.method == .POST or request.head.method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const account_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "accountId") else null;
        defer if (account_id) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => code_storage.sandboxAccountsPayload(),
            .POST => code_storage.connectSandboxPayload(document orelse return false),
            .PUT => code_storage.updateSandboxPayload(document orelse return false),
            .DELETE => code_storage.disconnectSandboxPayload(account_id orelse return respondDownloadError(request, .bad_request, "accountId is required")),
            else => unreachable,
        };
        const payload = response catch |failure| return respondCodeStorageFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/connector-grants")) {
        const probe_id = try request_tools.queryParameter(allocator, request.head.target, "connector");
        defer if (probe_id) |value| allocator.free(value);
        const document = if (request.head.method == .PUT) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const model_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "modelId") else null;
        defer if (model_id) |value| allocator.free(value);
        const connector_id = if (request.head.method == .DELETE) try request_tools.queryParameter(allocator, request.head.target, "connectorId") else null;
        defer if (connector_id) |value| allocator.free(value);
        const response = switch (request.head.method) {
            .GET => agent_connectors.grantsLocal(allocator, io, configuration, mcp, client, database, probe_id),
            .PUT => agent_connectors.putGrantLocal(allocator, io, database, document orelse return false),
            .DELETE => agent_connectors.deleteGrantLocal(allocator, io, database, model_id orelse return respondConnectorFailure(request, error.ConnectorGrantFieldsRequired), connector_id orelse return respondConnectorFailure(request, error.ConnectorGrantFieldsRequired)),
            else => unreachable,
        };
        const payload = response catch |failure| return respondConnectorFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/connector-call")) {
        const model_id = try request_tools.queryParameter(allocator, request.head.target, "model_id");
        defer if (model_id) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedAgentBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (request.head.method == .GET)
            agent_connectors.inventoryLocal(allocator, io, configuration, mcp, client, database, model_id orelse "")
        else
            agent_connectors.callLocal(allocator, io, configuration, mcp, client, database, document orelse return false);
        const payload = response catch |failure| return respondConnectorFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/connector-test")) {
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = agent_connectors.testLocal(allocator, io, configuration, mcp, client, database, document) catch |failure| return respondConnectorFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/skills") or std.mem.eql(u8, route.path, "/internal/node/v1/skills/load") or std.mem.eql(u8, route.path, "/internal/node/v1/prompt-templates") or std.mem.eql(u8, route.path, "/internal/node/v1/prompt-templates/load")) {
        const path = if (std.mem.endsWith(u8, route.path, "/load")) try request_tools.queryParameter(allocator, request.head.target, "path") else null;
        defer if (path) |value| allocator.free(value);
        const response = if (std.mem.eql(u8, route.path, "/internal/node/v1/skills"))
            agent_discovery.skillsLocal(allocator, io, configuration)
        else if (std.mem.eql(u8, route.path, "/internal/node/v1/skills/load"))
            agent_discovery.skillLocal(allocator, io, configuration, path orelse return respondDiscoveryFailure(request, error.DiscoveryPathRequired))
        else if (std.mem.eql(u8, route.path, "/internal/node/v1/prompt-templates"))
            agent_discovery.templatesLocal(allocator, io, configuration)
        else
            agent_discovery.templateLocal(allocator, io, configuration, path orelse return respondDiscoveryFailure(request, error.DiscoveryPathRequired));
        const payload = response catch |failure| return respondDiscoveryFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/pr") or std.mem.eql(u8, route.path, "/internal/node/v1/pr/merge")) {
        const cwd = if (request.head.method == .GET) try request_tools.queryParameter(allocator, request.head.target, "cwd") else null;
        defer if (cwd) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const response = if (request.head.method == .GET)
            agent_pr.getLocal(allocator, io, configuration, cwd orelse return respondPrFailure(request, error.PrCwdRequired))
        else
            agent_pr.mergeLocal(allocator, io, configuration, document orelse return false);
        const payload = response catch |failure| return respondPrFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/git") or std.mem.eql(u8, route.path, "/internal/node/v1/git/branches") or std.mem.eql(u8, route.path, "/internal/node/v1/git/worktrees")) {
        const cwd = try request_tools.queryParameter(allocator, request.head.target, "cwd");
        defer if (cwd) |value| allocator.free(value);
        const document = if (request.head.method == .POST) try readBoundedJsonBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const workspace = cwd orelse return respondGitFailure(request, error.GitCwdRequired);
        const response = if (std.mem.eql(u8, route.path, "/internal/node/v1/git/branches"))
            agent_git.branchesLocal(allocator, io, configuration, workspace)
        else if (std.mem.eql(u8, route.path, "/internal/node/v1/git/worktrees"))
            agent_git.worktreesLocal(allocator, io, configuration, workspace)
        else if (request.head.method == .POST)
            agent_git.actionLocal(allocator, io, configuration, workspace, document orelse return false)
        else
            agent_git.stateLocal(allocator, io, configuration, workspace);
        const payload = response catch |failure| return respondGitFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/terminal") or std.mem.eql(u8, route.path, "/internal/node/v1/terminal/resolve-cwd")) {
        const cwd = try request_tools.queryParameter(allocator, request.head.target, "cwd");
        defer if (cwd) |value| allocator.free(value);
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = if (std.mem.endsWith(u8, route.path, "/resolve-cwd"))
            agent_terminal.resolveLocal(allocator, io, configuration, document)
        else
            agent_terminal.runLocal(allocator, io, configuration, cwd orelse return respondTerminalFailure(request, error.TerminalCwdRequired), document);
        const payload = response catch |failure| return respondTerminalFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/node/v1/terminal/pty/stream")) {
        const id = try request_tools.queryParameter(allocator, request.head.target, "id");
        defer if (id) |value| allocator.free(value);
        pty.serveStream(id orelse return respondTerminalFailure(request, error.PtyIdRequired), request) catch return false;
        return false;
    }
    if (std.mem.startsWith(u8, route.path, "/internal/node/v1/terminal/pty/")) {
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = if (std.mem.endsWith(u8, route.path, "/open"))
            pty.openPayload(document)
        else if (std.mem.endsWith(u8, route.path, "/input"))
            pty.inputPayload(document)
        else if (std.mem.endsWith(u8, route.path, "/resize"))
            pty.resizePayload(document)
        else
            pty.closePayload(document);
        const payload = response catch |failure| return respondTerminalFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.startsWith(u8, route.path, "/internal/node/v1/browser/")) {
        const target = try allocator.dupe(u8, request.head.target);
        defer allocator.free(target);
        const document = if (request.head.method == .POST) try readBoundedAgentBody(allocator, request) else null;
        defer if (document) |value| allocator.free(value);
        const payload = localBrowserPayload(allocator, browser, client, route.path, target, request.head.method, document) catch |failure| return respondBrowserFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/harness/v1/catalog")) {
        const response = try harness.catalogPayload();
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/harness/v1/fx-gateway")) {
        const model_id_value = request_tools.header(request, "ai-language-model-id") orelse return respondHarnessFailure(request, error.ModelIdRequired);
        const model_id = try allocator.dupe(u8, model_id_value);
        defer allocator.free(model_id);
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        harness.serveFxGateway(client, model_id, document, request) catch |failure| return respondHarnessFailure(request, failure);
        return false;
    }
    if (std.mem.eql(u8, route.path, "/internal/harness/v1/sessions")) {
        const response = try harness.sessionsPayload();
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/harness/v1/status")) {
        const session_id_value = try request_tools.queryParameter(allocator, request.head.target, "sessionId");
        defer if (session_id_value) |value| allocator.free(value);
        const response = try harness.statusPayload(session_id_value orelse "default", request_tools.queryUnsigned(request.head.target, "after") orelse 0);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/harness/v1/events")) {
        const session_id_value = try request_tools.queryParameter(allocator, request.head.target, "sessionId");
        defer if (session_id_value) |value| allocator.free(value);
        harness.serveEvents(session_id_value orelse "default", request_tools.queryUnsigned(request.head.target, "after") orelse 0, request) catch |failure| {
            if (failure == error.SessionNotFound) return respondHarnessFailure(request, failure);
            return false;
        };
        return false;
    }
    if (std.mem.eql(u8, route.path, "/internal/harness/v1/transcript")) {
        const session_id_value = try request_tools.queryParameter(allocator, request.head.target, "sessionId");
        defer if (session_id_value) |value| allocator.free(value);
        const native_session_id = try request_tools.queryParameter(allocator, request.head.target, "nativeSessionId");
        defer if (native_session_id) |value| allocator.free(value);
        const since = try request_tools.queryParameter(allocator, request.head.target, "since");
        defer if (since) |value| allocator.free(value);
        const response = harness.transcriptPayload(session_id_value orelse "default", native_session_id, since) catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/internal/harness/v1/turn") or std.mem.eql(u8, route.path, "/internal/harness/v1/abort") or std.mem.eql(u8, route.path, "/internal/harness/v1/compact") or std.mem.eql(u8, route.path, "/internal/harness/v1/extension-ui")) {
        const document = try readBoundedAgentBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = if (std.mem.endsWith(u8, route.path, "/turn"))
            harness.turnPayload(document)
        else if (std.mem.endsWith(u8, route.path, "/abort"))
            harness.abortPayload(document)
        else if (std.mem.endsWith(u8, route.path, "/compact"))
            harness.compactPayload(document)
        else
            harness.extensionUiPayload(document);
        const payload = response catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/rigs")) {
        if (request.head.method == .POST) {
            const document = try readBoundedJsonBody(allocator, request) orelse return false;
            defer allocator.free(document);
            const response = rig_mutations.createRig(allocator, io, database, document) catch |failure| return respondRigFailure(request, failure);
            defer allocator.free(response);
            try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        }
        const response = try rig_service.payload(allocator, io, mode, system, database, harness.piIsAvailable());
        defer allocator.free(response);
        try request.respond(response, .{
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/rigs/:rigId")) {
        const rig_id = try request_tools.pathParameter(allocator, request.head.target, "/studio/rigs/");
        defer allocator.free(rig_id);
        const response = if (request.head.method == .DELETE)
            rig_mutations.deleteRig(allocator, io, database, rig_id)
        else update: {
            const document = try readBoundedJsonBody(allocator, request) orelse return false;
            defer allocator.free(document);
            break :update rig_mutations.updateRig(allocator, io, database, rig_id, document);
        };
        const payload = response catch |failure| return respondRigFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/rigs/:rigId/nodes")) {
        const rig_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/studio/rigs/", "/nodes");
        defer allocator.free(rig_id);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = rig_mutations.createNode(allocator, io, mode, database, rig_id, document) catch |failure| return respondRigFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/rigs/:rigId/nodes/:nodeId")) {
        const parameters = try request_tools.rigNodeParameters(allocator, request.head.target);
        defer allocator.free(parameters.rig_id);
        defer allocator.free(parameters.node_id);
        const response = if (request.head.method == .DELETE)
            rig_mutations.deleteNode(allocator, io, database, parameters.rig_id, parameters.node_id)
        else update: {
            const document = try readBoundedJsonBody(allocator, request) orelse return false;
            defer allocator.free(document);
            break :update rig_mutations.updateNode(allocator, io, mode, database, parameters.rig_id, parameters.node_id, document);
        };
        const payload = response catch |failure| return respondRigFailure(request, failure);
        defer allocator.free(payload);
        try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/workers")) {
        const response = try worker_service.payload(allocator, io, mode, client, database, worker_pool);
        defer allocator.free(response);
        try request.respond(response, .{
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/sessions")) {
        const response = try agent_sessions.payload(allocator, io, database);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/sessions/:sessionId")) {
        const session_id = try request_tools.pathParameter(allocator, request.head.target, "/studio/sessions/");
        defer allocator.free(session_id);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = agent_sessions.upsert(allocator, io, database, session_id, document) catch |failure| return respondHarnessFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/settings") and request.head.method == .GET) {
        const response = try studio_settings.payload(allocator, io, configuration, studio, database);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/settings") and request.head.method == .POST) {
        return serveStudioSettingsUpdate(allocator, io, configuration, studio, database, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/storage")) {
        const models_dir = try studio.modelsDirectory(allocator, io);
        defer allocator.free(models_dir);
        const response = try storage_service.payload(allocator, io, models_dir);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/diagnostics")) {
        const models_dir = try studio.modelsDirectory(allocator, io);
        defer allocator.free(models_dir);
        const response = try studio_operations.diagnosticsPayload(allocator, io, configuration, models_dir, system, runtime_cache);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/usage") and request.head.method == .GET) {
        const response = try inference_usage.payload(allocator, io, database);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/presets")) {
        const response = try studio_operations.presetsPayload(allocator, io, system);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/vram-calculator")) {
        return serveVramCalculator(allocator, io, configuration, system, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/peak-metrics")) {
        const model_id = try request_tools.queryParameter(allocator, request.head.target, "model_id");
        defer if (model_id) |value| allocator.free(value);
        const response = response: {
            try database.lock(io);
            defer database.unlock(io);
            if (model_id) |value| {
                if (value.len > 0) break :response (try peak_metrics.onePayload(allocator, database, value)) orelse try allocator.dupe(u8, "{\"error\":\"No metrics for this model\"}");
            }
            break :response try peak_metrics.allPayload(allocator, database);
        };
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/benchmark")) {
        const prompt_value = try request_tools.queryParameter(allocator, request.head.target, "prompt_tokens");
        defer if (prompt_value) |value| allocator.free(value);
        const prompt_tokens = if (prompt_value) |value| std.fmt.parseInt(usize, value, 10) catch 0 else 1000;
        if (prompt_tokens < 1 or prompt_tokens > 100_000) {
            try request.respond("{\"detail\":\"Invalid benchmark query\"}", .{ .status = .bad_request, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        }
        const response = benchmark_service.payload(allocator, io, client, database, recipe_column, llm_instance_path, inference_origin, default_trust_remote_code, prompt_tokens) catch |failure| {
            const detail: []const u8 = switch (failure) {
                error.BenchmarkRequestFailed => "Benchmark request failed",
                error.InvalidBenchmarkResponse => "Invalid benchmark response",
                else => return failure,
            };
            var output: Io.Writer.Allocating = .init(allocator);
            defer output.deinit();
            try output.writer.writeAll("{\"detail\":");
            try std.json.Stringify.value(detail, .{}, &output.writer);
            try output.writer.writeByte('}');
            try request.respond(output.writer.buffered(), .{ .status = .service_unavailable, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        };
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/models/delete")) {
        return serveStudioModelMutation(allocator, io, studio, request, .delete);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/models/move")) {
        return serveStudioModelMutation(allocator, io, studio, request, .move);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/model-index")) {
        return serveModelIndex(allocator, configuration, model_index_cache, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/studio/models")) {
        const models_dir = try studio.modelsDirectory(allocator, io);
        defer allocator.free(models_dir);
        const response = try studio_models.payload(allocator, io, database, recipe_column, models_dir, environment);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/huggingface/models")) {
        const search_value = try request_tools.queryParameter(allocator, request.head.target, "search");
        defer if (search_value) |value| allocator.free(value);
        const filter_value = try request_tools.queryParameter(allocator, request.head.target, "filter");
        defer if (filter_value) |value| allocator.free(value);
        const sort_value = try request_tools.queryParameter(allocator, request.head.target, "sort");
        defer if (sort_value) |value| allocator.free(value);
        const search = if (search_value) |value| request_tools.trimmedOptional(value) else null;
        const filter = if (filter_value) |value| if (value.len > 0) value else null else null;
        const sort = if (sort_value) |value| request_tools.trimmedOptional(value) else null;
        const limit: usize = @intCast(@min(@max(request_tools.queryUnsigned(request.head.target, "limit") orelse 50, 1), 100));
        const raw_offset = request_tools.queryUnsigned(request.head.target, "offset") orelse 0;
        const offset = std.math.cast(usize, raw_offset) orelse std.math.maxInt(usize);
        var result = huggingface_models.payload(allocator, io, client, environment, search, filter, sort, limit, offset) catch |failure| {
            var output: Io.Writer.Allocating = .init(allocator);
            defer output.deinit();
            try output.writer.writeAll("{\"detail\":");
            const detail = try std.fmt.allocPrint(allocator, "Failed to reach HuggingFace API: {t}", .{failure});
            defer allocator.free(detail);
            try std.json.Stringify.value(detail, .{}, &output.writer);
            try output.writer.writeByte('}');
            try request.respond(output.writer.buffered(), .{ .status = .service_unavailable, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        };
        defer result.deinit();
        try request.respond(result.body, .{ .status = result.status, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/downloads") and request.head.method == .GET) {
        const response = response: {
            try database.lock(io);
            defer database.unlock(io);
            break :response try downloads.listPayload(allocator, database);
        };
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/downloads") and request.head.method == .POST) {
        return serveDownloadStart(allocator, io, configuration, studio, download_state, client, database, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/downloads/:downloadId") and request.head.method == .GET) {
        const download_id = try request_tools.pathParameter(allocator, request.head.target, "/studio/downloads/");
        defer allocator.free(download_id);
        const response = response: {
            try database.lock(io);
            defer database.unlock(io);
            break :response try downloads.getPayload(allocator, database, download_id);
        };
        const download = response orelse {
            try request.respond("{\"detail\":\"Download not found\"}", .{ .status = .not_found, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        };
        defer allocator.free(download);
        var output: Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"download\":");
        try output.writer.writeAll(download);
        try output.writer.writeByte('}');
        try request.respond(output.writer.buffered(), .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/downloads/:downloadId/pause")) {
        return serveDownloadControl(allocator, configuration, download_state, client, database, request, .pause);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/downloads/:downloadId/resume")) {
        return serveDownloadControl(allocator, configuration, download_state, client, database, request, .@"resume");
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/downloads/:downloadId/cancel")) {
        return serveDownloadControl(allocator, configuration, download_state, client, database, request, .cancel);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/studio/provider-models") and request.head.method == .GET) {
        var snapshot = try provider_service.loadSnapshot(allocator, io, studio, configuration.data_dir);
        defer snapshot.deinit();
        const configured_catalog = try provider_catalog.payload(allocator, io, client, snapshot.providers);
        defer allocator.free(configured_catalog);
        const subscription_catalog = try head_provider_state.catalogPayload();
        defer allocator.free(subscription_catalog);
        const response = try provider_routing.mergeProviderCatalogs(allocator, configured_catalog, subscription_catalog);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/model-providers") and request.head.method == .GET) {
        const response = try head_provider_state.listPayload();
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/model-providers/:providerId/login") and request.head.method == .POST) {
        const provider_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/studio/model-providers/", "/login");
        defer allocator.free(provider_id);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return respondDownloadError(request, .bad_request, "Invalid JSON body");
        defer parsed.deinit();
        const auth_type = if (parsed.value == .object) if (parsed.value.object.get("type")) |value| if (value == .string) value.string else "" else "" else "";
        const response = head_provider_state.startLogin(client, provider_id, auth_type) catch |failure| return respondHeadProviderFailure(request, failure);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/model-providers/:providerId/login/:jobId") and request.head.method == .GET) {
        const parameters = try request_tools.modelProviderJobParameters(allocator, request.head.target, "");
        defer parameters.deinit(allocator);
        const response = try head_provider_state.jobPayload(parameters.provider_id, parameters.job_id, request_tools.queryUnsigned(request.head.target, "after") orelse 0) orelse return respondDownloadError(request, .not_found, "Model provider login job not found");
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/model-providers/:providerId/login/:jobId/cancel") and request.head.method == .POST) {
        const parameters = try request_tools.modelProviderJobParameters(allocator, request.head.target, "/cancel");
        defer parameters.deinit(allocator);
        if (!(try head_provider_state.cancel(parameters.provider_id, parameters.job_id))) return respondDownloadError(request, .not_found, "Model provider login job not found");
        try request.respond("{\"ok\":true}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/model-providers/:providerId/login/:jobId/respond") and request.head.method == .POST) {
        const parameters = try request_tools.modelProviderJobParameters(allocator, request.head.target, "/respond");
        defer parameters.deinit(allocator);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return respondDownloadError(request, .bad_request, "Invalid JSON body");
        defer parsed.deinit();
        const prompt_id = if (parsed.value == .object) parsed.value.object.get("promptId") orelse return respondDownloadError(request, .bad_request, "promptId is required") else return respondDownloadError(request, .bad_request, "Invalid JSON body");
        const value = if (parsed.value == .object) parsed.value.object.get("value") orelse return respondDownloadError(request, .bad_request, "value is required") else unreachable;
        if (prompt_id != .integer or prompt_id.integer < 0 or value != .string) return respondDownloadError(request, .bad_request, "Invalid provider login response");
        if (!(try head_provider_state.respond(parameters.provider_id, parameters.job_id, @intCast(prompt_id.integer), value.string))) return respondDownloadError(request, .conflict, "No matching model provider login prompt");
        try request.respond("{\"ok\":true}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/model-providers/:providerId/logout") and request.head.method == .POST) {
        const provider_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/studio/model-providers/", "/logout");
        defer allocator.free(provider_id);
        if (!(try head_provider_state.logout(provider_id))) return respondDownloadError(request, .not_found, "Head model provider not found");
        try request.respond("{\"ok\":true}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/providers") and request.head.method == .GET) {
        const response = try provider_service.listPayload(allocator, io, studio, configuration.data_dir);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/providers") and request.head.method == .POST) {
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        const response = provider_service.createPayload(allocator, io, studio, configuration.data_dir, document) catch |failure| return respondProviderFailure(request, failure, null);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/studio/providers/:id") and (request.head.method == .PUT or request.head.method == .DELETE)) {
        const provider_id = try request_tools.pathParameter(allocator, request.head.target, "/studio/providers/");
        defer allocator.free(provider_id);
        const response = if (request.head.method == .PUT) response: {
            const document = try readBoundedJsonBody(allocator, request) orelse return false;
            defer allocator.free(document);
            break :response provider_service.updatePayload(allocator, io, studio, configuration.data_dir, provider_id, document) catch |failure| return respondProviderFailure(request, failure, provider_id);
        } else provider_service.deletePayload(allocator, io, studio, configuration.data_dir, provider_id) catch |failure| return respondProviderFailure(request, failure, provider_id);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/vllm")) {
        return serveRuntimeBackend(allocator, configuration, system, runtime_cache, .vllm, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/sglang")) {
        return serveRuntimeBackend(allocator, configuration, system, runtime_cache, .sglang, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/llamacpp")) {
        return serveRuntimeBackend(allocator, configuration, system, runtime_cache, .llamacpp, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/mlx")) {
        return serveRuntimeBackend(allocator, configuration, system, runtime_cache, .mlx, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/cuda")) {
        const response = try runtime_routes.cudaPayload(allocator, configuration, system, runtime_cache);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/rocm")) {
        const response = try runtime_routes.rocmPayload(allocator, configuration, system, runtime_cache);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/vllm/config")) {
        return serveRuntimeConfigHelp(allocator, io, configuration, .vllm, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/llamacpp/config")) {
        return serveRuntimeConfigHelp(allocator, io, configuration, .llamacpp, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/targets") and request.head.method == .GET) {
        const response = try runtime_routes.targetsPayload(allocator, io, configuration, system, runtime_cache, supervisor);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/targets/:targetId/select")) {
        const target_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/runtime/targets/", "/select");
        defer allocator.free(target_id);
        try studio.lockSettings(io);
        defer studio.unlockSettings(io);
        const response = try runtime_routes.selectTargetPayload(allocator, io, configuration, system, runtime_cache, supervisor, target_id) orelse {
            try request.respond("{\"detail\":\"Runtime target not found\"}", .{ .status = .not_found, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        };
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/jobs") and request.head.method == .GET) {
        const response = try runtime_jobs.listPayload();
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/jobs") and request.head.method == .POST) {
        return serveRuntimeJobCreate(allocator, configuration, runtime_jobs, runtime_cache, request, null, false);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/jobs/:jobId") and request.head.method == .GET) {
        const job_id = try request_tools.pathParameter(allocator, request.head.target, "/runtime/jobs/");
        defer allocator.free(job_id);
        const response = try runtime_jobs.onePayload(job_id) orelse {
            try request.respond("{\"detail\":\"Runtime job not found\"}", .{ .status = .not_found, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        };
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/jobs/:jobId/cancel")) {
        const job_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/runtime/jobs/", "/cancel");
        defer allocator.free(job_id);
        const response = try runtime_jobs.cancelPayload(job_id) orelse {
            try request.respond("{\"detail\":\"Runtime job not found\"}", .{ .status = .not_found, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        };
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/runtime/:backend/upgrade")) {
        const backend = try request_tools.pathParameterBetween(allocator, request.head.target, "/runtime/", "/upgrade");
        defer allocator.free(backend);
        if (!runtimeJobBackend(backend)) {
            try request.respond("{\"detail\":\"Unknown runtime backend\"}", .{ .status = .not_found, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        }
        return serveRuntimeJobCreate(allocator, configuration, runtime_jobs, runtime_cache, request, backend, true);
    }
    if (mode == .head and std.mem.eql(u8, route.path, "/v1/models")) {
        const response = try headModelCatalogPayload(allocator, io, configuration, studio, head_provider_state, client, database);
        defer allocator.free(response);
        try request.respond(response, .{
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/models")) {
        const response = try localModelCatalogPayload(allocator, io, configuration, studio, head_provider_state, client, database, recipe_column, llm_instance_path);
        defer allocator.free(response);
        try request.respond(response, .{
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    }
    if (mode == .head and std.mem.eql(u8, route.path, "/v1/chat/completions")) {
        return try serveHeadInference(allocator, io, configuration, studio, head_provider_state, client, database, worker_pool, request);
    }
    if (mode == .head and std.mem.eql(u8, route.path, "/v1/responses")) {
        return try serveHeadInference(allocator, io, configuration, studio, head_provider_state, client, database, worker_pool, request);
    }
    if (mode == .head and std.mem.eql(u8, route.path, "/v1/messages")) {
        return try serveHeadInference(allocator, io, configuration, studio, head_provider_state, client, database, worker_pool, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/chat/completions")) {
        return try serveLocalChat(allocator, io, configuration, studio, head_provider_state, client, database, recipe_column, llm_instance_path, request, inference_origin);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/responses")) {
        return try serveLocalPassthrough(allocator, io, configuration, studio, head_provider_state, client, database, recipe_column, llm_instance_path, request, inference_origin, .responses);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/messages")) {
        return try serveLocalPassthrough(allocator, io, configuration, studio, head_provider_state, client, database, recipe_column, llm_instance_path, request, inference_origin, .messages);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/count-tokens")) {
        return try serveTokenization(allocator, io, client, database, recipe_column, llm_instance_path, request, inference_origin, .count);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/tokenize-chat-completions")) {
        return try serveTokenization(allocator, io, client, database, recipe_column, llm_instance_path, request, inference_origin, .chat);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/launch/:recipeId")) {
        const recipe_id = try request_tools.pathParameter(allocator, request.head.target, "/launch/");
        defer allocator.free(recipe_id);
        supervisor.launch(client, database, recipe_column, recipe_id, configuration) catch |failure| {
            return try respondLifecycleFailure(request, failure);
        };
        try request.respond("{\"success\":true,\"message\":\"Launch started\"}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/launch/:recipeId/cancel")) {
        const recipe_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/launch/", "/cancel");
        defer allocator.free(recipe_id);
        if (!(try supervisor.cancelLaunch())) {
            var output: Io.Writer.Allocating = .init(allocator);
            defer output.deinit();
            try output.writer.writeAll("{\"detail\":");
            const detail = try std.fmt.allocPrint(allocator, "No launch in progress for {s}", .{recipe_id});
            defer allocator.free(detail);
            try std.json.Stringify.value(detail, .{}, &output.writer);
            try output.writer.writeByte('}');
            try request.respond(output.writer.buffered(), .{ .status = .not_found, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        }
        var output: Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"success\":true,\"message\":");
        const message = try std.fmt.allocPrint(allocator, "Launch of {s} cancelled", .{recipe_id});
        defer allocator.free(message);
        try std.json.Stringify.value(message, .{}, &output.writer);
        try output.writer.writeByte('}');
        try request.respond(output.writer.buffered(), .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/evict")) {
        _ = supervisor.evict() catch |failure| {
            return try respondLifecycleFailure(request, failure);
        };
        try request.respond("{\"success\":true,\"evicted_pid\":null}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/wait-ready")) {
        const timeout = request_tools.queryUnsigned(request.head.target, "timeout") orelse 300;
        const started = Io.Clock.awake.now(io);
        const ready = try supervisor.waitReady(client, @min(timeout, 86_400));
        const elapsed = @max(started.durationTo(Io.Clock.awake.now(io)).toSeconds(), 0);
        var output: Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        if (ready) {
            try output.writer.print("{{\"ready\":true,\"elapsed\":{d}}}", .{elapsed});
        } else {
            try output.writer.print("{{\"ready\":false,\"elapsed\":{d},\"error\":\"Timeout waiting for backend\"}}", .{timeout});
        }
        try request.respond(output.writer.buffered(), .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/status")) {
        const response = try supervisor.statusPayload(database, recipe_column, inference_port, default_trust_remote_code);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/gpus")) {
        const response = try telemetry.gpuPayload(allocator, io, system);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/config")) {
        const models_dir = try studio.modelsDirectory(allocator, io);
        defer allocator.free(models_dir);
        const response = try system_service.configPayload(allocator, io, configuration, models_dir, system, supervisor, runtime_cache);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/compat")) {
        const response = try system_service.compatibilityPayload(allocator, io, configuration, system, supervisor, runtime_cache);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/compute/engines")) {
        const response = try system_service.computeEnginesPayload(allocator, io, configuration, system, runtime_cache);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/compute/devices")) {
        const response = try telemetry.devicePayload(allocator, io, system);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/metrics/vllm")) {
        const response = try metrics.payload(allocator, io, client, database, recipe_column, inference_port, default_trust_remote_code, system, supervisor);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/events")) {
        try serveControllerEvents(allocator, io, client, database, recipe_column, configuration, studio, default_trust_remote_code, system, supervisor, runtime_cache, request);
        return false;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/logs") and request.head.method == .GET) {
        const response = try logs.listPayload(allocator, io, configuration, database, recipe_column, default_trust_remote_code, supervisor);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/logs/:sessionId") and request.head.method == .GET) {
        const session_id = try request_tools.pathParameter(allocator, request.head.target, "/logs/");
        defer allocator.free(session_id);
        const limit_value = request_tools.queryUnsigned(request.head.target, "limit") orelse 2000;
        if (limit_value == 0 or limit_value > 20_000) {
            try request.respond("{\"detail\":\"Invalid log limit\"}", .{ .status = .bad_request, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        }
        const response = logs.tailPayload(allocator, io, configuration, session_id, @intCast(limit_value)) catch |failure| {
            if (failure == error.InvalidSessionId) {
                try request.respond("{\"detail\":\"Invalid log session id\"}", .{ .status = .bad_request, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
                return request.head.keep_alive;
            }
            return failure;
        } orelse {
            try request.respond("{\"detail\":\"Log not found\"}", .{ .status = .not_found, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        };
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/logs/:sessionId") and request.head.method == .DELETE) {
        const session_id = try request_tools.pathParameter(allocator, request.head.target, "/logs/");
        defer allocator.free(session_id);
        const deleted = logs.delete(io, allocator, configuration, session_id) catch |failure| switch (failure) {
            error.InvalidSessionId => {
                try request.respond("{\"detail\":\"Invalid log session id\"}", .{ .status = .bad_request, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
                return request.head.keep_alive;
            },
            error.ControllerLogProtected => {
                try request.respond("{\"detail\":\"controller logs cannot be deleted via API\"}", .{ .status = .bad_request, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
                return request.head.keep_alive;
            },
            else => return failure,
        };
        if (!deleted) {
            try request.respond("{\"detail\":\"Log not found\"}", .{ .status = .not_found, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        }
        try request.respond("{\"success\":true}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/logs/:sessionId/stream")) {
        const session_id = try request_tools.pathParameterBetween(allocator, request.head.target, "/logs/", "/stream");
        defer allocator.free(session_id);
        const tail_value = request_tools.queryUnsigned(request.head.target, "tail") orelse 2000;
        if (tail_value > 20_000) {
            try request.respond("{\"detail\":\"Invalid log tail\"}", .{ .status = .bad_request, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        }
        const log_path = logs.resolveLogPath(allocator, io, configuration, session_id) catch |failure| {
            if (failure == error.InvalidSessionId) {
                try request.respond("{\"detail\":\"Invalid log session id\"}", .{ .status = .bad_request, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
                return request.head.keep_alive;
            }
            return failure;
        } orelse {
            try request.respond("{\"detail\":\"Log not found\"}", .{ .status = .not_found, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        };
        defer allocator.free(log_path);
        try serveLogStream(allocator, io, configuration, session_id, log_path, @intCast(tail_value), request);
        return false;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/compute/instances") and request.head.method == .GET) {
        const response = try compute.instancesPayload(client);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/compute/launch") and request.head.method == .POST) {
        return serveComputeLaunch(allocator, configuration, system, compute, client, request);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/compute/instances/:name/stop") and request.head.method == .POST) {
        const name = try request_tools.pathParameterBetween(allocator, request.head.target, "/compute/instances/", "/stop");
        defer allocator.free(name);
        const stopped = if (std.mem.eql(u8, name, "llm")) stopped: {
            _ = try compute.cancelActive(name);
            break :stopped supervisor.stopNamed(name) catch |failure| return try respondLifecycleFailure(request, failure);
        } else try compute.stop(name);
        try request.respond(if (stopped) "{\"stopped\":true}" else "{\"stopped\":false}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/compute/instances/:name/cancel") and request.head.method == .POST) {
        const name = try request_tools.pathParameterBetween(allocator, request.head.target, "/compute/instances/", "/cancel");
        defer allocator.free(name);
        const cancelled = if (try compute.cancelActive(name)) true else if (std.mem.eql(u8, name, "llm")) try supervisor.cancelNamed(name) else try compute.cancel(name);
        try request.respond(if (cancelled) "{\"cancelled\":true}" else "{\"cancelled\":false}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/recipes") and request.head.method == .GET) {
        const response = try recipe_service.listPayload(allocator, io, database, recipe_column, llm_instance_path, default_trust_remote_code);
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/recipes/:recipeId") and request.head.method == .GET) {
        const recipe_id = try request_tools.pathParameter(allocator, request.head.target, "/recipes/");
        defer allocator.free(recipe_id);
        const response = try recipe_service.detailPayload(allocator, io, database, recipe_column, recipe_id, default_trust_remote_code) orelse {
            try request.respond("{\"detail\":\"Recipe not found\"}", .{
                .status = .not_found,
                .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
            });
            return request.head.keep_alive;
        };
        defer allocator.free(response);
        try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/recipes") and request.head.method == .POST) {
        return try saveRecipe(allocator, io, database, recipe_column, request, null, default_trust_remote_code);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/recipes/:recipeId") and request.head.method == .PUT) {
        const recipe_id = try request_tools.pathParameter(allocator, request.head.target, "/recipes/");
        defer allocator.free(recipe_id);
        return try saveRecipe(allocator, io, database, recipe_column, request, recipe_id, default_trust_remote_code);
    }
    if (mode != .head and std.mem.eql(u8, route.path, "/recipes/:recipeId") and request.head.method == .DELETE) {
        const recipe_id = try request_tools.pathParameter(allocator, request.head.target, "/recipes/");
        defer allocator.free(recipe_id);
        if (!(try recipe_service.delete(io, database, recipe_id))) {
            try request.respond("{\"detail\":\"Recipe not found\"}", .{
                .status = .not_found,
                .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
            });
            return request.head.keep_alive;
        }
        try request.respond("{\"success\":true}", .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    if (std.mem.eql(u8, route.path, "/__zig-spike/proxy")) {
        const upstream = spike_upstream orelse {
            try request.respond("{\"detail\":\"Proxy spike upstream is not configured\"}", .{
                .status = .service_unavailable,
                .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
            });
            return request.head.keep_alive;
        };
        try reverse_proxy.serve(client, upstream, spike_fallback_upstream, request);
        return false;
    }

    if (std.mem.eql(u8, route.path, "/__zig-spike/sse")) {
        try serveSse(io, request);
        return false;
    }

    try request.respond("{\"detail\":\"Route is not implemented by the Zig migration slice\"}", .{
        .status = .not_implemented,
        .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
    });
    return request.head.keep_alive;
}

const DownloadControl = enum { pause, @"resume", cancel };

fn serveComputeLaunch(allocator: std.mem.Allocator, configuration: *const Config, system: *const system_info.Snapshot, compute: *compute_lifecycle.Manager, client: *http.Client, request: *http.Server.Request) !bool {
    const storage = try allocator.alloc(u8, max_settings_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_buffer: [16 * 1024]u8 = undefined;
    const reader = try request.readerExpectContinue(&request_buffer);
    _ = reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"unreadable launch request\"}", .{ .status = .bad_request, .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return false;
    };
    var parsed = compute_plan.parse(allocator, body_writer.buffered()) catch |failure| {
        const detail: []const u8 = if (failure == error.ForbiddenEngineArgument) "invalid launch request: forbidden engine argument" else "invalid launch request";
        return respondDownloadError(request, .bad_request, detail);
    };
    defer parsed.deinit();
    const response = compute.launchPayload(client, configuration, system, &parsed) catch |failure| return respondComputeFailure(request, failure, &parsed);
    defer allocator.free(response);
    try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn respondComputeFailure(request: *http.Server.Request, failure: anyerror, launch: *const compute_plan.Request) !bool {
    const status: http.Status = switch (failure) {
        error.UnsupportedEngine, error.DockerRuntimeNotImplemented => .unprocessable_entity,
        error.AlreadyRunning, error.NoCapacity => .conflict,
        error.LaunchCancelled => .bad_request,
        error.TooManyActiveLaunches => .service_unavailable,
        else => .service_unavailable,
    };
    var buffer: [4096]u8 = undefined;
    var output: Io.Writer = .fixed(&buffer);
    switch (failure) {
        error.UnsupportedEngine => try output.print("{s} cannot run here: unsupported on this host", .{launch.engine}),
        error.DockerRuntimeNotImplemented => try output.print("{s} cannot run here: runtime \"docker\" not available", .{launch.engine}),
        error.AlreadyRunning => if (launch.name.len <= 1024) try output.print("{s} is already running", .{launch.name}) else try output.writeAll("instance is already running"),
        error.NoCapacity => try output.print("needs {d} device(s); not enough free", .{launch.device_count}),
        error.LaunchCancelled => try output.writeAll("launch cancelled"),
        error.ReadinessTimeout => try output.writeAll("not healthy before the readiness deadline"),
        error.ProcessExitedEarly => try output.writeAll("process exited before becoming healthy"),
        error.TooManyActiveLaunches => try output.writeAll("too many active launches"),
        else => try output.writeAll(@errorName(failure)),
    }
    return respondDownloadError(request, status, output.buffered());
}

fn serveDownloadStart(allocator: std.mem.Allocator, io: Io, configuration: *const Config, studio: *studio_settings.State, state: *download_manager.State, client: *http.Client, database: *sqlite.Database, request: *http.Server.Request) !bool {
    const header_token = try capturedDownloadTokenHeader(allocator, request);
    defer if (header_token) |value| allocator.free(value);
    const document = try readBoundedJsonBody(allocator, request) orelse return false;
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return respondDownloadError(request, .bad_request, "Invalid JSON body");
    defer parsed.deinit();
    if (parsed.value != .object) return respondDownloadError(request, .bad_request, "Invalid JSON body");
    const object = parsed.value.object;
    const model_id = requiredDownloadString(object, "model_id") catch return respondDownloadError(request, .bad_request, "model_id is required");
    const revision = optionalDownloadString(object, "revision") catch return respondDownloadError(request, .bad_request, "Invalid revision");
    const destination = optionalDownloadString(object, "destination_dir") catch return respondDownloadError(request, .bad_request, "Invalid destination_dir");
    const body_token = optionalDownloadString(object, "hf_token") catch return respondDownloadError(request, .bad_request, "Invalid hf_token");
    const allow_patterns = downloadPatterns(allocator, object, "allow_patterns") catch return respondDownloadError(request, .bad_request, "Invalid allow_patterns");
    defer allocator.free(allow_patterns);
    const ignore_patterns = downloadPatterns(allocator, object, "ignore_patterns") catch return respondDownloadError(request, .bad_request, "Invalid ignore_patterns");
    defer allocator.free(ignore_patterns);
    const token = downloadToken(configuration.environment, body_token, header_token);
    const models_dir = try studio.modelsDirectory(allocator, io);
    defer allocator.free(models_dir);
    var result = state.startPayload(configuration, client, database, models_dir, .{
        .model_id = model_id,
        .revision = revision,
        .destination_dir = destination,
        .allow_patterns = allow_patterns,
        .ignore_patterns = ignore_patterns,
        .token = token,
    }) catch |failure| return respondDownloadFailure(request, failure);
    defer result.deinit(allocator);
    return respondDownloadAction(request, result);
}

fn serveDownloadControl(allocator: std.mem.Allocator, configuration: *const Config, state: *download_manager.State, client: *http.Client, database: *sqlite.Database, request: *http.Server.Request, control: DownloadControl) !bool {
    const suffix = switch (control) {
        .pause => "/pause",
        .@"resume" => "/resume",
        .cancel => "/cancel",
    };
    const id = try request_tools.pathParameterBetween(allocator, request.head.target, "/studio/downloads/", suffix);
    defer allocator.free(id);
    if (control == .@"resume") {
        const header_token = try capturedDownloadTokenHeader(allocator, request);
        defer if (header_token) |value| allocator.free(value);
        const document = try readBoundedJsonBody(allocator, request) orelse return false;
        defer allocator.free(document);
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, if (document.len > 0) document else "{}", .{}) catch return respondDownloadError(request, .bad_request, "Invalid JSON body");
        defer parsed.deinit();
        if (parsed.value != .object) return respondDownloadError(request, .bad_request, "Invalid JSON body");
        const body_token = optionalDownloadString(parsed.value.object, "hf_token") catch return respondDownloadError(request, .bad_request, "Invalid hf_token");
        const token = downloadToken(configuration.environment, body_token, header_token);
        var result = (state.resumePayload(configuration, client, database, id, token) catch |failure| return respondDownloadFailure(request, failure)) orelse return respondDownloadError(request, .not_found, "Download not found");
        defer result.deinit(allocator);
        return respondDownloadAction(request, result);
    }
    const response = switch (control) {
        .pause => try state.pausePayload(database, id),
        .cancel => try state.cancelPayload(database, id),
        .@"resume" => unreachable,
    } orelse return respondDownloadError(request, .not_found, "Download not found");
    defer allocator.free(response);
    try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn readBoundedJsonBody(allocator: std.mem.Allocator, request: *http.Server.Request) !?[]u8 {
    const storage = try allocator.alloc(u8, max_settings_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{ .status = .payload_too_large, .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return null;
    };
    return try allocator.dupe(u8, body_writer.buffered());
}

fn readBoundedAgentBody(allocator: std.mem.Allocator, request: *http.Server.Request) !?[]u8 {
    const storage = try allocator.alloc(u8, max_agent_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{ .status = .payload_too_large, .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return null;
    };
    return try allocator.dupe(u8, body_writer.buffered());
}

fn requiredDownloadString(object: std.json.ObjectMap, name: []const u8) ![]const u8 {
    const value = object.get(name) orelse return error.MissingDownloadField;
    if (value != .string or std.mem.trim(u8, value.string, " \t\r\n").len == 0) return error.InvalidDownloadField;
    return value.string;
}

fn optionalDownloadString(object: std.json.ObjectMap, name: []const u8) !?[]const u8 {
    const value = object.get(name) orelse return null;
    return switch (value) {
        .null => null,
        .string => |text| text,
        else => error.InvalidDownloadField,
    };
}

fn downloadPatterns(allocator: std.mem.Allocator, object: std.json.ObjectMap, name: []const u8) ![]const []const u8 {
    const value = object.get(name) orelse return allocator.alloc([]const u8, 0);
    if (value == .null) return allocator.alloc([]const u8, 0);
    if (value != .array or value.array.items.len > 10_000) return error.InvalidDownloadField;
    var count: usize = 0;
    for (value.array.items) |entry| {
        if (entry != .string) return error.InvalidDownloadField;
        if (entry.string.len > 4096) return error.InvalidDownloadField;
        if (entry.string.len > 0) count += 1;
    }
    const patterns = try allocator.alloc([]const u8, count);
    var index: usize = 0;
    for (value.array.items) |entry| {
        if (entry.string.len == 0) continue;
        patterns[index] = entry.string;
        index += 1;
    }
    return patterns;
}

fn capturedDownloadTokenHeader(allocator: std.mem.Allocator, request: *const http.Server.Request) !?[]u8 {
    if (request_tools.header(request, "x-hf-token")) |value| if (value.len > 0) return try allocator.dupe(u8, value);
    if (request_tools.header(request, "x-huggingface-token")) |value| if (value.len > 0) return try allocator.dupe(u8, value);
    return null;
}

fn downloadToken(environment: *const std.process.Environ.Map, body_token: ?[]const u8, header_token: ?[]const u8) ?[]const u8 {
    if (body_token) |value| if (value.len > 0) return value;
    if (header_token) |value| return value;
    for ([_][]const u8{ "LOCAL_STUDIO_HF_TOKEN", "HF_TOKEN", "HUGGINGFACE_TOKEN" }) |name| if (environment.get(name)) |value| if (value.len > 0) return value;
    return null;
}

fn respondDownloadAction(request: *http.Server.Request, result: download_manager.Action) !bool {
    switch (result) {
        .payload => |payload| try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} }),
        .conflict => |detail| return respondDownloadError(request, .conflict, detail),
    }
    return request.head.keep_alive;
}

fn respondDownloadFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.ModelIdRequired, error.InvalidDownloadField, error.InvalidDestinationPath, error.NoDownloadableFiles, error.MultipleGgufVariants, error.InvalidHuggingFaceModelInfo => .bad_request,
        error.TooManyActiveDownloads => .service_unavailable,
        error.DownloadRecordTooLarge => .payload_too_large,
        error.HuggingFaceApiError, error.HuggingFaceMetadataTimeout => .bad_gateway,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.ModelIdRequired => "Model id is required",
        error.InvalidDownloadField => "Invalid download request",
        error.InvalidDestinationPath => "Invalid destination path",
        error.NoDownloadableFiles => "No downloadable files found for this model",
        error.MultipleGgufVariants => "Multiple GGUF weight variants found. Choose one file before downloading",
        error.TooManyActiveDownloads => "Too many active downloads",
        error.DownloadRecordTooLarge => "Download metadata is too large",
        error.HuggingFaceApiError => "Hugging Face API error",
        error.HuggingFaceMetadataTimeout => "Hugging Face API request timed out",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondDownloadError(request: *http.Server.Request, status: http.Status, detail: []const u8) !bool {
    var buffer: [8192]u8 = undefined;
    var output: Io.Writer = .fixed(&buffer);
    try output.writeAll("{\"detail\":");
    try std.json.Stringify.value(detail, .{}, &output);
    try output.writeByte('}');
    try request.respond(output.buffered(), .{ .status = status, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn headModelCatalogPayload(allocator: std.mem.Allocator, io: Io, configuration: *const Config, studio: *studio_settings.State, head_provider_state: *head_providers.State, client: *http.Client, database: *sqlite.Database) ![]u8 {
    const worker_response = try worker_service.modelCatalogPayload(allocator, io, client, database);
    defer allocator.free(worker_response);
    var snapshot = try provider_service.loadSnapshot(allocator, io, studio, configuration.data_dir);
    defer snapshot.deinit();
    const provider_response = try provider_catalog.payload(allocator, io, client, snapshot.providers);
    defer allocator.free(provider_response);
    const subscription_response = try head_provider_state.catalogPayload();
    defer allocator.free(subscription_response);
    const all_providers = try provider_routing.mergeProviderCatalogs(allocator, provider_response, subscription_response);
    defer allocator.free(all_providers);
    return provider_routing.mergedModelCatalog(allocator, worker_response, all_providers);
}

fn localModelCatalogPayload(allocator: std.mem.Allocator, io: Io, configuration: *const Config, studio: *studio_settings.State, head_provider_state: *head_providers.State, client: *http.Client, database: *sqlite.Database, recipe_column: recipes.PayloadColumn, llm_instance_path: []const u8) ![]u8 {
    const local_response = try model_service.localCatalogPayload(allocator, io, database, recipe_column, llm_instance_path);
    defer allocator.free(local_response);
    if (configuration.mode != .standalone) return allocator.dupe(u8, local_response);
    var snapshot = try provider_service.loadSnapshot(allocator, io, studio, configuration.data_dir);
    defer snapshot.deinit();
    const provider_response = try provider_catalog.payload(allocator, io, client, snapshot.providers);
    defer allocator.free(provider_response);
    const subscription_response = try head_provider_state.catalogPayload();
    defer allocator.free(subscription_response);
    const all_providers = try provider_routing.mergeProviderCatalogs(allocator, provider_response, subscription_response);
    defer allocator.free(all_providers);
    return provider_routing.mergedModelCatalog(allocator, local_response, all_providers);
}

const CanonicalRoute = struct {
    known: bool,
    route: ?[]u8,
};

fn resolveCanonicalRoute(allocator: std.mem.Allocator, runtime_catalog: []const u8, captured: *const reverse_proxy.CapturedRequest, requested_model: []const u8) !CanonicalRoute {
    const canonical = try model_catalog.canonicalId(allocator, requested_model) orelse return .{ .known = false, .route = null };
    defer allocator.free(canonical);
    if (try model_catalog.routeForModel(allocator, runtime_catalog, canonical, requested_model)) |exact| return .{ .known = true, .route = exact };
    var preferred: ?[]const u8 = null;
    for (captured.headers) |header| if (std.ascii.eqlIgnoreCase(header.name, "x-local-studio-model-route")) {
        preferred = std.mem.trim(u8, header.value, " \t\r\n");
        break;
    };
    return .{ .known = true, .route = try model_catalog.routeForModel(allocator, runtime_catalog, canonical, preferred) };
}

fn respondProviderFailure(request: *http.Server.Request, failure: anyerror, provider_id: ?[]const u8) !bool {
    const status: http.Status = switch (failure) {
        error.ProviderNotFound => .not_found,
        error.ProviderSettingsTooLarge => .payload_too_large,
        error.InvalidProviderPayload, error.ProviderIdRequired, error.ProviderNameRequired, error.ProviderBaseUrlRequired, error.ProviderExists, error.TooManyProviders, error.InvalidProvider, error.ProviderFieldTooLarge => .bad_request,
        else => return failure,
    };
    const static_detail: []const u8 = switch (failure) {
        error.InvalidProviderPayload => "Invalid provider payload",
        error.ProviderIdRequired => "id is required",
        error.ProviderNameRequired => "name is required",
        error.ProviderBaseUrlRequired => "base_url is required",
        error.ProviderExists => "Provider already exists",
        error.TooManyProviders => "Too many providers",
        error.InvalidProvider => "Invalid provider",
        error.ProviderFieldTooLarge => "Provider field is too large",
        error.ProviderSettingsTooLarge => "Provider settings are too large",
        error.ProviderNotFound => "Provider not found",
        else => unreachable,
    };
    if (failure != error.ProviderNotFound or provider_id == null or provider_id.?.len > 2048) return respondDownloadError(request, status, static_detail);
    var buffer: [4096]u8 = undefined;
    var output: Io.Writer = .fixed(&buffer);
    try output.print("Provider \"{s}\" not found", .{provider_id.?});
    return respondDownloadError(request, status, output.buffered());
}

fn respondHeadProviderFailure(request: *http.Server.Request, failure: anyerror) !bool {
    return switch (failure) {
        error.ProviderNotFound => respondDownloadError(request, .not_found, "Head model provider not found"),
        error.InvalidAuthType => respondDownloadError(request, .bad_request, "Provider requires OAuth"),
        else => respondDownloadError(request, .service_unavailable, "Head model provider is unavailable"),
    };
}

fn respondHarnessFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.RemoteHarnessRequired, error.HarnessNodeRequired, error.SessionNodeMismatch, error.SessionHarnessMismatch, error.SessionNotActive, error.ModelChangeRequiresNewSession, error.QueueMutationNotSupported, error.HarnessCommandRejected, error.HarnessDriverUnavailable => .conflict,
        error.SessionNotFound => .not_found,
        error.InvalidTurnPayload, error.InvalidCompactPayload, error.InvalidExtensionUiPayload, error.InvalidSessionPayload, error.InvalidSessionId, error.InvalidNativeSessionId, error.NativeSessionIdRequired, error.InvalidTranscriptCursor, error.InvalidTurnMode, error.ModelIdRequired, error.MessageRequired, error.SessionIdRequired, error.RequestIdRequired, error.CwdMustBeAbsolute, error.HarnessModelUnsupported, error.ManagedProjectWorkspaceRequired => .bad_request,
        error.FileNotFound, error.AssignedHarnessUnavailable, error.HarnessNodeUnavailable, error.HarnessUnavailable => .service_unavailable,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.RemoteHarnessRequired => "This Head has no enrolled harness node assigned to the session",
        error.HarnessNodeRequired => "No enrolled node offers the requested harness",
        error.AssignedHarnessUnavailable => "The session's assigned harness node is unavailable",
        error.SessionNodeMismatch => "The session is pinned to a different harness node",
        error.SessionHarnessMismatch => "The session is pinned to a different harness",
        error.HarnessDriverUnavailable => "The requested harness driver is not available on this node",
        error.HarnessUnavailable => "The requested harness installation is unavailable or unsupported",
        error.HarnessModelUnsupported => "Claude Code currently requires an OpenRouter model",
        error.SessionNotActive => "Runtime session is no longer active",
        error.SessionNotFound => "Runtime session not found",
        error.ModelChangeRequiresNewSession => "Changing models requires a new harness session",
        error.QueueMutationNotSupported => "Queue mutation is not available in the Zig harness protocol yet",
        error.CwdMustBeAbsolute => "cwd must be absolute",
        error.ManagedProjectWorkspaceRequired => "Prepare a task worktree before starting the agent",
        error.FileNotFound => "Pi executable was not found",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondProjectFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.ProjectPathRequired, error.ProjectPathMustBeAbsolute, error.ProjectPathNotFound, error.ProjectPathNotDirectory, error.ProjectPathOutsideRoots, error.ProjectIdRequired, error.InvalidProjectId, error.InvalidProjectPayload, error.CodeStorageAccountRequired, error.CodeStorageRepositoryRequired, error.InvalidCodeStorageRepository, error.CodeStoragePathMustBeAbsolute, error.ProjectDefaultBranchRequired, error.CodeStorageDefaultBranchRequired, error.CodeStorageDefaultBranchNotFound => .bad_request,
        error.CodeStorageAccountNotFound => .not_found,
        error.ProjectNodeRequired, error.ProjectNodeRejected, error.CodeStorageRepositoryAlreadyAdded, error.ProjectWorkspaceInvalid, error.ProjectRefNotFound, error.ProjectWorkspaceDirty => .conflict,
        error.ProjectNodeUnavailable => .service_unavailable,
        error.CodeStorageRequestRejected, error.CodeStorageGitFailed => .bad_gateway,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.ProjectPathRequired => "path is required",
        error.ProjectPathMustBeAbsolute => "Project path must be absolute",
        error.ProjectPathNotFound => "Project path does not exist",
        error.ProjectPathNotDirectory => "Project path is not a directory",
        error.ProjectPathOutsideRoots => "Project path is outside WORKSPACE_ROOTS",
        error.ProjectIdRequired => "id is required",
        error.InvalidProjectId => "Invalid project id",
        error.InvalidProjectPayload => "Invalid JSON body",
        error.CodeStorageAccountRequired => "Choose a Code.Storage account",
        error.CodeStorageAccountNotFound => "Code.Storage account not found",
        error.CodeStorageRepositoryRequired => "Repository name is required",
        error.InvalidCodeStorageRepository => "Repository name is invalid",
        error.CodeStoragePathMustBeAbsolute => "Project path must be absolute",
        error.ProjectDefaultBranchRequired => "The repository default branch is required",
        error.CodeStorageDefaultBranchRequired => "The imported repository is detached; choose its default branch",
        error.CodeStorageDefaultBranchNotFound => "The selected default branch does not exist in the imported repository",
        error.CodeStorageRepositoryAlreadyAdded => "That Code.Storage repository is already a project",
        error.CodeStorageRequestRejected => "Code.Storage could not create the repository",
        error.CodeStorageGitFailed => "Git history could not be mirrored to Code.Storage",
        error.ProjectNodeRequired => "No enrolled node offers project storage",
        error.ProjectNodeRejected => "The project node rejected the request",
        error.ProjectNodeUnavailable => "The project node is unavailable",
        error.ProjectWorkspaceInvalid => "The task worktree is incomplete",
        error.ProjectRepositoryInitializeFailed => "Git could not initialize the managed repository",
        error.ProjectFetchFailed => "Git could not fetch branches from Code.Storage",
        error.ProjectRefNotFound => "The selected branch does not exist in Code.Storage",
        error.ProjectWorkspaceDirty => "The task worktree has changes and cannot move to another branch",
        error.ProjectWorkspaceInspectFailed => "Git could not inspect the existing task worktree",
        error.ProjectWorktreeCreateFailed => "Git could not create the task worktree at the selected branch",
        error.ProjectWorktreeRemoveFailed => "Git could not replace the existing task worktree",
        error.ProjectWorktreePruneFailed => "Git could not prune archived task worktrees",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondConnectorFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.ConnectorIdRequired, error.InvalidConnectorId, error.ConnectorTransportRequired, error.InvalidConnectorTransport, error.ConnectorCommandRequired, error.ConnectorUrlRequired, error.InvalidConnectorUrl, error.InvalidConnectorPayload, error.InvalidConnectorGrantPayload, error.ConnectorGrantFieldsRequired, error.InvalidConnectorCallPayload, error.ConnectorCallFieldsRequired, error.ConnectorCwdMustBeAbsolute => .bad_request,
        error.ConnectorNotFound => .not_found,
        error.ConnectorToolDenied => .forbidden,
        error.ConnectorDisabled => .conflict,
        error.ConnectorNamespaceCollision, error.ConnectorNodeRequired, error.ConnectorNodeRejected => .conflict,
        error.ConnectorNodeUnavailable => .service_unavailable,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.ConnectorIdRequired => "id is required",
        error.InvalidConnectorId => "invalid connector id",
        error.ConnectorTransportRequired => "transport is required",
        error.InvalidConnectorTransport => "invalid connector transport",
        error.ConnectorCommandRequired => "command is required for stdio",
        error.ConnectorUrlRequired => "url is required for http",
        error.InvalidConnectorUrl => "url must start with http:// or https://",
        error.InvalidConnectorPayload => "invalid connector payload",
        error.InvalidConnectorGrantPayload => "invalid connector grant payload",
        error.ConnectorGrantFieldsRequired => "modelId, connectorId and tools are required",
        error.InvalidConnectorCallPayload => "invalid connector call payload",
        error.ConnectorCallFieldsRequired => "connector_id and tool are required",
        error.ConnectorCwdMustBeAbsolute => "connector cwd must be absolute",
        error.ConnectorNotFound => "unknown connector",
        error.ConnectorToolDenied => "connector tool is not granted",
        error.ConnectorDisabled => "connector is disabled",
        error.ConnectorNamespaceCollision => "Connector tool namespace collides with an existing connector",
        error.ConnectorNodeRequired => "No enrolled node offers MCP connectors",
        error.ConnectorNodeRejected => "The connector node rejected the request",
        error.ConnectorNodeUnavailable => "The connector node is unavailable",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondOAuthFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.ConnectorIdRequired, error.InvalidOAuthPayload => .bad_request,
        error.OAuthConnectorNotFound => .not_found,
        error.OAuthClientRequired, error.OAuthClientNotConfigurable, error.ConnectorNodeRequired => .conflict,
        error.NodeUnavailable, error.NodeRequestRejected, error.OAuthProviderRejected, error.InvalidOAuthProviderResponse, error.McpOAuthDiscoveryRejected, error.McpOAuthRegistrationRejected, error.McpOAuthChallengeRequired, error.McpOAuthResourceMetadataRequired, error.InvalidMcpOAuthMetadata, error.InvalidMcpOAuthResponse => .bad_gateway,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.ConnectorIdRequired => "connectorId is required",
        error.InvalidOAuthPayload => "Invalid OAuth request",
        error.OAuthConnectorNotFound => "The connector does not support OAuth",
        error.OAuthClientRequired => "Register an OAuth client for this provider first",
        error.OAuthClientNotConfigurable => "This provider manages OAuth client registration automatically",
        error.ConnectorNodeRequired => "No enrolled node offers MCP connectors",
        error.NodeUnavailable => "The connector node is unavailable",
        error.NodeRequestRejected => "The connector node rejected the OAuth request",
        error.OAuthProviderRejected => "GitHub refused the sign-in request",
        error.InvalidOAuthProviderResponse => "GitHub returned an invalid OAuth response",
        error.McpOAuthDiscoveryRejected, error.McpOAuthChallengeRequired, error.McpOAuthResourceMetadataRequired, error.InvalidMcpOAuthMetadata => "The MCP server did not provide valid OAuth discovery metadata",
        error.McpOAuthRegistrationRejected => "The MCP authorization server rejected client registration",
        error.InvalidMcpOAuthResponse => "The MCP authorization server returned an invalid response",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondGoogleFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.InvalidGooglePayload, error.InvalidGoogleService, error.GoogleAccountKeyRequired => .bad_request,
        error.GoogleAccountNotFound => .not_found,
        error.GoogleClientRequired, error.ConnectorNodeRequired => .conflict,
        error.NodeUnavailable, error.NodeRequestRejected => .bad_gateway,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.InvalidGooglePayload => "Invalid Google account request",
        error.InvalidGoogleService => "account is required",
        error.GoogleAccountKeyRequired => "accountKey is not a known account",
        error.GoogleAccountNotFound => "Google account connection not found",
        error.GoogleClientRequired => "Configure a Google OAuth client first",
        error.ConnectorNodeRequired => "No enrolled node offers MCP connectors",
        error.NodeUnavailable => "The connector node is unavailable",
        error.NodeRequestRejected => "The connector node rejected the Google account request",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondCodeStorageFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.InvalidCodeStorageAccountPayload, error.InvalidCredentialStorePayload, error.InvalidSandboxAccountPayload, error.InvalidSandboxProfile, error.InvalidMessagingAccountPayload, error.SecretProviderRequired, error.SandboxProviderRequired, error.SandboxCredentialRequired, error.SandboxAccountRequired, error.VercelTeamRequired, error.VercelProjectRequired, error.MessagingProviderRequired, error.MessagingCredentialRequired, error.MessagingModelRequired, error.DiscordApplicationIdRequired, error.DiscordPublicKeyRequired, error.CodeStorageOrganizationRequired, error.CodeStoragePrivateKeyRequired, error.InvalidCodeStorageOrganization, error.InvalidCodeStoragePrivateKey, error.InvalidSecretProvider, error.CodeStorageAccountRequired => .bad_request,
        error.CodeStorageAccountNotFound, error.SandboxAccountNotFound, error.MessagingAccountNotFound => .not_found,
        error.SecretSpecUnavailable, error.SecretStoreWriteFailed, error.SecretStoreReadFailed, error.SecretStoreDeleteFailed => .service_unavailable,
        error.ConnectorNodeRequired => .conflict,
        error.NodeUnavailable, error.NodeRequestRejected, error.DiscordCommandRegistrationFailed => .bad_gateway,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.InvalidCodeStorageAccountPayload => "Invalid Code.Storage account request",
        error.InvalidCredentialStorePayload => "Invalid credential store request",
        error.SecretProviderRequired => "Choose a SecretSpec credential store",
        error.InvalidSandboxAccountPayload => "Invalid sandbox account request",
        error.InvalidSandboxProfile => "Invalid sandbox machine profile",
        error.InvalidMessagingAccountPayload => "Invalid messaging account request",
        error.SandboxProviderRequired => "Choose Daytona or Vercel",
        error.SandboxCredentialRequired => "Enter the credentials required by this sandbox provider",
        error.VercelTeamRequired => "Enter the Vercel team ID",
        error.VercelProjectRequired => "Enter the Vercel project ID",
        error.SandboxAccountRequired => "Choose a sandbox account",
        error.SandboxAccountNotFound => "Sandbox account not found",
        error.MessagingProviderRequired => "Choose Telegram or Discord",
        error.MessagingCredentialRequired => "Enter the bot token",
        error.MessagingModelRequired => "Choose the Chat model used for messages",
        error.DiscordApplicationIdRequired => "Enter the Discord application ID",
        error.DiscordPublicKeyRequired => "Enter the Discord interaction public key",
        error.MessagingAccountNotFound => "Messaging account not found",
        error.DiscordCommandRegistrationFailed => "Discord rejected the bot token or slash command registration",
        error.CodeStorageOrganizationRequired, error.InvalidCodeStorageOrganization => "Enter the lowercase Code.Storage organization identifier",
        error.CodeStoragePrivateKeyRequired => "Paste the PKCS8 private key shown when the Code.Storage API key was created",
        error.InvalidCodeStoragePrivateKey => "The Code.Storage private key must be a valid ES256 PKCS8 PEM key",
        error.InvalidSecretProvider => "Choose a valid SecretSpec provider name, alias, or URI",
        error.CodeStorageAccountRequired => "Choose a Code.Storage account",
        error.CodeStorageAccountNotFound => "Code.Storage account not found",
        error.SecretSpecUnavailable => "The bundled SecretSpec vault is unavailable",
        error.SecretStoreWriteFailed => "SecretSpec could not save a credential to the selected store",
        error.SecretStoreReadFailed => "SecretSpec could not read a credential from its store",
        error.SecretStoreDeleteFailed => "SecretSpec could not remove a credential from its store",
        error.ConnectorNodeRequired => "No enrolled node offers MCP connectors",
        error.NodeUnavailable => "The connector node is unavailable",
        error.NodeRequestRejected => "The connector node rejected the Code.Storage account request",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondMessagingFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.InvalidDiscordSignature => .unauthorized,
        error.PairingNotFound => .not_found,
        error.PairingLocked => .locked,
        error.PairingExpired, error.PairingCodeInvalid => .forbidden,
        error.InvalidPairingPayload, error.InvalidMessagingDefaults, error.InvalidMessagingReaction, error.MessagingModelRequired, error.PairingIdRequired, error.PairingCodeRequired, error.InvalidDiscordInteraction, error.DiscordPublicKeyRequired => .bad_request,
        error.MessagingConversationNotFound, error.MessagingMessageNotFound => .not_found,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.InvalidDiscordSignature => "Discord interaction signature is invalid",
        error.PairingNotFound => "Pairing request not found",
        error.PairingLocked => "Pairing request is locked",
        error.PairingExpired => "Pairing request expired",
        error.PairingCodeInvalid => "Pairing code is invalid",
        error.InvalidPairingPayload => "Invalid pairing approval request",
        error.InvalidMessagingDefaults => "Invalid messaging defaults",
        error.MessagingModelRequired => "Choose a messaging model in Settings",
        error.PairingIdRequired => "pairingId is required",
        error.PairingCodeRequired => "code is required",
        error.InvalidDiscordInteraction => "Invalid Discord interaction",
        error.DiscordPublicKeyRequired => "Discord public key is not configured",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondTerminalFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.InvalidTerminalPayload, error.TerminalCommandRequired, error.TerminalCommandTooLarge, error.TerminalCwdRequired, error.TerminalFromMustBeAbsolute, error.PreviousDirectoryUnavailable, error.ProjectPathRequired, error.ProjectPathMustBeAbsolute, error.ProjectPathNotDirectory, error.InvalidPtyPayload, error.PtyIdRequired, error.InvalidPtyId, error.PtyInputRequired, error.InvalidPtyResponse => .bad_request,
        error.PtyInputTooLarge => .payload_too_large,
        error.ProjectPathNotFound => .not_found,
        error.ProjectPathOutsideRoots => .forbidden,
        error.TerminalNodeRequired, error.TerminalNodeRejected => .conflict,
        error.TerminalNodeUnavailable => .service_unavailable,
        error.PtyUnavailable, error.PtyLimitReached => .service_unavailable,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.InvalidTerminalPayload => "Invalid terminal payload",
        error.TerminalCommandRequired => "command is required",
        error.TerminalCommandTooLarge => "command is too large",
        error.TerminalCwdRequired => "cwd is required",
        error.TerminalFromMustBeAbsolute => "from must be absolute",
        error.PreviousDirectoryUnavailable => "OLDPWD not set",
        error.ProjectPathNotFound => "cwd not found",
        error.ProjectPathNotDirectory => "cwd is not a directory",
        error.ProjectPathOutsideRoots => "cwd is not an allowed workspace",
        error.TerminalNodeRequired => "No enrolled node offers terminal execution",
        error.TerminalNodeRejected => "The terminal node rejected the request",
        error.InvalidPtyPayload => "Invalid PTY payload",
        error.PtyIdRequired => "id is required",
        error.InvalidPtyId => "invalid PTY id",
        error.InvalidPtyResponse => "terminal node returned an invalid PTY response",
        error.PtyInputRequired => "id and data are required",
        error.PtyInputTooLarge => "input too large",
        error.PtyUnavailable => "PTY is unavailable on this platform",
        error.PtyLimitReached => "PTY session limit reached",
        error.TerminalNodeUnavailable => "The terminal node is unavailable",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn localBrowserPayload(allocator: std.mem.Allocator, browser: *agent_browser.Manager, client: *http.Client, route_path: []const u8, target: []const u8, method: http.Method, document: ?[]const u8) ![]u8 {
    if (std.mem.endsWith(u8, route_path, "/fetch")) {
        const url = try request_tools.queryParameter(allocator, target, "url");
        defer if (url) |value| allocator.free(value);
        return browser.fetchPayload(client, url orelse return error.BrowserUrlRequired);
    }
    if (std.mem.endsWith(u8, route_path, "/state")) return browser.statePayload();
    if (std.mem.endsWith(u8, route_path, "/history")) return browser.historyPayload(request_tools.queryUnsigned(target, "visited") == 1);
    if (std.mem.endsWith(u8, route_path, "/engines")) return browser.enginesPayload();
    if (std.mem.endsWith(u8, route_path, "/localhosts")) return allocator.dupe(u8, "{\"sites\":[]}");
    if (std.mem.endsWith(u8, route_path, "/engine")) return browser.selectEnginePayload(document orelse "");
    if (std.mem.endsWith(u8, route_path, "/frame") or std.mem.endsWith(u8, route_path, "/input") or std.mem.endsWith(u8, route_path, "/viewport")) return error.BrowserInteractiveUnavailable;
    if (method != .POST) return error.InvalidBrowserPath;
    const prefix = if (std.mem.startsWith(u8, route_path, "/internal/node/v1/browser/")) "/internal/node/v1/browser/" else "/api/agent/browser/";
    const verb = try request_tools.pathParameter(allocator, target, prefix);
    defer allocator.free(verb);
    return browser.verbPayload(client, verb, document orelse "");
}

fn respondBrowserFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.BrowserUrlRequired, error.InvalidBrowserUrl, error.BrowserAddressRejected, error.InvalidBrowserPayload, error.InvalidBrowserPath, error.BrowserEngineRequired, error.UnknownBrowserEngine => .bad_request,
        error.BrowserNodeRequired => .conflict,
        error.BrowserNodeUnavailable, error.BrowserInteractiveUnavailable => .service_unavailable,
        error.BrowserUpstreamRejected, error.BrowserRedirectUnsupported => .bad_gateway,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.BrowserUrlRequired => "url is required",
        error.InvalidBrowserUrl => "valid public or localhost http(s) url required",
        error.BrowserAddressRejected => "browser target address is not allowed",
        error.InvalidBrowserPayload => "invalid browser payload",
        error.InvalidBrowserPath => "invalid browser operation",
        error.BrowserEngineRequired => "engine is required",
        error.UnknownBrowserEngine => "unknown browser engine",
        error.BrowserNodeRequired => "No enrolled node offers browser execution",
        error.BrowserNodeUnavailable => "The browser node is unavailable",
        error.BrowserInteractiveUnavailable => "Interactive browser engine unavailable",
        error.BrowserUpstreamRejected => "Browser target rejected the request",
        error.BrowserRedirectUnsupported => "Browser target redirected the request",
        else => @errorName(failure),
    };
    if (status == .service_unavailable and failure == error.BrowserInteractiveUnavailable) {
        var buffer: [256]u8 = undefined;
        var output: Io.Writer = .fixed(&buffer);
        try output.writeAll("{\"ok\":false,\"error\":");
        try std.json.Stringify.value(detail, .{}, &output);
        try output.writeByte('}');
        try request.respond(output.buffered(), .{ .status = status, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    }
    return respondDownloadError(request, status, detail);
}

fn respondSessionFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.SessionNotFound => .not_found,
        error.SessionCwdRequired, error.InvalidSessionId, error.InvalidSessionMetadata, error.SessionArchivedRequired, error.ProjectPathRequired, error.ProjectPathMustBeAbsolute, error.ProjectPathNotFound, error.ProjectPathNotDirectory => .bad_request,
        error.ProjectPathOutsideRoots => .forbidden,
        error.AssignedHarnessUnavailable, error.HarnessUnavailable, error.HarnessNodeUnavailable => .service_unavailable,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.SessionNotFound => "session not found",
        error.SessionCwdRequired => "cwd is required",
        error.InvalidSessionId => "session id is invalid",
        error.InvalidSessionMetadata => "invalid session payload",
        error.SessionArchivedRequired => "archived boolean is required",
        error.ProjectPathMustBeAbsolute => "cwd must be absolute",
        error.ProjectPathNotFound => "cwd not found",
        error.ProjectPathNotDirectory => "cwd is not a directory",
        error.ProjectPathOutsideRoots => "cwd is not an allowed workspace",
        error.AssignedHarnessUnavailable, error.HarnessNodeUnavailable => "The session's harness node is unavailable",
        error.HarnessUnavailable => "The session harness is unavailable",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondDiscoveryFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.DiscoveryPathRequired => .bad_request,
        error.DiscoveryNotFound => .not_found,
        error.DiscoveryNodeRequired => .conflict,
        error.DiscoveryNodeUnavailable => .service_unavailable,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.DiscoveryPathRequired => "path is required",
        error.DiscoveryNotFound => "Skill or prompt template not found",
        error.DiscoveryNodeRequired => "No enrolled node offers harness discovery",
        error.DiscoveryNodeUnavailable => "The discovery node is unavailable",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondPrFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.PrCwdRequired, error.InvalidPrPayload, error.InvalidPrNumber, error.InvalidPrMethod, error.ProjectPathMustBeAbsolute => .bad_request,
        error.ProjectPathNotFound => .not_found,
        error.ProjectPathOutsideRoots => .forbidden,
        error.PrNodeRequired => .conflict,
        error.PrNodeUnavailable => .service_unavailable,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.PrCwdRequired => "cwd is required",
        error.InvalidPrPayload => "invalid pull request payload",
        error.InvalidPrNumber => "number must be a positive integer",
        error.InvalidPrMethod => "method must be merge, squash, or rebase",
        error.ProjectPathMustBeAbsolute => "cwd must be absolute",
        error.ProjectPathNotFound => "cwd not found",
        error.ProjectPathOutsideRoots => "cwd is outside allowed workspace roots",
        error.PrNodeRequired => "No enrolled node offers GitHub operations",
        error.PrNodeUnavailable => "The GitHub operation node is unavailable",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondGitFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.GitCwdRequired, error.InvalidGitPayload, error.GitActionRequired, error.InvalidGitAction, error.GitRefRequired, error.GitBranchRequired, error.InvalidGitRef, error.GitWorktreePathRequired, error.GitWorktreePathInvalid, error.GitCommitMessageRequired => .bad_request,
        error.GitCommitMessageTooLarge => .payload_too_large,
        error.ProjectPathNotFound => .not_found,
        error.ProjectPathOutsideRoots => .forbidden,
        error.GitNodeRequired => .conflict,
        error.GitNodeUnavailable => .service_unavailable,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.GitCwdRequired => "cwd is required",
        error.InvalidGitPayload => "invalid git payload",
        error.GitActionRequired => "git action is required",
        error.InvalidGitAction => "unknown git action",
        error.GitRefRequired, error.InvalidGitRef => "a valid ref is required",
        error.GitBranchRequired => "branch is required",
        error.GitWorktreePathRequired, error.GitWorktreePathInvalid => "a valid worktree path is required",
        error.GitCommitMessageRequired => "commit message is required",
        error.GitCommitMessageTooLarge => "commit message is too large",
        error.ProjectPathNotFound => "cwd not found",
        error.ProjectPathOutsideRoots => "cwd is outside allowed workspace roots",
        error.GitCommandFailed => "Git operation failed",
        error.GitNodeRequired => "No enrolled node offers git operations",
        error.GitNodeUnavailable => "The git operation node is unavailable",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondGoalFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.SessionIdRequired, error.InvalidSessionId, error.InvalidGoalPayload, error.InvalidGoalStatus, error.InvalidGoalBudget => .bad_request,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.SessionIdRequired => "piSessionId is required",
        error.InvalidSessionId => "Invalid piSessionId",
        error.InvalidGoalPayload => "Invalid goal payload",
        error.InvalidGoalStatus => "Invalid goal status",
        error.InvalidGoalBudget => "turnBudget must be positive or null",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondSubagentFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.SubagentNotFound, error.ParentSessionNotFound => .not_found,
        error.SubagentNestingDenied => .forbidden,
        error.TooManySubagents => .conflict,
        error.InvalidSubagentPayload, error.ParentSessionIdRequired, error.SubagentTaskRequired, error.SubagentTaskTooLarge, error.InvalidSubagentName, error.InvalidSubagentRunId, error.InvalidSessionId, error.SubagentCwdRequired => .bad_request,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.SubagentNotFound => "Subagent not found",
        error.ParentSessionNotFound => "No session found for this conversation",
        error.SubagentNestingDenied => "Subagents cannot spawn their own subagents",
        error.TooManySubagents => "Too many subagents are already running",
        error.ParentSessionIdRequired => "piSessionId is required",
        error.SubagentTaskRequired => "task is required",
        error.SubagentTaskTooLarge => "task is too large",
        error.InvalidSubagentName => "name is too long",
        error.InvalidSubagentRunId => "Invalid subagent run id",
        error.InvalidSessionId => "Invalid parent session id",
        error.SubagentCwdRequired => "Parent session has no working directory",
        error.SubagentRunFailed => "Subagent run failed",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondRigFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.RigNotFound, error.NodeNotFound => .not_found,
        error.HeadRequiredForWorker, error.LocalNodeImmutable => .conflict,
        error.InvalidRigPayload, error.InvalidRigRecord, error.RigNameRequired, error.NodeNameRequired, error.InvalidNodePayload, error.InvalidNodeCapabilities, error.InvalidNodeRole => .bad_request,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.RigNotFound => "Rig not found",
        error.NodeNotFound => "Node not found",
        error.HeadRequiredForWorker => "Workers can only be managed by a Head controller",
        error.LocalNodeImmutable => "The detected local node cannot be changed or removed",
        error.RigNameRequired => "name is required",
        error.NodeNameRequired => "node name is required",
        error.InvalidNodeCapabilities => "Invalid node capabilities",
        error.InvalidNodeRole => "Invalid node role",
        error.InvalidRigPayload, error.InvalidNodePayload => "Invalid JSON body",
        error.InvalidRigRecord => "Stored rig data is invalid",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondAutomationFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.AutomationNotFound => .not_found,
        error.InvalidAutomationPayload, error.InvalidAutomationRecord, error.InvalidAutomationSchedule, error.InvalidAutomationStatus, error.AutomationNameRequired, error.AutomationPromptRequired, error.AutomationModelRequired, error.AutomationCwdRequired, error.AutomationScheduleRequired => .bad_request,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.AutomationNotFound => "Automation not found",
        error.AutomationNameRequired => "name is required",
        error.AutomationPromptRequired => "prompt is required",
        error.AutomationModelRequired => "modelId is required",
        error.AutomationCwdRequired => "cwd is required",
        error.AutomationScheduleRequired => "schedule is required",
        error.InvalidAutomationSchedule => "Invalid automation schedule",
        error.InvalidAutomationStatus => "Invalid automation status",
        error.InvalidAutomationPayload => "Invalid JSON body",
        error.InvalidAutomationRecord => "Stored automation data is invalid",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondWorkbenchFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.WorkbenchTaskNotFound, error.WorkbenchProjectNotFound, error.WorkbenchTabNotFound => .not_found,
        error.WorkbenchTaskUnavailable, error.WorkbenchTabNotClosable => .conflict,
        error.InvalidWorkbenchCommand, error.InvalidWorkbenchViewId, error.WorkbenchCommandIdRequired, error.WorkbenchActorIdRequired, error.WorkbenchCommandKindRequired, error.WorkbenchTaskIdRequired, error.WorkbenchProjectIdRequired, error.WorkbenchTargetIdRequired, error.WorkbenchPinnedRequired, error.WorkbenchTabIdRequired, error.WorkbenchResourceKindRequired, error.WorkbenchResourceIdRequired, error.WorkbenchTabTitleRequired, error.WorkbenchLifecycleModeRequired, error.WorkbenchCacheLimitRequired, error.WorkbenchSidebarValueRequired, error.InvalidWorkbenchResourceKind, error.InvalidWorkbenchSidebarWidth, error.InvalidWorkbenchSidebarOrder, error.InvalidWorkbenchLifecycleMode, error.InvalidWorkbenchCacheLimit, error.UnknownWorkbenchCommand => .bad_request,
        else => .internal_server_error,
    };
    return respondDownloadError(request, status, @errorName(failure));
}

fn respondHeadConnectionFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.InvalidHeadConnection, error.HeadUrlRequired, error.InvalidHeadUrl, error.EnrollmentNodeAddressRequired, error.EnrollmentNodeCredentialRequired => .bad_request,
        error.HeadEnrollmentRejected => .bad_gateway,
        else => .internal_server_error,
    };
    const detail: []const u8 = switch (failure) {
        error.InvalidHeadConnection => "Invalid Head connection payload",
        error.HeadUrlRequired => "url is required",
        error.InvalidHeadUrl => "Head URL must use HTTP or HTTPS",
        error.IncompleteEnrollment => "nodeAddress and nodeApiKey must be provided together",
        error.HeadEnrollmentRejected => "The Head rejected this node enrollment",
        error.HeadConnectionWriteFailed => "Head connection could not be persisted",
        else => @errorName(failure),
    };
    return respondDownloadError(request, status, detail);
}

fn respondEnrollmentFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.EnrollmentNotFound => .not_found,
        error.InvalidEnrollmentPayload, error.EnrollmentNodeIdRequired, error.EnrollmentNodeNameRequired, error.EnrollmentNodeAddressRequired, error.EnrollmentNodeCredentialRequired, error.EnrollmentCapabilitiesRequired, error.InvalidEnrollmentNodeId, error.InvalidEnrollmentRole, error.InvalidEnrollmentAddress, error.InvalidEnrollmentCapabilities => .bad_request,
        else => .internal_server_error,
    };
    return respondDownloadError(request, status, switch (failure) {
        error.EnrollmentNotFound => "Enrollment not found",
        error.EnrollmentNodeIdRequired => "nodeId is required",
        error.EnrollmentNodeNameRequired => "name is required",
        error.EnrollmentNodeAddressRequired => "address is required",
        error.EnrollmentNodeCredentialRequired => "apiKey is required",
        error.EnrollmentCapabilitiesRequired => "capabilities are required",
        error.InvalidEnrollmentAddress => "address must use HTTP or HTTPS",
        error.InvalidEnrollmentNodeId, error.InvalidEnrollmentRole, error.InvalidEnrollmentCapabilities, error.InvalidEnrollmentPayload => "Invalid enrollment payload",
        else => @errorName(failure),
    });
}

fn serveStudioSettingsUpdate(allocator: std.mem.Allocator, io: Io, configuration: *const Config, studio: *studio_settings.State, database: *sqlite.Database, request: *http.Server.Request) !bool {
    const storage = try allocator.alloc(u8, max_settings_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{
            .status = .payload_too_large,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return false;
    };
    const response = studio_settings.updatePayload(allocator, io, configuration, studio, database, body_writer.buffered()) catch |failure| {
        const detail = switch (failure) {
            error.InvalidSettingsPayload => "Invalid JSON body",
            error.NoSupportedSettings => "No supported settings provided",
            error.InvalidModelsDirectory => "models_dir must be a string or null",
            error.InvalidUiPreferences => "ui_preferences must be an object of string values or null",
            else => return failure,
        };
        var output: Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"detail\":");
        try std.json.Stringify.value(detail, .{}, &output.writer);
        try output.writer.writeByte('}');
        try request.respond(output.writer.buffered(), .{ .status = .bad_request, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    };
    defer allocator.free(response);
    try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn serveVramCalculator(allocator: std.mem.Allocator, io: Io, configuration: *const Config, system: *const system_info.Snapshot, request: *http.Server.Request) !bool {
    const storage = try allocator.alloc(u8, max_settings_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{ .status = .payload_too_large, .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return false;
    };
    const response = vram_calculator.payload(allocator, io, system, configuration.models_dir, body_writer.buffered()) catch |failure| {
        const detail: []const u8 = switch (failure) {
            error.InvalidPayload => "Invalid payload",
            error.ModelRequired => "model is required",
            error.ModelOutsideRoot => "model must be inside models_dir",
            error.ModelNotFound => "Model path not found",
            error.WeightsNotFound => "Model weights not found",
            else => return failure,
        };
        const status: http.Status = switch (failure) {
            error.ModelNotFound, error.WeightsNotFound => .not_found,
            else => .bad_request,
        };
        var output: Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"detail\":");
        try std.json.Stringify.value(detail, .{}, &output.writer);
        try output.writer.writeByte('}');
        try request.respond(output.writer.buffered(), .{ .status = status, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    };
    defer allocator.free(response);
    try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn serveRuntimeJobCreate(allocator: std.mem.Allocator, configuration: *const Config, jobs: *runtime_jobs_service.State, cache: *runtime_info.Cache, request: *http.Server.Request, backend_override: ?[]const u8, legacy: bool) !bool {
    const storage = try allocator.alloc(u8, max_settings_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{ .status = .payload_too_large, .keep_alive = false, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return false;
    };
    const document = if (body_writer.buffered().len == 0) "{}" else body_writer.buffered();
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return respondBadRuntimeJob(request, "Invalid payload");
    defer parsed.deinit();
    if (parsed.value != .object) return respondBadRuntimeJob(request, "Invalid payload");
    const object = parsed.value.object;
    if (object.get("command") != null or object.get("args") != null) return respondBadRuntimeJob(request, "Invalid payload");
    const payload_backend = runtimeJobOptionalString(object, "backend") catch return respondBadRuntimeJob(request, "Invalid payload");
    const backend = backend_override orelse payload_backend orelse return respondBadRuntimeJob(request, "backend is required");
    if (!runtimeJobBackend(backend)) return respondBadRuntimeJob(request, "Invalid payload");
    const payload_type = runtimeJobOptionalString(object, "type") catch return respondBadRuntimeJob(request, "Invalid payload");
    const job_type = if (legacy) "update" else payload_type orelse "update";
    if (!std.mem.eql(u8, job_type, "install") and !std.mem.eql(u8, job_type, "update")) return respondBadRuntimeJob(request, "Invalid payload");
    const target_id = runtimeJobOptionalString(object, "targetId") catch return respondBadRuntimeJob(request, "Invalid payload");
    const version = runtimeJobOptionalString(object, "version") catch return respondBadRuntimeJob(request, "Invalid payload");
    const prefer_bundled = if (object.get("prefer_bundled")) |value| if (value == .bool) value.bool else return respondBadRuntimeJob(request, "Invalid payload") else null;
    const response = jobs.createPayload(configuration, cache, .{
        .backend = backend,
        .job_type = job_type,
        .target_id = target_id,
        .version = version,
        .prefer_bundled = prefer_bundled,
    }, legacy) catch |failure| switch (failure) {
        error.InvalidJobPayload => return respondBadRuntimeJob(request, "Invalid payload"),
        error.TooManyRuntimeJobs => {
            try request.respond("{\"detail\":\"Too many runtime jobs\"}", .{ .status = .service_unavailable, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
            return request.head.keep_alive;
        },
        else => return failure,
    };
    defer allocator.free(response);
    try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn respondBadRuntimeJob(request: *http.Server.Request, detail: []const u8) !bool {
    var buffer: [256]u8 = undefined;
    var output: Io.Writer = .fixed(&buffer);
    try output.writeAll("{\"detail\":");
    try std.json.Stringify.value(detail, .{}, &output);
    try output.writeByte('}');
    try request.respond(output.buffered(), .{ .status = .bad_request, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn runtimeJobOptionalString(object: std.json.ObjectMap, name: []const u8) !?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return error.InvalidRuntimeJobField;
    return value.string;
}

fn runtimeJobBackend(value: []const u8) bool {
    for ([_][]const u8{ "vllm", "sglang", "llamacpp", "mlx", "cuda", "rocm" }) |backend| if (std.mem.eql(u8, value, backend)) return true;
    return false;
}

const ModelMutation = enum { delete, move };

fn serveStudioModelMutation(allocator: std.mem.Allocator, io: Io, studio: *studio_settings.State, request: *http.Server.Request, mutation: ModelMutation) !bool {
    const storage = try allocator.alloc(u8, max_settings_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{
            .status = .payload_too_large,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return false;
    };
    const models_dir = try studio.modelsDirectory(allocator, io);
    defer allocator.free(models_dir);
    try studio.lockFiles(io);
    defer studio.unlockFiles(io);
    const response = switch (mutation) {
        .delete => model_files.deletePayload(allocator, io, models_dir, body_writer.buffered()),
        .move => model_files.movePayload(allocator, io, models_dir, body_writer.buffered()),
    } catch |failure| {
        const known: ?struct { []const u8, http.Status } = switch (failure) {
            error.InvalidPayload => .{ "Invalid JSON body", .bad_request },
            error.PathRequired => .{ "path is required", .bad_request },
            error.MovePathsRequired => .{ "source_path and target_root are required", .bad_request },
            error.PathOutsideModelsDirectory => .{ "path must be inside models_dir", .bad_request },
            error.SourceOutsideModelsDirectory => .{ "source_path must be inside models_dir", .bad_request },
            error.TargetOutsideModelsDirectory => .{ "target_root must be inside models_dir", .bad_request },
            error.ModelPathNotFound => .{ "Model path not found", .not_found },
            error.SourcePathNotFound => .{ "source_path not found", .not_found },
            error.TargetPathExists => .{ "Target path already exists", .bad_request },
            else => null,
        };
        const detail = if (known) |value| value[0] else "Internal Server Error";
        const status = if (known) |value| value[1] else .internal_server_error;
        var output: Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"detail\":");
        try std.json.Stringify.value(detail, .{}, &output.writer);
        try output.writer.writeByte('}');
        try request.respond(output.writer.buffered(), .{ .status = status, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    };
    defer allocator.free(response);
    try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn serveModelIndex(allocator: std.mem.Allocator, configuration: *const Config, cache: *model_index.Cache, request: *http.Server.Request) !bool {
    const response = cache.payload(allocator, configuration.data_dir) catch |failure| {
        const index_path = try model_index.path(allocator, configuration.data_dir);
        defer allocator.free(index_path);
        const detail = switch (failure) {
            error.ModelIndexInvalidJson => try std.fmt.allocPrint(allocator, "Model index at {s} is not valid JSON", .{index_path}),
            error.ModelIndexInvalidSchema => try std.fmt.allocPrint(allocator, "Model index at {s} failed validation", .{index_path}),
            else => try std.fmt.allocPrint(allocator, "Could not read model index at {s}", .{index_path}),
        };
        defer allocator.free(detail);
        var output: Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"detail\":");
        try std.json.Stringify.value(detail, .{}, &output.writer);
        try output.writer.writeByte('}');
        try request.respond(output.writer.buffered(), .{ .status = .internal_server_error, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    };
    defer allocator.free(response);
    try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn serveRuntimeBackend(allocator: std.mem.Allocator, configuration: *const Config, system: *const system_info.Snapshot, cache: *runtime_info.Cache, backend: runtime_routes.Backend, request: *http.Server.Request) !bool {
    const response = try runtime_routes.backendPayload(allocator, configuration, system, cache, backend);
    defer allocator.free(response);
    try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn serveRuntimeConfigHelp(allocator: std.mem.Allocator, io: Io, configuration: *const Config, backend: runtime_routes.Backend, request: *http.Server.Request) !bool {
    const response = try runtime_routes.configHelpPayload(allocator, io, configuration, backend);
    defer allocator.free(response);
    try request.respond(response, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn serveHeadInference(allocator: std.mem.Allocator, io: Io, configuration: *const Config, studio: *studio_settings.State, head_provider_state: *head_providers.State, client: *http.Client, database: *sqlite.Database, worker_pool: *worker_service.Pool, request: *http.Server.Request) !bool {
    var captured = try reverse_proxy.captureRequest(allocator, request);
    defer captured.deinit();
    const storage = try allocator.alloc(u8, max_chat_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{
            .status = .payload_too_large,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return false;
    };
    const body = body_writer.buffered();
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, body, .{}) catch {
        try request.respond("{\"detail\":\"Invalid JSON body\"}", .{
            .status = .bad_request,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    };
    defer parsed.deinit();
    if (parsed.value != .object) return try respondModelRequired(request);
    const model_value = parsed.value.object.get("model") orelse return try respondModelRequired(request);
    if (model_value != .string) return try respondModelRequired(request);
    const requested_model_id = std.mem.trim(u8, model_value.string, " \t\r\n");
    if (requested_model_id.len == 0) return try respondModelRequired(request);
    const runtime_catalog = try headModelCatalogPayload(allocator, io, configuration, studio, head_provider_state, client, database);
    defer allocator.free(runtime_catalog);
    const catalog_route = try resolveCanonicalRoute(allocator, runtime_catalog, &captured, requested_model_id);
    defer if (catalog_route.route) |value| allocator.free(value);
    if (catalog_route.known and catalog_route.route == null) return try respondModelNotRunning(allocator, request, null, requested_model_id);
    const model_id = catalog_route.route orelse requested_model_id;
    var routed_body: ?[]u8 = null;
    defer if (routed_body) |value| allocator.free(value);
    if (!std.mem.eql(u8, model_id, requested_model_id)) routed_body = try provider_routing.rewriteModel(allocator, &parsed, model_id);
    const inference_body = routed_body orelse body;

    const codex_prefix = "openai-codex/";
    if (std.mem.startsWith(u8, model_id, codex_prefix)) {
        if (std.mem.startsWith(u8, captured.target, "/v1/messages")) return respondDownloadError(request, .bad_request, "Anthropic Messages requires an OpenRouter model");
        const upstream_model = model_id[codex_prefix.len..];
        if (!try head_providers.isCodexModel(allocator, upstream_model)) return try respondModelNotRunning(allocator, request, null, model_id);
        var credential = (try head_provider_state.credential(client, "openai-codex")) orelse return respondDownloadError(request, .unauthorized, "OpenAI Codex is not connected on this Head");
        defer credential.deinit();
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        const public_protocol: openai_protocol.Protocol = if (std.mem.startsWith(u8, captured.target, "/v1/responses")) .responses else .chat_completions;
        const sample = codex_gateway.serve(allocator, client, &credential, upstream_model, public_protocol, inference_body, requested_stream, request) catch |failure| {
            std.log.err("Codex gateway failed: {t}", .{failure});
            return false;
        };
        persistInferenceUsage(io, database, model_id, "openai-codex", sample, requested_stream);
        return false;
    }
    const openrouter_prefix = "openrouter/";
    if (std.mem.startsWith(u8, model_id, openrouter_prefix)) {
        const upstream_model = model_id[openrouter_prefix.len..];
        if (!try head_providers.isProviderModel(allocator, "openrouter", upstream_model)) return try respondModelNotRunning(allocator, request, null, model_id);
        var credential = (try head_provider_state.credential(client, "openrouter")) orelse return respondDownloadError(request, .unauthorized, "OpenRouter is not connected on this Head");
        defer credential.deinit();
        const rewritten = try provider_routing.rewriteModel(allocator, &parsed, upstream_model);
        defer allocator.free(rewritten);
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        if (std.mem.startsWith(u8, captured.target, "/v1/messages")) {
            anthropic_gateway.serveOpenRouter(allocator, client, credential.access, rewritten, requested_stream, request) catch return false;
            return false;
        }
        const public_protocol: openai_protocol.Protocol = if (std.mem.startsWith(u8, captured.target, "/v1/responses")) .responses else .chat_completions;
        const sample = provider_gateway.serve(allocator, client, "https://openrouter.ai/api", credential.access, public_protocol, .chat_completions, rewritten, requested_stream, request) catch return false;
        persistInferenceUsage(io, database, model_id, "openrouter", sample, requested_stream);
        return false;
    }
    const cursor_prefix = "cursor/";
    if (std.mem.startsWith(u8, model_id, cursor_prefix)) {
        if (std.mem.startsWith(u8, captured.target, "/v1/messages")) return respondDownloadError(request, .bad_request, "Anthropic Messages requires an OpenRouter model");
        const upstream_model = model_id[cursor_prefix.len..];
        if (!try head_providers.isProviderModel(allocator, "cursor", upstream_model)) return try respondModelNotRunning(allocator, request, null, model_id);
        if (!cursor_gateway.configured(allocator, io, configuration)) return respondDownloadError(request, .unauthorized, "Cursor is not connected on this Head");
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        const public_protocol: openai_protocol.Protocol = if (std.mem.startsWith(u8, captured.target, "/v1/responses")) .responses else .chat_completions;
        const sample = cursor_gateway.serve(allocator, io, configuration, public_protocol, upstream_model, inference_body, requested_stream, request) catch return false;
        persistInferenceUsage(io, database, model_id, "cursor", sample, requested_stream);
        return false;
    }

    var snapshot = try provider_service.loadSnapshot(allocator, io, studio, configuration.data_dir);
    defer snapshot.deinit();
    if (provider_routing.resolve(snapshot.providers, model_id)) |provider_route| {
        const rewritten = try provider_routing.rewriteModel(allocator, &parsed, provider_route.model_id);
        defer allocator.free(rewritten);
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        const public_protocol: openai_protocol.Protocol = if (std.mem.startsWith(u8, captured.target, "/v1/responses")) .responses else .chat_completions;
        const requires_translation = switch (provider_route.provider.protocol) {
            .auto => false,
            .chat_completions => public_protocol != .chat_completions,
            .responses => public_protocol != .responses,
        };
        if (requires_translation) {
            const sample = provider_gateway.serveTranslated(allocator, client, provider_route.provider, public_protocol, rewritten, requested_stream, request) catch return false;
            persistInferenceUsage(io, database, model_id, provider_route.provider.id, sample, requested_stream);
        } else {
            reverse_proxy.serveProviderBuffered(allocator, client, provider_route.provider.base_url, provider_route.provider.api_key, rewritten, &captured, request, if (requested_stream) "text/event-stream" else "application/json", false) catch return false;
        }
        return false;
    }

    if (!worker_pool.tryAcquireInference()) {
        try request.respond("{\"detail\":\"Inference request capacity is exhausted\"}", .{
            .status = .service_unavailable,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return false;
    }
    defer worker_pool.releaseInference();

    var worker = worker_service.selectServing(allocator, io, client, database, worker_pool, model_id, null) catch null orelse {
        return try respondModelNotRunning(allocator, request, null, model_id);
    };
    defer worker.deinit();
    try worker_pool.acquire(io, worker.id);
    reverse_proxy.serveWorkerBuffered(allocator, client, worker.address, worker.api_key, worker.id, inference_body, &captured, request) catch |failure| {
        worker_pool.release(io, worker.id);
        if (failure == error.WorkerStreamFailedAfterCommitment) return false;
        var alternate = worker_service.selectServing(allocator, io, client, database, worker_pool, model_id, worker.id) catch null orelse {
            try request.respond("{\"detail\":\"Worker is unavailable\"}", .{
                .status = .bad_gateway,
                .keep_alive = false,
                .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
            });
            return false;
        };
        defer alternate.deinit();
        try worker_pool.acquire(io, alternate.id);
        reverse_proxy.serveWorkerBuffered(allocator, client, alternate.address, alternate.api_key, alternate.id, inference_body, &captured, request) catch |retry_failure| {
            worker_pool.release(io, alternate.id);
            if (retry_failure == error.WorkerStreamFailedAfterCommitment) return false;
            try request.respond("{\"detail\":\"Worker is unavailable\"}", .{
                .status = .bad_gateway,
                .keep_alive = false,
                .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
            });
            return false;
        };
        worker_pool.release(io, alternate.id);
        return false;
    };
    worker_pool.release(io, worker.id);
    return false;
}

fn serveLocalChat(allocator: std.mem.Allocator, io: Io, configuration: *const Config, studio: *studio_settings.State, head_provider_state: *head_providers.State, client: *http.Client, database: *sqlite.Database, recipe_column: recipes.PayloadColumn, llm_instance_path: []const u8, request: *http.Server.Request, inference_origin: []const u8) !bool {
    var captured = try reverse_proxy.captureRequest(allocator, request);
    defer captured.deinit();
    const storage = try allocator.alloc(u8, max_chat_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{
            .status = .payload_too_large,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return false;
    };
    const body = body_writer.buffered();
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, body, .{}) catch {
        try request.respond("{\"detail\":\"Invalid JSON body\"}", .{
            .status = .bad_request,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    };
    defer parsed.deinit();
    if (parsed.value != .object) {
        try request.respond("{\"detail\":\"Invalid JSON body\"}", .{
            .status = .bad_request,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    }

    const requested_model = if (parsed.value.object.get("model")) |value| if (value == .string) std.mem.trim(u8, value.string, " \t\r\n") else "" else "";
    const runtime_catalog = try localModelCatalogPayload(allocator, io, configuration, studio, head_provider_state, client, database, recipe_column, llm_instance_path);
    defer allocator.free(runtime_catalog);
    const catalog_route = try resolveCanonicalRoute(allocator, runtime_catalog, &captured, requested_model);
    defer if (catalog_route.route) |value| allocator.free(value);
    if (catalog_route.known and catalog_route.route == null) return try respondModelNotRunning(allocator, request, null, requested_model);
    const requested_provider_model = catalog_route.route orelse requested_model;
    var catalog_body: ?[]u8 = null;
    defer if (catalog_body) |value| allocator.free(value);
    if (!std.mem.eql(u8, requested_provider_model, requested_model)) catalog_body = try provider_routing.rewriteModel(allocator, &parsed, requested_provider_model);
    const inference_body = catalog_body orelse body;
    const codex_prefix = "openai-codex/";
    if (std.mem.startsWith(u8, requested_provider_model, codex_prefix)) {
        const upstream_model = requested_provider_model[codex_prefix.len..];
        if (!try head_providers.isCodexModel(allocator, upstream_model)) return try respondModelNotRunning(allocator, request, null, requested_provider_model);
        var credential = (try head_provider_state.credential(client, "openai-codex")) orelse return respondDownloadError(request, .unauthorized, "OpenAI Codex is not connected on this Standalone node");
        defer credential.deinit();
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        const sample = codex_gateway.serve(allocator, client, &credential, upstream_model, .chat_completions, inference_body, requested_stream, request) catch return false;
        persistInferenceUsage(io, database, requested_provider_model, "openai-codex", sample, requested_stream);
        return false;
    }
    const openrouter_prefix = "openrouter/";
    if (std.mem.startsWith(u8, requested_provider_model, openrouter_prefix)) {
        const upstream_model = requested_provider_model[openrouter_prefix.len..];
        if (!try head_providers.isProviderModel(allocator, "openrouter", upstream_model)) return try respondModelNotRunning(allocator, request, null, requested_provider_model);
        var credential = (try head_provider_state.credential(client, "openrouter")) orelse return respondDownloadError(request, .unauthorized, "OpenRouter is not connected on this Standalone node");
        defer credential.deinit();
        const rewritten = try provider_routing.rewriteModel(allocator, &parsed, upstream_model);
        defer allocator.free(rewritten);
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        const sample = provider_gateway.serve(allocator, client, "https://openrouter.ai/api", credential.access, .chat_completions, .chat_completions, rewritten, requested_stream, request) catch return false;
        persistInferenceUsage(io, database, requested_provider_model, "openrouter", sample, requested_stream);
        return false;
    }
    const cursor_prefix = "cursor/";
    if (std.mem.startsWith(u8, requested_provider_model, cursor_prefix)) {
        const upstream_model = requested_provider_model[cursor_prefix.len..];
        if (!try head_providers.isProviderModel(allocator, "cursor", upstream_model)) return try respondModelNotRunning(allocator, request, null, requested_provider_model);
        if (!cursor_gateway.configured(allocator, io, configuration)) return respondDownloadError(request, .unauthorized, "Cursor is not connected on this Standalone node");
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        const sample = cursor_gateway.serve(allocator, io, configuration, .chat_completions, upstream_model, inference_body, requested_stream, request) catch return false;
        persistInferenceUsage(io, database, requested_provider_model, "cursor", sample, requested_stream);
        return false;
    }
    var snapshot = try provider_service.loadSnapshot(allocator, io, studio, configuration.data_dir);
    defer snapshot.deinit();
    if (provider_routing.resolve(snapshot.providers, requested_provider_model)) |provider_route| {
        const rewritten_provider = try provider_routing.rewriteModel(allocator, &parsed, provider_route.model_id);
        defer allocator.free(rewritten_provider);
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        if (provider_route.provider.protocol == .responses) {
            const sample = provider_gateway.serveTranslated(allocator, client, provider_route.provider, .chat_completions, rewritten_provider, requested_stream, request) catch return false;
            persistInferenceUsage(io, database, requested_provider_model, provider_route.provider.id, sample, requested_stream);
        } else {
            reverse_proxy.serveProviderBuffered(allocator, client, provider_route.provider.base_url, provider_route.provider.api_key, rewritten_provider, &captured, request, if (requested_stream) "text/event-stream" else "application/json", false) catch return false;
        }
        return false;
    }

    var rewritten: ?[]u8 = null;
    defer if (rewritten) |payload| allocator.free(payload);
    if (parsed.value.object.get("model")) |model_value| {
        if (model_value == .string) {
            const resolved_model = std.mem.trim(u8, model_value.string, " \t\r\n");
            if (resolved_model.len > 0) {
                var resolution = try model_service.resolveRequestedModel(allocator, io, database, recipe_column, llm_instance_path, resolved_model);
                defer resolution.deinit();
                if (resolution.managed and !resolution.active) return try respondModelNotRunning(allocator, request, resolution.active_model, resolved_model);
                if (resolution.canonical) |canonical| {
                    if (!std.mem.eql(u8, canonical, resolved_model)) {
                        try parsed.value.object.put(parsed.arena.allocator(), "model", .{ .string = canonical });
                        var output: Io.Writer.Allocating = .init(allocator);
                        errdefer output.deinit();
                        try std.json.Stringify.value(parsed.value, .{}, &output.writer);
                        rewritten = try output.toOwnedSlice();
                    }
                }
            }
        }
    }
    reverse_proxy.serveLocalBuffered(client, inference_origin, rewritten orelse inference_body, &captured, request, null) catch return false;
    return false;
}

const LocalProtocol = enum {
    responses,
    messages,
};

fn serveLocalPassthrough(allocator: std.mem.Allocator, io: Io, configuration: *const Config, studio: *studio_settings.State, head_provider_state: *head_providers.State, client: *http.Client, database: *sqlite.Database, recipe_column: recipes.PayloadColumn, llm_instance_path: []const u8, request: *http.Server.Request, inference_origin: []const u8, protocol: LocalProtocol) !bool {
    var captured = try reverse_proxy.captureRequest(allocator, request);
    defer captured.deinit();
    const storage = try allocator.alloc(u8, max_chat_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{
            .status = .payload_too_large,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return false;
    };
    const body = body_writer.buffered();
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, body, .{}) catch return try respondInvalidProtocolBody(request, protocol);
    defer parsed.deinit();
    if (parsed.value != .object) return try respondInvalidProtocolBody(request, protocol);

    const model_value = parsed.value.object.get("model");
    const original_model = if (model_value != null and model_value.? == .string)
        std.mem.trim(u8, model_value.?.string, " \t\r\n")
    else
        "";
    if (protocol == .responses and original_model.len == 0) {
        try request.respond("{\"detail\":\"Responses request requires a model\"}", .{
            .status = .bad_request,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    }
    const runtime_catalog = try localModelCatalogPayload(allocator, io, configuration, studio, head_provider_state, client, database, recipe_column, llm_instance_path);
    defer allocator.free(runtime_catalog);
    const catalog_route = try resolveCanonicalRoute(allocator, runtime_catalog, &captured, original_model);
    defer if (catalog_route.route) |value| allocator.free(value);
    if (catalog_route.known and catalog_route.route == null) return try respondModelNotRunning(allocator, request, null, original_model);
    const requested_model = catalog_route.route orelse original_model;
    var catalog_body: ?[]u8 = null;
    defer if (catalog_body) |value| allocator.free(value);
    if (!std.mem.eql(u8, requested_model, original_model)) catalog_body = try provider_routing.rewriteModel(allocator, &parsed, requested_model);
    const inference_body = catalog_body orelse body;

    const codex_prefix = "openai-codex/";
    if (protocol == .responses and std.mem.startsWith(u8, requested_model, codex_prefix)) {
        const upstream_model = requested_model[codex_prefix.len..];
        if (!try head_providers.isCodexModel(allocator, upstream_model)) return try respondModelNotRunning(allocator, request, null, requested_model);
        var credential = (try head_provider_state.credential(client, "openai-codex")) orelse return respondDownloadError(request, .unauthorized, "OpenAI Codex is not connected on this Standalone node");
        defer credential.deinit();
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        const sample = codex_gateway.serve(allocator, client, &credential, upstream_model, .responses, inference_body, requested_stream, request) catch |failure| {
            std.log.err("Codex gateway failed: {t}", .{failure});
            return false;
        };
        persistInferenceUsage(io, database, requested_model, "openai-codex", sample, requested_stream);
        return false;
    }
    const openrouter_prefix = "openrouter/";
    if (protocol == .responses and std.mem.startsWith(u8, requested_model, openrouter_prefix)) {
        const upstream_model = requested_model[openrouter_prefix.len..];
        if (!try head_providers.isProviderModel(allocator, "openrouter", upstream_model)) return try respondModelNotRunning(allocator, request, null, requested_model);
        var credential = (try head_provider_state.credential(client, "openrouter")) orelse return respondDownloadError(request, .unauthorized, "OpenRouter is not connected on this Standalone node");
        defer credential.deinit();
        const rewritten_provider = try provider_routing.rewriteModel(allocator, &parsed, upstream_model);
        defer allocator.free(rewritten_provider);
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        const sample = provider_gateway.serve(allocator, client, "https://openrouter.ai/api", credential.access, .responses, .chat_completions, rewritten_provider, requested_stream, request) catch return false;
        persistInferenceUsage(io, database, requested_model, "openrouter", sample, requested_stream);
        return false;
    }
    const cursor_prefix = "cursor/";
    if (protocol == .responses and std.mem.startsWith(u8, requested_model, cursor_prefix)) {
        const upstream_model = requested_model[cursor_prefix.len..];
        if (!try head_providers.isProviderModel(allocator, "cursor", upstream_model)) return try respondModelNotRunning(allocator, request, null, requested_model);
        if (!cursor_gateway.configured(allocator, io, configuration)) return respondDownloadError(request, .unauthorized, "Cursor is not connected on this Standalone node");
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        const sample = cursor_gateway.serve(allocator, io, configuration, .responses, upstream_model, inference_body, requested_stream, request) catch return false;
        persistInferenceUsage(io, database, requested_model, "cursor", sample, requested_stream);
        return false;
    }

    var snapshot = try provider_service.loadSnapshot(allocator, io, studio, configuration.data_dir);
    defer snapshot.deinit();
    if (provider_routing.resolve(snapshot.providers, requested_model)) |provider_route| {
        const rewritten_provider = try provider_routing.rewriteModel(allocator, &parsed, provider_route.model_id);
        defer allocator.free(rewritten_provider);
        const requested_stream = if (parsed.value.object.get("stream")) |stream_value| stream_value == .bool and stream_value.bool else false;
        if (protocol == .responses and provider_route.provider.protocol == .chat_completions) {
            const sample = provider_gateway.serveTranslated(allocator, client, provider_route.provider, .responses, rewritten_provider, requested_stream, request) catch return false;
            persistInferenceUsage(io, database, requested_model, provider_route.provider.id, sample, requested_stream);
        } else {
            reverse_proxy.serveProviderBuffered(allocator, client, provider_route.provider.base_url, provider_route.provider.api_key, rewritten_provider, &captured, request, if (requested_stream) "text/event-stream" else "application/json", protocol == .messages) catch return false;
        }
        return false;
    }

    var rewritten: ?[]u8 = null;
    defer if (rewritten) |payload| allocator.free(payload);
    if (requested_model.len > 0) {
        var resolution = try model_service.resolveRequestedModel(allocator, io, database, recipe_column, llm_instance_path, requested_model);
        defer resolution.deinit();
        if (resolution.canonical) |canonical| {
            if (!std.mem.eql(u8, canonical, requested_model)) {
                try parsed.value.object.put(parsed.arena.allocator(), "model", .{ .string = canonical });
                var output: Io.Writer.Allocating = .init(allocator);
                errdefer output.deinit();
                try std.json.Stringify.value(parsed.value, .{}, &output.writer);
                rewritten = try output.toOwnedSlice();
            }
        }
    }
    const accept: ?[]const u8 = if (protocol == .responses)
        if (parsed.value.object.get("stream")) |stream_value| if (stream_value == .bool and stream_value.bool) "text/event-stream" else "application/json" else "application/json"
    else
        null;
    reverse_proxy.serveLocalBuffered(client, inference_origin, rewritten orelse inference_body, &captured, request, accept) catch return false;
    return false;
}

fn respondInvalidProtocolBody(request: *http.Server.Request, protocol: LocalProtocol) !bool {
    const body = switch (protocol) {
        .responses => "{\"detail\":\"Invalid Responses request body\"}",
        .messages => "{\"detail\":\"Invalid JSON request body\"}",
    };
    try request.respond(body, .{
        .status = .bad_request,
        .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
    });
    return request.head.keep_alive;
}

fn persistInferenceUsage(io: Io, database: *sqlite.Database, model: []const u8, provider: []const u8, sample: ?inference_usage.Sample, streamed: bool) void {
    const value = sample orelse return;
    inference_usage.record(database, io, model, "provider", provider, null, value, null, 200, streamed) catch |failure| {
        std.log.err("inference usage record failed: {t}", .{failure});
    };
}

const TokenizationProtocol = enum {
    count,
    chat,
};

fn serveTokenization(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, recipe_column: recipes.PayloadColumn, llm_instance_path: []const u8, request: *http.Server.Request, inference_origin: []const u8, protocol: TokenizationProtocol) !bool {
    const storage = try allocator.alloc(u8, max_chat_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{
            .status = .payload_too_large,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return false;
    };
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, body_writer.buffered(), .{}) catch return try respondInvalidPayload(request);
    defer parsed.deinit();
    if (parsed.value != .object) return try respondInvalidPayload(request);
    const valid = switch (protocol) {
        .count => tokenization_service.validCountRequest(parsed.value.object),
        .chat => tokenization_service.validChatRequest(parsed.value.object),
    };
    if (!valid) return try respondInvalidPayload(request);

    const active_model = try model_service.activeModelId(allocator, io, database, recipe_column, llm_instance_path) orelse {
        const empty = switch (protocol) {
            .count => "{\"error\":\"No model running\",\"num_tokens\":0}",
            .chat => "{\"error\":\"No model running\",\"input_tokens\":0}",
        };
        try request.respond(empty, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
        return request.head.keep_alive;
    };
    defer allocator.free(active_model);
    const payload = switch (protocol) {
        .count => try tokenization_service.countPayload(allocator, client, inference_origin, active_model, parsed.value.object),
        .chat => try tokenization_service.chatPayload(allocator, client, inference_origin, active_model, parsed.value.object),
    };
    defer allocator.free(payload);
    try request.respond(payload, .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn respondInvalidPayload(request: *http.Server.Request) !bool {
    try request.respond("{\"detail\":\"Invalid payload\"}", .{
        .status = .bad_request,
        .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
    });
    return request.head.keep_alive;
}

fn respondLifecycleFailure(request: *http.Server.Request, failure: anyerror) !bool {
    const status: http.Status = switch (failure) {
        error.RecipeNotFound => .not_found,
        error.AlreadyRunning, error.PortInUse => .conflict,
        error.UnsupportedBackend, error.UnsupportedPlatform, error.DockerRuntimeNotImplemented => .unprocessable_entity,
        error.LaunchCancelled => .bad_request,
        else => .service_unavailable,
    };
    const detail = switch (failure) {
        error.RecipeNotFound => "Recipe not found",
        error.AlreadyRunning => "llm is already running",
        error.PortInUse => "inference port is already in use",
        error.UnsupportedBackend => "Engine backend is not supported",
        error.UnsupportedPlatform => "Engine cannot run on this host",
        error.DockerRuntimeNotImplemented => "Docker runtime is not available",
        error.LaunchCancelled => "launch cancelled",
        error.ProcessExitedEarly => "process exited before becoming healthy",
        error.ReadinessTimeout => "process did not become healthy before its deadline",
        else => @errorName(failure),
    };
    var buffer: [256]u8 = undefined;
    var output: Io.Writer = .fixed(&buffer);
    try output.writeAll("{\"detail\":");
    try std.json.Stringify.value(detail, .{}, &output);
    try output.writeByte('}');
    try request.respond(output.buffered(), .{ .status = status, .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn saveRecipe(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, recipe_column: recipes.PayloadColumn, request: *http.Server.Request, override_id: ?[]const u8, default_trust_remote_code: bool) !bool {
    const storage = try allocator.alloc(u8, max_chat_request_bytes);
    defer allocator.free(storage);
    var body_writer: Io.Writer = .fixed(storage);
    var request_read_buffer: [16 * 1024]u8 = undefined;
    const body_reader = try request.readerExpectContinue(&request_read_buffer);
    _ = body_reader.streamRemaining(&body_writer) catch {
        try request.respond("{\"detail\":\"Request body is too large\"}", .{
            .status = .payload_too_large,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return false;
    };
    const id = recipe_service.savePayload(allocator, io, database, recipe_column, body_writer.buffered(), override_id, default_trust_remote_code) catch |failure| {
        var output: Io.Writer.Allocating = .init(allocator);
        defer output.deinit();
        try output.writer.writeAll("{\"detail\":");
        try std.json.Stringify.value(@errorName(failure), .{}, &output.writer);
        try output.writer.writeByte('}');
        try request.respond(output.writer.buffered(), .{
            .status = .bad_request,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    };
    defer allocator.free(id);
    var output: Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"success\":true,\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeByte('}');
    try request.respond(output.writer.buffered(), .{ .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }} });
    return request.head.keep_alive;
}

fn respondModelRequired(request: *http.Server.Request) !bool {
    try request.respond("{\"detail\":\"model is required\"}", .{
        .status = .bad_request,
        .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
    });
    return request.head.keep_alive;
}

fn respondModelNotRunning(allocator: std.mem.Allocator, request: *http.Server.Request, active_model: ?[]const u8, model_id: []const u8) !bool {
    const message = if (active_model) |active|
        try std.fmt.allocPrint(allocator, "Model {s} is running; {s} is not. Launch it from the frontend before sending requests.", .{ active, model_id })
    else
        try std.fmt.allocPrint(allocator, "No model is running. Launch {s} from the frontend before sending requests.", .{model_id});
    defer allocator.free(message);
    var output: Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"error\":{\"message\":");
    try std.json.Stringify.value(message, .{}, &output.writer);
    try output.writer.writeAll(",\"type\":\"model_not_running\",\"code\":\"model_not_running\"},\"detail\":");
    try std.json.Stringify.value(message, .{}, &output.writer);
    try output.writer.writeByte('}');
    try request.respond(output.writer.buffered(), .{
        .status = .service_unavailable,
        .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
    });
    return request.head.keep_alive;
}

fn serveWorkerProxy(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, request: *http.Server.Request) !bool {
    if (request_tools.header(request, "X-Local-Studio-Federation-Hop") != null) {
        try request.respond("{\"detail\":\"Federation loop rejected\"}", .{
            .status = .loop_detected,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    }
    const worker_id = request_tools.header(request, "X-Local-Studio-Worker-Id") orelse {
        try request.respond("{\"detail\":\"Select a Worker before using this controller endpoint\"}", .{
            .status = .conflict,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    };
    const normalized_worker_id = std.mem.trim(u8, worker_id, " \t");
    if (normalized_worker_id.len == 0) {
        try request.respond("{\"detail\":\"Select a Worker before using this controller endpoint\"}", .{
            .status = .conflict,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    }
    var target = worker_service.findTarget(allocator, io, database, normalized_worker_id) catch {
        try request.respond("{\"detail\":\"Worker configuration unavailable\"}", .{
            .status = .internal_server_error,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    } orelse {
        try request.respond("{\"detail\":\"Selected Worker was not found\"}", .{
            .status = .not_found,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return request.head.keep_alive;
    };
    defer target.deinit();
    try reverse_proxy.serveWorker(allocator, client, target.address, target.api_key, target.id, request);
    return false;
}

fn serveSse(io: Io, request: *http.Server.Request) !void {
    var stream_buffer: [4096]u8 = undefined;
    var body = try request.respondStreaming(&stream_buffer, .{
        .respond_options = .{
            .keep_alive = false,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "text/event-stream" },
                .{ .name = "Cache-Control", .value = "no-cache, no-transform" },
                .{ .name = "X-Accel-Buffering", .value = "no" },
            },
        },
    });

    var sequence: u64 = 0;
    while (true) : (sequence += 1) {
        try body.writer.print("id: {d}\nevent: spike\ndata: {{\"sequence\":{d}}}\n\n", .{ sequence, sequence });
        try body.writer.flush();
        try body.flush();
        try io.sleep(.fromSeconds(1), .awake);
    }
}

fn serveControllerEvents(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, recipe_column: recipes.PayloadColumn, configuration: *const Config, studio: *studio_settings.State, default_trust_remote_code: bool, system: *const system_info.Snapshot, supervisor: *lifecycle.Supervisor, runtime_cache: *runtime_info.Cache, request: *http.Server.Request) !void {
    var stream_buffer: [16 * 1024]u8 = undefined;
    var body = try request.respondStreaming(&stream_buffer, .{
        .respond_options = .{
            .keep_alive = false,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "text/event-stream" },
                .{ .name = "Cache-Control", .value = "no-cache, no-transform" },
                .{ .name = "X-Accel-Buffering", .value = "no" },
            },
        },
    });
    var sequence: u64 = 0;
    var runtime_at: ?Io.Timestamp = null;
    while (true) {
        const status = try supervisor.statusPayload(database, recipe_column, configuration.inference_port, default_trust_remote_code);
        defer allocator.free(status);
        try writeControllerEvent(io, &body, "status", status, &sequence);

        const gpu = try telemetry.gpuPayload(allocator, io, system);
        defer allocator.free(gpu);
        try writeControllerEvent(io, &body, "gpu", gpu, &sequence);

        const current_metrics = try metrics.payload(allocator, io, client, database, recipe_column, configuration.inference_port, default_trust_remote_code, system, supervisor);
        defer allocator.free(current_metrics);
        try writeControllerEvent(io, &body, "metrics", current_metrics, &sequence);

        const now = Io.Clock.awake.now(io);
        if (runtime_at == null or runtime_at.?.durationTo(now).toSeconds() >= 30) {
            const models_dir = try studio.modelsDirectory(allocator, io);
            defer allocator.free(models_dir);
            const runtime = try system_service.runtimeSummaryPayload(allocator, io, configuration, models_dir, system, supervisor, runtime_cache, database, recipe_column, default_trust_remote_code);
            defer allocator.free(runtime);
            try writeControllerEvent(io, &body, "runtime_summary", runtime, &sequence);
            runtime_at = now;
        }
        try io.sleep(.fromSeconds(5), .awake);
    }
}

fn serveSessionListChanged(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, request: *http.Server.Request) !void {
    var stream_buffer: [4096]u8 = undefined;
    var body = try request.respondStreaming(&stream_buffer, .{
        .respond_options = .{
            .keep_alive = false,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "text/event-stream; charset=utf-8" },
                .{ .name = "Cache-Control", .value = "no-cache, no-transform" },
                .{ .name = "X-Accel-Buffering", .value = "no" },
            },
        },
    });
    var current = try agent_sessions.fingerprint(allocator, io, database);
    var current_generation = session_change.current();
    var version: u64 = 0;
    var heartbeat: usize = 0;
    try body.writer.writeAll(": connected v0\n\n");
    try body.writer.flush();
    try body.flush();
    while (true) {
        try io.sleep(.fromMilliseconds(25), .awake);
        heartbeat += 1;
        const next_generation = session_change.current();
        if (next_generation != current_generation) {
            current_generation = next_generation;
            current = try agent_sessions.fingerprint(allocator, io, database);
            version += 1;
            heartbeat = 0;
            try body.writer.print("data: {{\"type\":\"session_list_changed\",\"version\":{d}}}\n\n", .{version});
            try body.writer.flush();
            try body.flush();
        } else if (heartbeat >= 200) {
            heartbeat = 0;
            const next = try agent_sessions.fingerprint(allocator, io, database);
            if (next != current) {
                current = next;
                version += 1;
                try body.writer.print("data: {{\"type\":\"session_list_changed\",\"version\":{d}}}\n\n", .{version});
                try body.writer.flush();
                try body.flush();
            } else {
                try body.writer.writeAll(": keep-alive\n\n");
                try body.writer.flush();
                try body.flush();
            }
        }
    }
}

fn serveWorkbenchEvents(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, view_id: []const u8, request: *http.Server.Request) !void {
    var stream_buffer: [4096]u8 = undefined;
    var body = try request.respondStreaming(&stream_buffer, .{
        .respond_options = .{
            .keep_alive = false,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "text/event-stream; charset=utf-8" },
                .{ .name = "Cache-Control", .value = "no-cache, no-transform" },
                .{ .name = "X-Accel-Buffering", .value = "no" },
            },
        },
    });
    var current_generation = workbench.generation();
    var heartbeat: usize = 0;
    const initial = try workbench.eventPayload(allocator, io, database, view_id);
    defer allocator.free(initial);
    try body.writer.writeAll("event: workbench\ndata: ");
    try body.writer.writeAll(initial);
    try body.writer.writeAll("\n\n");
    try body.writer.flush();
    try body.flush();
    while (true) {
        try io.sleep(.fromMilliseconds(25), .awake);
        heartbeat += 1;
        const next_generation = workbench.generation();
        if (next_generation != current_generation) {
            current_generation = next_generation;
            heartbeat = 0;
            const event = try workbench.eventPayload(allocator, io, database, view_id);
            defer allocator.free(event);
            try body.writer.writeAll("event: workbench\ndata: ");
            try body.writer.writeAll(event);
            try body.writer.writeAll("\n\n");
            try body.writer.flush();
            try body.flush();
        } else if (heartbeat >= 1200) {
            heartbeat = 0;
            try body.writer.writeAll(": keep-alive\n\n");
            try body.writer.flush();
            try body.flush();
        }
    }
}

fn writeControllerEvent(io: Io, body: anytype, event_type: []const u8, data: []const u8, sequence: *u64) !void {
    var timestamp_buffer: [24]u8 = undefined;
    const timestamp = eventTimestamp(io, &timestamp_buffer);
    try body.writer.print("id: {d}\nevent: {s}\ndata: {{\"data\":", .{ sequence.*, event_type });
    try body.writer.writeAll(data);
    try body.writer.writeAll(",\"timestamp\":");
    try std.json.Stringify.value(timestamp, .{}, &body.writer);
    try body.writer.writeAll("}\n\n");
    try body.writer.flush();
    try body.flush();
    sequence.* += 1;
}

fn serveLogStream(allocator: std.mem.Allocator, io: Io, configuration: *const Config, session_id: []const u8, log_path: []const u8, replay_limit: usize, request: *http.Server.Request) !void {
    var stream_buffer: [16 * 1024]u8 = undefined;
    var body = try request.respondStreaming(&stream_buffer, .{
        .respond_options = .{
            .keep_alive = false,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "text/event-stream" },
                .{ .name = "Cache-Control", .value = "no-cache, no-transform" },
                .{ .name = "X-Accel-Buffering", .value = "no" },
            },
        },
    });
    var sequence: u64 = 0;
    if (replay_limit > 0) {
        const replay_document = try logs.tailPayload(allocator, io, configuration, session_id, replay_limit) orelse return;
        defer allocator.free(replay_document);
        var replay = std.json.parseFromSlice(std.json.Value, allocator, replay_document, .{}) catch return error.InvalidLogPayload;
        defer replay.deinit();
        if (replay.value == .object) {
            if (replay.value.object.get("logs")) |lines| if (lines == .array) {
                for (lines.array.items) |line| if (line == .string) try writeLogEvent(allocator, io, &body, session_id, line.string, false, &sequence);
            };
        }
    }
    var stat = try std.Io.Dir.cwd().statFile(io, log_path, .{});
    var offset = stat.size;
    var pending: std.ArrayList(u8) = .empty;
    defer pending.deinit(allocator);
    var heartbeat_ticks: usize = 0;
    while (true) {
        try io.sleep(.fromMilliseconds(500), .awake);
        heartbeat_ticks += 1;
        stat = std.Io.Dir.cwd().statFile(io, log_path, .{}) catch {
            if (heartbeat_ticks >= 30) {
                try body.writer.writeAll(": keep-alive\n\n");
                try body.writer.flush();
                try body.flush();
                heartbeat_ticks = 0;
            }
            continue;
        };
        if (stat.size < offset) {
            offset = 0;
            pending.clearRetainingCapacity();
        }
        if (stat.size == offset) {
            if (heartbeat_ticks >= 30) {
                try body.writer.writeAll(": keep-alive\n\n");
                try body.writer.flush();
                try body.flush();
                heartbeat_ticks = 0;
            }
            continue;
        }
        const maximum_chunk: u64 = 1024 * 1024;
        var read_offset = offset;
        var drop_prefix = false;
        if (stat.size - offset > maximum_chunk) {
            read_offset = stat.size - maximum_chunk;
            drop_prefix = true;
            pending.clearRetainingCapacity();
        }
        const read_length: usize = @intCast(stat.size - read_offset);
        const storage = try allocator.alloc(u8, read_length);
        defer allocator.free(storage);
        var file = try std.Io.Dir.cwd().openFile(io, log_path, .{});
        defer file.close(io);
        const bytes_read = try file.readPositionalAll(io, storage, read_offset);
        offset = read_offset + bytes_read;
        var bytes = storage[0..bytes_read];
        if (drop_prefix) {
            const newline = std.mem.indexOfScalar(u8, bytes, '\n') orelse bytes.len;
            bytes = if (newline < bytes.len) bytes[newline + 1 ..] else bytes[bytes.len..];
        }
        try pending.appendSlice(allocator, bytes);
        var consumed: usize = 0;
        while (std.mem.indexOfScalarPos(u8, pending.items, consumed, '\n')) |newline| {
            const line = std.mem.trimEnd(u8, pending.items[consumed..newline], "\r");
            try writeLogEvent(allocator, io, &body, session_id, line, true, &sequence);
            consumed = newline + 1;
        }
        if (consumed > 0) {
            const remaining = pending.items[consumed..];
            std.mem.copyForwards(u8, pending.items[0..remaining.len], remaining);
            pending.items.len = remaining.len;
        }
        if (pending.items.len > maximum_chunk) pending.clearRetainingCapacity();
        heartbeat_ticks = 0;
    }
}

fn writeLogEvent(allocator: std.mem.Allocator, io: Io, body: anytype, session_id: []const u8, line: []const u8, redact_line: bool, sequence: *u64) !void {
    const safe_line = if (redact_line) try logs.redact(allocator, line) else try allocator.dupe(u8, line);
    defer allocator.free(safe_line);
    const Data = struct {
        session_id: []const u8,
        line: []const u8,
    };
    var output: Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try std.json.Stringify.value(Data{ .session_id = session_id, .line = safe_line }, .{}, &output.writer);
    try writeControllerEvent(io, body, "log", output.writer.buffered(), sequence);
}

fn eventTimestamp(io: Io, buffer: *[24]u8) []const u8 {
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

fn connectorIdFromDocument(allocator: std.mem.Allocator, document: []const u8) !?[]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidConnectorRecord;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidConnectorRecord;
    const value = parsed.value.object.get("id") orelse return null;
    if (value != .string) return error.InvalidConnectorRecord;
    const id = std.mem.trim(u8, value.string, " \t\r\n");
    return if (id.len == 0) null else try allocator.dupe(u8, id);
}
