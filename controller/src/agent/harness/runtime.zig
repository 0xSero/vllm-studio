const std = @import("std");
const config_module = @import("../../app/config.zig");
const harness_catalog = @import("catalog.zig");
const harness_events = @import("events.zig");
const pi_model_route = @import("pi_model_route.zig");
const harness_session_id = @import("session_id.zig");
const runtime_limits = @import("../runtime/limits.zig");
const runtime_window = @import("../runtime/window.zig");
const chat_runtime = @import("../../chat/runtime.zig");
const fx_gateway = @import("../../providers/fx_gateway.zig");

const Io = std.Io;
const Harness = enum {
    pi,
    chat,
    fx,
    opencode,
    codex,
    claude,

    fn name(harness: Harness) []const u8 {
        return @tagName(harness);
    }
};
const LoggedEvent = struct {
    allocator: std.mem.Allocator,
    seq: u64,
    document: []u8,
    timestamp: [24]u8,

    fn deinit(event: *LoggedEvent) void {
        event.allocator.free(event.document);
        event.* = undefined;
    }
};
const EventWindow = runtime_window.Window(LoggedEvent);
const Session = struct {
    allocator: std.mem.Allocator,
    harness: Harness,
    id: []u8,
    native_id: []u8,
    harness_version: ?[]u8,
    model_id: []u8,
    cwd: []u8,
    session_dir: []u8,
    child: ?std.process.Child = null,
    chat: ?chat_runtime.Runtime = null,
    running: bool = true,
    active: bool = false,
    event_seq: u64 = 0,
    last_error: ?[]u8 = null,
    events: EventWindow = .{ .maximum = runtime_limits.harness_events },
    responses: std.StringHashMapUnmanaged([]u8) = .empty,
    active_request_id: ?[]u8 = null,
    retry_count: u8 = 0,
    continuation_count: u8 = 0,
    waiting_for_children: bool = false,
    resume_scheduled: bool = false,
    pending_subagents: std.StringHashMapUnmanaged(void) = .empty,

    fn deinit(session: *Session, io: Io) void {
        if (session.child) |*child| if (child.id != null) child.kill(io);
        if (session.chat) |*chat| chat.deinit();
        session.allocator.free(session.id);
        session.allocator.free(session.native_id);
        if (session.harness_version) |value| session.allocator.free(value);
        session.allocator.free(session.model_id);
        session.allocator.free(session.cwd);
        session.allocator.free(session.session_dir);
        if (session.last_error) |value| session.allocator.free(value);
        session.events.deinit(session.allocator, LoggedEvent.deinit);
        var response_iterator = session.responses.iterator();
        while (response_iterator.next()) |entry| {
            session.allocator.free(entry.key_ptr.*);
            session.allocator.free(entry.value_ptr.*);
        }
        session.responses.deinit(session.allocator);
        if (session.active_request_id) |value| session.allocator.free(value);
        var subagent_iterator = session.pending_subagents.keyIterator();
        while (subagent_iterator.next()) |key| session.allocator.free(key.*);
        session.pending_subagents.deinit(session.allocator);
        session.allocator.destroy(session);
    }
};
pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    mode: config_module.Mode,
    data_dir: []u8,
    controller_origin: []u8,
    controller_api_key: ?[]u8,
    pi: harness_catalog.Installation,
    codex: harness_catalog.Installation,
    fx: harness_catalog.Installation,
    opencode: harness_catalog.Installation,
    claude: harness_catalog.Installation,
    model_route: pi_model_route.Config,
    mutex: Io.Mutex = .init,
    tasks: Io.Group = .init,
    sessions: std.StringHashMapUnmanaged(*Session) = .empty,
    pub fn init(allocator: std.mem.Allocator, io: Io, configuration: *const config_module.Config) !Manager {
        var model_route = try pi_model_route.Config.init(allocator, io, configuration);
        errdefer model_route.deinit();
        var pi = try harness_catalog.discoverPi(allocator, io, configuration);
        errdefer pi.deinit();
        var codex = try harness_catalog.discoverCodex(allocator, io, configuration);
        errdefer codex.deinit();
        var fx = try harness_catalog.discoverFx(allocator, io, configuration);
        errdefer fx.deinit();
        var opencode = try harness_catalog.discoverOpenCode(allocator, io, configuration);
        errdefer opencode.deinit();
        var claude = try harness_catalog.discoverClaude(allocator, io, configuration);
        errdefer claude.deinit();
        const data_dir = try allocator.dupe(u8, configuration.data_dir);
        errdefer allocator.free(data_dir);
        const controller_origin = try std.fmt.allocPrint(allocator, "http://127.0.0.1:{d}", .{configuration.port});
        errdefer allocator.free(controller_origin);
        const controller_api_key = if (configuration.api_key) |value| try allocator.dupe(u8, value) else null;
        errdefer if (controller_api_key) |value| allocator.free(value);
        return .{
            .allocator = allocator,
            .io = io,
            .mode = configuration.mode,
            .data_dir = data_dir,
            .controller_origin = controller_origin,
            .controller_api_key = controller_api_key,
            .pi = pi,
            .codex = codex,
            .fx = fx,
            .opencode = opencode,
            .claude = claude,
            .model_route = model_route,
        };
    }
    pub fn deinit(manager: *Manager) void {
        manager.tasks.cancel(manager.io);
        var iterator = manager.sessions.valueIterator();
        while (iterator.next()) |session| session.*.deinit(manager.io);
        manager.sessions.deinit(manager.allocator);
        manager.allocator.free(manager.data_dir);
        manager.allocator.free(manager.controller_origin);
        if (manager.controller_api_key) |value| manager.allocator.free(value);
        manager.pi.deinit();
        manager.codex.deinit();
        manager.fx.deinit();
        manager.opencode.deinit();
        manager.claude.deinit();
        manager.model_route.deinit();
        manager.* = undefined;
    }
    pub fn setupPayload(manager: *Manager) ![]u8 {
        const available = manager.piIsAvailable();
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"checks\":[{\"id\":\"pi-rpc\",\"label\":\"Pi RPC harness\",\"ok\":");
        try output.writer.print("{},\"value\":", .{available});
        try std.json.Stringify.value(manager.pi.executable, .{}, &output.writer);
        try output.writer.writeAll(",\"guidance\":\"Install Pi and configure LOCAL_STUDIO_HEAD_URL plus LOCAL_STUDIO_HEAD_API_KEY on an enrolled harness node.\"}],\"diagnostics\":[]}");
        return output.toOwnedSlice();
    }
    pub fn piIsAvailable(manager: *Manager) bool {
        return manager.pi.available() and manager.model_route.available();
    }
    pub fn piVersion(manager: *const Manager) ?[]const u8 {
        return manager.pi.version;
    }
    pub fn codexIsAvailable(manager: *const Manager) bool {
        return manager.codex.available();
    }
    pub fn codexVersion(manager: *const Manager) ?[]const u8 {
        return manager.codex.version;
    }
    pub fn codexSource(manager: *const Manager) []const u8 {
        return manager.codex.source;
    }
    pub fn fxIsAvailable(manager: *const Manager) bool {
        return manager.fx.available();
    }
    pub fn fxVersion(manager: *const Manager) ?[]const u8 {
        return manager.fx.version;
    }
    pub fn fxSource(manager: *const Manager) []const u8 {
        return manager.fx.source;
    }
    pub fn opencodeIsAvailable(manager: *const Manager) bool {
        return manager.opencode.available();
    }
    pub fn opencodeVersion(manager: *const Manager) ?[]const u8 {
        return manager.opencode.version;
    }
    pub fn opencodeSource(manager: *const Manager) []const u8 {
        return manager.opencode.source;
    }
    pub fn claudeIsAvailable(manager: *const Manager) bool {
        return manager.claude.available();
    }
    pub fn claudeVersion(manager: *const Manager) ?[]const u8 {
        return manager.claude.version;
    }
    pub fn claudeSource(manager: *const Manager) []const u8 {
        return manager.claude.source;
    }
    pub fn piSource(manager: *const Manager) []const u8 {
        return manager.pi.source;
    }
    pub fn catalogPayload(manager: *Manager) ![]u8 {
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try harness_catalog.writeCatalog(&output.writer, &manager.pi, &manager.codex, &manager.fx, &manager.opencode, &manager.claude);
        return output.toOwnedSlice();
    }

    pub fn serveFxGateway(manager: *Manager, client: *std.http.Client, model_id: []const u8, payload: []const u8, request: *std.http.Server.Request) !void {
        var route = try manager.model_route.prepare(model_id);
        defer route.deinit();
        const api_key = route.environment.get("LOCAL_STUDIO_HEAD_API_KEY") orelse return error.HeadCredentialRequired;
        try fx_gateway.serve(manager.allocator, client, route.base_url, api_key, model_id, payload, request);
    }
    pub fn sessionsPayload(manager: *Manager) ![]u8 {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"sessions\":[");
        var iterator = manager.sessions.iterator();
        var wrote = false;
        while (iterator.next()) |entry| {
            if (wrote) try output.writer.writeByte(',');
            try output.writer.writeAll("{\"sessionId\":");
            try std.json.Stringify.value(entry.key_ptr.*, .{}, &output.writer);
            try output.writer.writeAll(",\"status\":");
            try writeStatus(&output.writer, entry.value_ptr.*);
            try output.writer.writeByte('}');
            wrote = true;
        }
        try output.writer.writeAll("]}");
        return output.toOwnedSlice();
    }

    pub fn statusPayload(manager: *Manager, session_id: []const u8, after: u64) ![]u8 {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"sessionId\":");
        try std.json.Stringify.value(session_id, .{}, &output.writer);
        const session = manager.sessions.get(session_id);
        try output.writer.writeAll(",\"status\":");
        if (session) |value| try writeStatus(&output.writer, value) else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"events\":[");
        if (session) |value| try writeEvents(&output.writer, value, after);
        try output.writer.writeAll("]}");
        return output.toOwnedSlice();
    }

    pub fn transcriptPayload(manager: *Manager, session_id: []const u8, native_session_id: ?[]const u8, since: ?[]const u8) ![]u8 {
        if (!harness_session_id.validRuntime(session_id)) return error.InvalidSessionId;
        if (since) |entry_id| if (!validEntryId(entry_id)) return error.InvalidTranscriptCursor;
        try manager.mutex.lock(manager.io);
        const active_session = manager.sessions.get(session_id);
        manager.mutex.unlock(manager.io);
        if (active_session == null) {
            const native_id = native_session_id orelse return error.NativeSessionIdRequired;
            if (!harness_session_id.validNative(native_id)) return error.InvalidNativeSessionId;
            const acknowledgement = try manager.readPersistedTranscript(native_id, since);
            defer manager.allocator.free(acknowledgement);
            return manager.transcriptEnvelope(session_id, native_id, acknowledgement);
        }
        const session = active_session.?;
        if (session.harness != .pi) return manager.eventTranscriptEnvelope(session_id, session);
        var command: Io.Writer.Allocating = .init(manager.allocator);
        defer command.deinit();
        const command_id = manager.commandId();
        try command.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(command_id[0..], .{}, &command.writer);
        try command.writer.writeAll(",\"type\":\"get_entries\"");
        if (since) |entry_id| {
            try command.writer.writeAll(",\"since\":");
            try std.json.Stringify.value(entry_id, .{}, &command.writer);
        }
        try command.writer.writeByte('}');
        const acknowledgement = try manager.sendCommand(session, command_id[0..], command.writer.buffered());
        defer manager.allocator.free(acknowledgement);
        return manager.transcriptEnvelope(session_id, session.native_id, acknowledgement);
    }

    fn eventTranscriptEnvelope(manager: *Manager, session_id: []const u8, session: *Session) ![]u8 {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"sessionId\":");
        try std.json.Stringify.value(session_id, .{}, &output.writer);
        try output.writer.writeAll(",\"harness\":");
        try std.json.Stringify.value(session.harness.name(), .{}, &output.writer);
        try output.writer.writeAll(",\"nativeSessionId\":");
        try std.json.Stringify.value(session.native_id, .{}, &output.writer);
        try output.writer.writeAll(",\"entries\":[");
        for (session.events.values(), 0..) |event, index| {
            if (index > 0) try output.writer.writeByte(',');
            if (session.harness == .codex)
                try harness_events.writeCanonical(manager.allocator, &output.writer, "codex", event.document)
            else
                try output.writer.writeAll(event.document);
        }
        try output.writer.writeAll("],\"leafId\":");
        if (session.events.values().len > 0) try output.writer.print("\"{d}\"", .{session.event_seq}) else try output.writer.writeAll("null");
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    fn transcriptEnvelope(manager: *Manager, session_id: []const u8, native_id: []const u8, acknowledgement: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, acknowledgement, .{}) catch return error.InvalidHarnessResponse;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidHarnessResponse;
        const data = parsed.value.object.get("data") orelse return error.InvalidHarnessResponse;
        if (data != .object) return error.InvalidHarnessResponse;
        const entries = data.object.get("entries") orelse return error.InvalidHarnessResponse;
        if (entries != .array) return error.InvalidHarnessResponse;
        const leaf_id = data.object.get("leafId") orelse .null;
        if (leaf_id != .null and leaf_id != .string) return error.InvalidHarnessResponse;
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"sessionId\":");
        try std.json.Stringify.value(session_id, .{}, &output.writer);
        try output.writer.writeAll(",\"harness\":\"pi\",\"nativeSessionId\":");
        try std.json.Stringify.value(native_id, .{}, &output.writer);
        try output.writer.writeAll(",\"entries\":");
        try std.json.Stringify.value(entries, .{}, &output.writer);
        try output.writer.writeAll(",\"leafId\":");
        try std.json.Stringify.value(leaf_id, .{}, &output.writer);
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    fn readPersistedTranscript(manager: *Manager, native_id: []const u8, since: ?[]const u8) ![]u8 {
        if (!manager.pi.available()) return error.HarnessUnavailable;
        const session_path = try manager.nativeSessionPath(native_id);
        defer manager.allocator.free(session_path);
        var environment = try manager.model_route.environment.clone(manager.allocator);
        defer environment.deinit();
        try environment.put("PI_CODING_AGENT_DIR", manager.model_route.agent_dir);
        var child = try std.process.spawn(manager.io, .{
            .argv = &.{ manager.pi.executable, "--mode", "rpc", "--session", session_path },
            .environ_map = &environment,
            .stdin = .pipe,
            .stdout = .pipe,
            .stderr = .ignore,
            .pgid = 0,
        });
        defer child.kill(manager.io);
        const command_id = manager.commandId();
        var command: Io.Writer.Allocating = .init(manager.allocator);
        defer command.deinit();
        try command.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(command_id[0..], .{}, &command.writer);
        try command.writer.writeAll(",\"type\":\"get_entries\"");
        if (since) |entry_id| {
            try command.writer.writeAll(",\"since\":");
            try std.json.Stringify.value(entry_id, .{}, &command.writer);
        }
        try command.writer.writeAll("}\n");
        try child.stdin.?.writeStreamingAll(manager.io, command.writer.buffered());
        child.stdin.?.close(manager.io);
        child.stdin = null;
        var received: std.ArrayList(u8) = .empty;
        defer received.deinit(manager.allocator);
        var chunk: [64 * 1024]u8 = undefined;
        while (true) {
            const count = child.stdout.?.readStreaming(manager.io, &.{&chunk}) catch |failure| switch (failure) {
                error.EndOfStream => break,
                else => return failure,
            };
            if (count == 0) break;
            if (received.items.len + count > runtime_limits.harness_event_bytes) return error.TranscriptTooLarge;
            try received.appendSlice(manager.allocator, chunk[0..count]);
        }
        var lines = std.mem.splitScalar(u8, received.items, '\n');
        while (lines.next()) |line_value| {
            const line = std.mem.trim(u8, line_value, " \t\r");
            var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, line, .{}) catch continue;
            defer parsed.deinit();
            if (parsed.value != .object) continue;
            const response_id = optionalString(parsed.value.object, "id") orelse continue;
            if (!std.mem.eql(u8, response_id, command_id[0..])) continue;
            try validateAcknowledgement(manager.allocator, line);
            return manager.allocator.dupe(u8, line);
        }
        return error.InvalidHarnessResponse;
    }

    fn nativeSessionPath(manager: *Manager, native_id: []const u8) ![]u8 {
        const session_dir = try std.fs.path.join(manager.allocator, &.{ manager.data_dir, "harness", "pi", "sessions" });
        defer manager.allocator.free(session_dir);
        var directory = Io.Dir.cwd().openDir(manager.io, session_dir, .{ .iterate = true }) catch return error.SessionNotFound;
        defer directory.close(manager.io);
        const suffix = try std.fmt.allocPrint(manager.allocator, "_{s}.jsonl", .{native_id});
        defer manager.allocator.free(suffix);
        const exact = try std.fmt.allocPrint(manager.allocator, "{s}.jsonl", .{native_id});
        defer manager.allocator.free(exact);
        var selected: ?[]u8 = null;
        defer if (selected) |value| manager.allocator.free(value);
        var iterator = directory.iterateAssumeFirstIteration();
        while (try iterator.next(manager.io)) |entry| {
            if (entry.kind != .file) continue;
            if (!std.mem.eql(u8, entry.name, exact) and !std.mem.endsWith(u8, entry.name, suffix)) continue;
            if (selected == null or std.mem.order(u8, entry.name, selected.?) == .gt) {
                if (selected) |value| manager.allocator.free(value);
                selected = try manager.allocator.dupe(u8, entry.name);
            }
        }
        return std.fs.path.join(manager.allocator, &.{ session_dir, selected orelse return error.SessionNotFound });
    }

    pub fn turnPayload(manager: *Manager, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidTurnPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidTurnPayload;
        return manager.turnPayloadAt(document, optionalUnsigned(parsed.value.object, "initialEventSeq") orelse 0, null);
    }

    pub fn turnPayloadAt(manager: *Manager, document: []const u8, initial_event_seq: u64, native_session_id: ?[]const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidTurnPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidTurnPayload;
        const object = parsed.value.object;
        const harness = optionalString(object, "harness") orelse "pi";
        const harness_kind: Harness = if (std.mem.eql(u8, harness, "pi")) .pi else if (std.mem.eql(u8, harness, "chat")) .chat else if (std.mem.eql(u8, harness, "fx")) .fx else if (std.mem.eql(u8, harness, "opencode")) .opencode else if (std.mem.eql(u8, harness, "codex")) .codex else if (std.mem.eql(u8, harness, "claude")) .claude else return error.HarnessDriverUnavailable;
        if (manager.mode == .head and harness_kind != .chat) return error.RemoteHarnessRequired;
        if (harness_kind == .pi and !manager.piIsAvailable()) return error.HarnessUnavailable;
        if ((harness_kind == .chat or harness_kind == .fx or harness_kind == .opencode or harness_kind == .claude) and !manager.model_route.available()) return error.HarnessUnavailable;
        if (harness_kind == .fx and !manager.fx.available()) return error.HarnessUnavailable;
        if (harness_kind == .opencode and !manager.opencodeIsAvailable()) return error.HarnessUnavailable;
        if (harness_kind == .codex and !manager.codexIsAvailable()) return error.HarnessUnavailable;
        if (harness_kind == .claude and !manager.claudeIsAvailable()) return error.HarnessUnavailable;
        const session_id = optionalString(object, "sessionId") orelse "default";
        const model_id = optionalString(object, "modelRouteId") orelse requiredString(object, "modelId") orelse return error.ModelIdRequired;
        const message = requiredString(object, "message") orelse return error.MessageRequired;
        if (harness_kind == .claude and !std.mem.startsWith(u8, model_id, "openrouter/")) return error.HarnessModelUnsupported;
        if (!harness_session_id.validRuntime(session_id)) return error.InvalidSessionId;
        const mode = optionalString(object, "mode") orelse "prompt";
        if (!std.mem.eql(u8, mode, "prompt") and !std.mem.eql(u8, mode, "steer") and !std.mem.eql(u8, mode, "follow_up")) return error.InvalidTurnMode;
        if (harness_kind != .pi and !std.mem.eql(u8, mode, "prompt")) return error.QueueMutationNotSupported;
        if (object.get("queueAction") != null) return error.QueueMutationNotSupported;
        const cwd = optionalString(object, "cwd");
        const thinking = optionalString(object, "thinkingLevel");
        const browser_tool_enabled = optionalBool(object, "browserToolEnabled") orelse false;
        const tool_access = optionalString(object, "toolAccess") orelse "read_only";
        const requested_native_id = optionalString(object, "nativeSessionId") orelse optionalString(object, "piSessionId") orelse native_session_id;
        const session = if (std.mem.eql(u8, mode, "prompt"))
            if (harness_kind == .chat)
                try manager.ensureChatSession(session_id, requested_native_id, model_id, initial_event_seq)
            else if (harness_kind == .fx or harness_kind == .opencode)
                try manager.ensureAcpSession(harness_kind, session_id, requested_native_id, model_id, cwd, initial_event_seq)
            else if (harness_kind == .codex)
                try manager.ensureCodexSession(session_id, requested_native_id, model_id, cwd, message, thinking, tool_access, initial_event_seq)
            else if (harness_kind == .claude)
                try manager.ensureClaudeSession(session_id, requested_native_id, model_id, cwd, message, thinking, tool_access, initial_event_seq)
            else
                try manager.ensureSession(session_id, requested_native_id, model_id, cwd, thinking, tool_access)
        else
            try manager.existingActiveSession(session_id);
        if (session.harness != harness_kind) return error.SessionHarnessMismatch;
        if ((harness_kind == .chat or harness_kind == .fx or harness_kind == .opencode) and session.active) return error.QueueMutationNotSupported;
        const was_active = session.active;
        if (harness_kind == .chat or harness_kind == .fx or harness_kind == .opencode) {
            if (harness_kind == .chat) {
                session.active = true;
                manager.sendChatPrompt(session, message, thinking, browser_tool_enabled) catch |failure| {
                    session.active = false;
                    return failure;
                };
            } else {
                try manager.sendAcpPrompt(session, message);
            }
        }
        if (harness_kind == .chat or harness_kind == .fx or harness_kind == .opencode) return manager.turnResponse(session, was_active);
        if (harness_kind == .codex) {
            return manager.turnResponse(session, false);
        }
        if (harness_kind == .claude) return manager.turnResponse(session, false);
        var command: Io.Writer.Allocating = .init(manager.allocator);
        defer command.deinit();
        const command_id = manager.commandId();
        const command_type = if (std.mem.eql(u8, mode, "follow_up")) "follow_up" else mode;
        try command.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(command_id[0..], .{}, &command.writer);
        try command.writer.writeAll(",\"type\":");
        try std.json.Stringify.value(command_type, .{}, &command.writer);
        try command.writer.writeAll(",\"message\":");
        try std.json.Stringify.value(message, .{}, &command.writer);
        if (object.get("images")) |images| if (images == .array and images.array.items.len > 0) {
            try command.writer.writeAll(",\"images\":");
            try std.json.Stringify.value(images, .{}, &command.writer);
        };
        if (optionalString(object, "streamingBehavior")) |behavior| {
            try command.writer.writeAll(",\"streamingBehavior\":");
            try std.json.Stringify.value(behavior, .{}, &command.writer);
        }
        try command.writer.writeByte('}');
        const acknowledgement = try manager.sendCommand(session, command_id[0..], command.writer.buffered());
        defer manager.allocator.free(acknowledgement);
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"type\":\"command\",\"outcome\":");
        try std.json.Stringify.value(if (was_active) "queued" else "accepted", .{}, &output.writer);
        try output.writer.writeAll(",\"runtimeSessionId\":");
        try std.json.Stringify.value(session.id, .{}, &output.writer);
        try output.writer.writeAll(",\"piSessionId\":");
        try std.json.Stringify.value(session.native_id, .{}, &output.writer);
        try output.writer.writeAll(",\"harness\":\"pi\",\"harnessVersion\":");
        if (manager.pi.version) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"nativeSessionId\":");
        try std.json.Stringify.value(session.native_id, .{}, &output.writer);
        try output.writer.print(",\"active\":{},\"status\":", .{session.active});
        try writeStatus(&output.writer, session);
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    fn turnResponse(manager: *Manager, session: *Session, was_active: bool) ![]u8 {
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"type\":\"command\",\"outcome\":");
        try std.json.Stringify.value(if (was_active) "queued" else "accepted", .{}, &output.writer);
        try output.writer.writeAll(",\"runtimeSessionId\":");
        try std.json.Stringify.value(session.id, .{}, &output.writer);
        try output.writer.writeAll(",\"nativeSessionId\":");
        try std.json.Stringify.value(session.native_id, .{}, &output.writer);
        try output.writer.writeAll(",\"harness\":");
        try std.json.Stringify.value(session.harness.name(), .{}, &output.writer);
        try output.writer.writeAll(",\"harnessVersion\":");
        if (session.harness_version) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.print(",\"active\":{},\"status\":", .{session.active});
        try writeStatus(&output.writer, session);
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn abortPayload(manager: *Manager, document: []const u8) ![]u8 {
        const session_id = try sessionIdFromDocument(manager.allocator, document);
        defer manager.allocator.free(session_id);
        const session = try manager.existingSession(session_id);
        if (session.harness == .fx or session.harness == .opencode) {
            try manager.send(session, "{\"jsonrpc\":\"2.0\",\"method\":\"session/cancel\",\"params\":{}}");
            return manager.allocator.dupe(u8, "{\"ok\":true,\"cleared\":{\"steering\":[],\"followUp\":[]}}");
        }
        if (session.harness == .chat) {
            if (session.chat) |*chat| chat.cancel();
            return manager.allocator.dupe(u8, "{\"ok\":true,\"cleared\":{\"steering\":[],\"followUp\":[]}}");
        }
        if (session.harness == .codex or session.harness == .claude) {
            try manager.mutex.lock(manager.io);
            defer manager.mutex.unlock(manager.io);
            if (session.child) |*child| if (child.id != null) child.kill(manager.io);
            return manager.allocator.dupe(u8, "{\"ok\":true,\"cleared\":{\"steering\":[],\"followUp\":[]}}");
        }
        const command_id = manager.commandId();
        const command = try std.fmt.allocPrint(manager.allocator, "{{\"id\":\"{s}\",\"type\":\"abort\"}}", .{command_id[0..]});
        defer manager.allocator.free(command);
        const acknowledgement = try manager.sendCommand(session, command_id[0..], command);
        defer manager.allocator.free(acknowledgement);
        return manager.allocator.dupe(u8, "{\"ok\":true,\"cleared\":{\"steering\":[],\"followUp\":[]}}");
    }

    pub fn compactPayload(manager: *Manager, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidCompactPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidCompactPayload;
        const session_id = optionalString(parsed.value.object, "sessionId") orelse "default";
        const session = try manager.existingSession(session_id);
        if (session.harness != .pi) return error.QueueMutationNotSupported;
        var command: Io.Writer.Allocating = .init(manager.allocator);
        defer command.deinit();
        const command_id = manager.commandId();
        try command.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(command_id[0..], .{}, &command.writer);
        try command.writer.writeAll(",\"type\":\"compact\"");
        if (optionalString(parsed.value.object, "customInstructions")) |instructions| {
            try command.writer.writeAll(",\"customInstructions\":");
            try std.json.Stringify.value(instructions, .{}, &command.writer);
        }
        try command.writer.writeByte('}');
        const acknowledgement = try manager.sendCommand(session, command_id[0..], command.writer.buffered());
        defer manager.allocator.free(acknowledgement);
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"ok\":true,\"result\":null,\"status\":");
        try writeStatus(&output.writer, session);
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn extensionUiPayload(manager: *Manager, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidExtensionUiPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidExtensionUiPayload;
        const session_id = requiredString(parsed.value.object, "sessionId") orelse return error.SessionIdRequired;
        const request_id = requiredString(parsed.value.object, "requestId") orelse return error.RequestIdRequired;
        const session = try manager.existingSession(session_id);
        var command: Io.Writer.Allocating = .init(manager.allocator);
        defer command.deinit();
        try command.writer.writeAll("{\"type\":\"extension_ui_response\",\"id\":");
        try std.json.Stringify.value(request_id, .{}, &command.writer);
        for ([_][]const u8{ "value", "confirmed", "cancelled" }) |name| if (parsed.value.object.get(name)) |value| {
            try command.writer.writeByte(',');
            try std.json.Stringify.value(name, .{}, &command.writer);
            try command.writer.writeByte(':');
            try std.json.Stringify.value(value, .{}, &command.writer);
        };
        try command.writer.writeByte('}');
        try manager.send(session, command.writer.buffered());
        return manager.allocator.dupe(u8, "{\"ok\":true}");
    }

    pub fn serveEvents(manager: *Manager, session_id: []const u8, after_value: u64, request: *std.http.Server.Request) !void {
        var write_buffer: [16 * 1024]u8 = undefined;
        var body = try request.respondStreaming(&write_buffer, .{
            .respond_options = .{
                .keep_alive = false,
                .extra_headers = &.{
                    .{ .name = "Content-Type", .value = "text/event-stream; charset=utf-8" },
                    .{ .name = "Cache-Control", .value = "no-cache, no-transform" },
                    .{ .name = "X-Accel-Buffering", .value = "no" },
                },
            },
        });
        var after = after_value;
        var idle_rounds: usize = 0;
        while (true) {
            try manager.mutex.lock(manager.io);
            const session = manager.sessions.get(session_id);
            if (session == null) {
                manager.mutex.unlock(manager.io);
                return error.SessionNotFound;
            }
            var sent = false;
            for (session.?.events.values()) |event| if (event.seq > after) {
                try body.writer.print("id: {d}\ndata: ", .{event.seq});
                try harness_events.writeStreamEnvelope(manager.allocator, &body.writer, session.?.harness.name(), event.seq, event.document);
                try body.writer.writeAll("\n\n");
                after = event.seq;
                sent = true;
            };
            const active = session.?.active;
            const status = try statusDocument(manager.allocator, session.?);
            manager.mutex.unlock(manager.io);
            defer manager.allocator.free(status);
            if (sent) {
                try body.writer.flush();
                try body.flush();
                idle_rounds = 0;
            } else idle_rounds += 1;
            if (!active and idle_rounds >= 2) {
                try body.writer.print("data: {{\"type\":\"status\",\"phase\":\"idle\",\"session\":{s}}}\n\n", .{status});
                try body.end();
                return;
            }
            if (idle_rounds % 80 == 0) {
                try body.writer.print("data: {{\"type\":\"status\",\"phase\":\"running\",\"session\":{s}}}\n\n", .{status});
                try body.writer.flush();
                try body.flush();
            }
            try manager.io.sleep(.fromMilliseconds(250), .awake);
        }
    }

    fn ensureSession(manager: *Manager, session_id: []const u8, native_value: ?[]const u8, model_id: []const u8, cwd_value: ?[]const u8, thinking: ?[]const u8, tool_access: []const u8) !*Session {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.sessions.get(session_id)) |session| {
            if (session.running) {
                if (!std.mem.eql(u8, session.model_id, model_id)) return error.ModelChangeRequiresNewSession;
                return session;
            }
            _ = manager.sessions.remove(session_id);
            session.deinit(manager.io);
        }
        const resolved_cwd = if (cwd_value == null) try Io.Dir.cwd().realPathFileAlloc(manager.io, ".", manager.allocator) else null;
        defer if (resolved_cwd) |value| manager.allocator.free(value);
        const cwd = cwd_value orelse resolved_cwd.?;
        if (!std.fs.path.isAbsolute(cwd)) return error.CwdMustBeAbsolute;
        const session_dir = try std.fs.path.join(manager.allocator, &.{ manager.data_dir, "harness", "pi", "sessions" });
        errdefer manager.allocator.free(session_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, session_dir, @enumFromInt(0o700));
        const log_filename = try std.fmt.allocPrint(manager.allocator, "{s}.log", .{session_id});
        defer manager.allocator.free(log_filename);
        const log_path = try std.fs.path.join(manager.allocator, &.{ manager.data_dir, "harness", "pi", "logs", log_filename });
        defer manager.allocator.free(log_path);
        const log_directory = std.fs.path.dirname(log_path) orelse manager.data_dir;
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, log_directory, @enumFromInt(0o700));
        var log_file = try Io.Dir.cwd().createFile(manager.io, log_path, .{ .permissions = @enumFromInt(0o600), .truncate = false });
        defer log_file.close(manager.io);
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(manager.allocator);
        var model_route = try manager.model_route.prepare(model_id);
        defer model_route.deinit();
        try model_route.environment.put("LOCAL_STUDIO_MODEL_ID", model_id);
        try manager.addMcpBridgeEnvironment(&model_route.environment, model_id, session_id);
        const native_id = try harness_session_id.resolve(manager.allocator, session_id, native_value);
        errdefer manager.allocator.free(native_id);
        try argv.appendSlice(manager.allocator, &.{ manager.pi.executable, "--mode", "rpc", "--session-dir", session_dir, "--session-id", native_id, "--model", model_route.model_name });
        if (thinking) |level| if (!std.mem.eql(u8, level, "auto")) try argv.appendSlice(manager.allocator, &.{ "--thinking", level });
        if (!std.mem.eql(u8, tool_access, "full")) try argv.appendSlice(manager.allocator, &.{ "--tools", "read,grep,find,ls" });
        var child = try std.process.spawn(manager.io, .{
            .argv = argv.items,
            .environ_map = &model_route.environment,
            .cwd = .{ .path = cwd },
            .stdin = .pipe,
            .stdout = .pipe,
            .stderr = .{ .file = log_file },
            .pgid = 0,
        });
        errdefer child.kill(manager.io);
        const session = try manager.allocator.create(Session);
        errdefer manager.allocator.destroy(session);
        session.* = .{
            .allocator = manager.allocator,
            .harness = .pi,
            .id = try manager.allocator.dupe(u8, session_id),
            .native_id = native_id,
            .harness_version = if (manager.pi.version) |value| try manager.allocator.dupe(u8, value) else null,
            .model_id = try manager.allocator.dupe(u8, model_id),
            .cwd = try manager.allocator.dupe(u8, cwd),
            .session_dir = session_dir,
            .child = child,
        };
        errdefer {
            manager.allocator.free(session.id);
            if (session.harness_version) |value| manager.allocator.free(value);
            manager.allocator.free(session.model_id);
            manager.allocator.free(session.cwd);
        }
        try manager.sessions.put(manager.allocator, session.id, session);
        manager.tasks.concurrent(manager.io, readHarness, .{ manager, session }) catch |failure| {
            _ = manager.sessions.remove(session.id);
            return failure;
        };
        return session;
    }

    fn ensureCodexSession(manager: *Manager, session_id: []const u8, native_session_id: ?[]const u8, model_id: []const u8, cwd_value: ?[]const u8, message: []const u8, thinking: ?[]const u8, tool_access: []const u8, initial_event_seq: u64) !*Session {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.sessions.get(session_id)) |session| {
            if (session.harness != .codex) return error.SessionHarnessMismatch;
            if (session.running or session.active) return error.QueueMutationNotSupported;
            if (!std.mem.eql(u8, session.model_id, model_id)) return error.ModelChangeRequiresNewSession;
            if (native_session_id == null and session.last_error != null) {
                manager.allocator.free(session.native_id);
                session.native_id = try manager.allocator.dupe(u8, "");
            }
            session.child = try manager.spawnCodex(session.id, session.native_id, session.model_id, session.cwd, session.session_dir, message, thinking, tool_access);
            session.running = true;
            session.active = true;
            if (session.last_error) |value| manager.allocator.free(value);
            session.last_error = null;
            manager.tasks.concurrent(manager.io, readHarness, .{ manager, session }) catch |failure| {
                if (session.child) |*child| child.kill(manager.io);
                session.running = false;
                session.active = false;
                return failure;
            };
            return session;
        }
        const resolved_cwd = if (cwd_value == null) try Io.Dir.cwd().realPathFileAlloc(manager.io, ".", manager.allocator) else null;
        defer if (resolved_cwd) |value| manager.allocator.free(value);
        const cwd = cwd_value orelse resolved_cwd.?;
        if (!std.fs.path.isAbsolute(cwd)) return error.CwdMustBeAbsolute;
        const session_dir = try std.fs.path.join(manager.allocator, &.{ manager.data_dir, "harness", "codex" });
        errdefer manager.allocator.free(session_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, session_dir, @enumFromInt(0o700));
        const native_id = try manager.allocator.dupe(u8, native_session_id orelse "");
        errdefer manager.allocator.free(native_id);
        var child = try manager.spawnCodex(session_id, native_id, model_id, cwd, session_dir, message, thinking, tool_access);
        errdefer child.kill(manager.io);
        const session = try manager.allocator.create(Session);
        errdefer manager.allocator.destroy(session);
        session.* = .{
            .allocator = manager.allocator,
            .harness = .codex,
            .id = try manager.allocator.dupe(u8, session_id),
            .native_id = native_id,
            .harness_version = if (manager.codex.version) |value| try manager.allocator.dupe(u8, value) else null,
            .model_id = try manager.allocator.dupe(u8, model_id),
            .cwd = try manager.allocator.dupe(u8, cwd),
            .session_dir = session_dir,
            .child = child,
            .active = true,
            .event_seq = initial_event_seq,
        };
        errdefer {
            manager.allocator.free(session.id);
            if (session.harness_version) |value| manager.allocator.free(value);
            manager.allocator.free(session.model_id);
            manager.allocator.free(session.cwd);
        }
        try manager.sessions.put(manager.allocator, session.id, session);
        manager.tasks.concurrent(manager.io, readHarness, .{ manager, session }) catch |failure| {
            _ = manager.sessions.remove(session.id);
            return failure;
        };
        return session;
    }

    fn spawnCodex(manager: *Manager, session_id: []const u8, native_id: []const u8, model_id: []const u8, cwd: []const u8, session_dir: []const u8, message: []const u8, thinking: ?[]const u8, tool_access: []const u8) !std.process.Child {
        const logs_dir = try std.fs.path.join(manager.allocator, &.{ session_dir, "logs" });
        defer manager.allocator.free(logs_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, logs_dir, @enumFromInt(0o700));
        const log_filename = try std.fmt.allocPrint(manager.allocator, "{s}.log", .{session_id});
        defer manager.allocator.free(log_filename);
        const log_path = try std.fs.path.join(manager.allocator, &.{ logs_dir, log_filename });
        defer manager.allocator.free(log_path);
        var log_file = try Io.Dir.cwd().createFile(manager.io, log_path, .{ .permissions = @enumFromInt(0o600), .truncate = false });
        defer log_file.close(manager.io);
        var model_route = try manager.model_route.prepare(model_id);
        defer model_route.deinit();
        const sandbox = if (std.mem.eql(u8, tool_access, "full")) "workspace-write" else "read-only";
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(manager.allocator);
        try manager.addMcpBridgeEnvironment(&model_route.environment, model_id, session_id);
        const controller_executable = try std.process.executablePathAlloc(manager.io, manager.allocator);
        defer manager.allocator.free(controller_executable);
        const command_config = try configAssignment(manager.allocator, "mcp_servers.local-studio.command", controller_executable);
        defer manager.allocator.free(command_config);
        const provider_url_config = try configAssignment(manager.allocator, "model_providers.local_studio.base_url", model_route.base_url);
        defer manager.allocator.free(provider_url_config);
        const args_config = "mcp_servers.local-studio.args=[\"mcp-bridge\"]";
        const env_config = "mcp_servers.local-studio.env_vars=[\"LOCAL_STUDIO_MCP_BRIDGE_URL\",\"LOCAL_STUDIO_MCP_BRIDGE_MODEL\",\"LOCAL_STUDIO_MCP_BRIDGE_SESSION\",\"LOCAL_STUDIO_MCP_BRIDGE_KEY\"]";
        if (native_id.len == 0)
            try argv.appendSlice(manager.allocator, &.{ manager.codex.executable, "exec", "--json", "--color", "never", "--skip-git-repo-check", "--sandbox", sandbox, "-m", model_id })
        else
            try argv.appendSlice(manager.allocator, &.{ manager.codex.executable, "exec", "resume", "--json", "--skip-git-repo-check", "-m", model_id });
        try argv.appendSlice(manager.allocator, &.{ "-c", "model_provider=\"local_studio\"", "-c", "model_providers.local_studio.name=\"Local Studio\"", "-c", provider_url_config, "-c", "model_providers.local_studio.env_key=\"LOCAL_STUDIO_HEAD_API_KEY\"", "-c", "model_providers.local_studio.wire_api=\"responses\"", "-c", "model_providers.local_studio.requires_openai_auth=false", "-c", command_config, "-c", args_config, "-c", env_config });
        const effort = if (thinking) |value| if (!std.mem.eql(u8, value, "auto") and !std.mem.eql(u8, value, "off")) try std.fmt.allocPrint(manager.allocator, "model_reasoning_effort=\"{s}\"", .{value}) else null else null;
        defer if (effort) |value| manager.allocator.free(value);
        if (effort) |value| try argv.appendSlice(manager.allocator, &.{ "-c", value });
        if (native_id.len > 0) try argv.append(manager.allocator, native_id);
        try argv.append(manager.allocator, message);
        return std.process.spawn(manager.io, .{
            .argv = argv.items,
            .environ_map = &model_route.environment,
            .cwd = .{ .path = cwd },
            .stdin = .ignore,
            .stdout = .pipe,
            .stderr = .{ .file = log_file },
            .pgid = 0,
        });
    }

    fn ensureClaudeSession(manager: *Manager, session_id: []const u8, native_session_id: ?[]const u8, model_id: []const u8, cwd_value: ?[]const u8, message: []const u8, thinking: ?[]const u8, tool_access: []const u8, initial_event_seq: u64) !*Session {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.sessions.get(session_id)) |session| {
            if (session.harness != .claude) return error.SessionHarnessMismatch;
            if (session.running or session.active) return error.QueueMutationNotSupported;
            if (!std.mem.eql(u8, session.model_id, model_id)) return error.ModelChangeRequiresNewSession;
            session.child = try manager.spawnClaude(session.id, session.native_id, session.model_id, session.cwd, session.session_dir, message, thinking, tool_access, true);
            session.running = true;
            session.active = true;
            if (session.last_error) |value| manager.allocator.free(value);
            session.last_error = null;
            manager.tasks.concurrent(manager.io, readHarness, .{ manager, session }) catch |failure| {
                if (session.child) |*child| child.kill(manager.io);
                session.running = false;
                session.active = false;
                return failure;
            };
            return session;
        }
        const resolved_cwd = if (cwd_value == null) try Io.Dir.cwd().realPathFileAlloc(manager.io, ".", manager.allocator) else null;
        defer if (resolved_cwd) |value| manager.allocator.free(value);
        const cwd = cwd_value orelse resolved_cwd.?;
        if (!std.fs.path.isAbsolute(cwd)) return error.CwdMustBeAbsolute;
        const session_dir = try std.fs.path.join(manager.allocator, &.{ manager.data_dir, "harness", "claude" });
        errdefer manager.allocator.free(session_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, session_dir, @enumFromInt(0o700));
        const native_id = if (native_session_id) |value| try manager.allocator.dupe(u8, value) else try manager.uuid();
        errdefer manager.allocator.free(native_id);
        var child = try manager.spawnClaude(session_id, native_id, model_id, cwd, session_dir, message, thinking, tool_access, native_session_id != null);
        errdefer child.kill(manager.io);
        const session = try manager.allocator.create(Session);
        errdefer manager.allocator.destroy(session);
        session.* = .{
            .allocator = manager.allocator,
            .harness = .claude,
            .id = try manager.allocator.dupe(u8, session_id),
            .native_id = native_id,
            .harness_version = if (manager.claude.version) |value| try manager.allocator.dupe(u8, value) else null,
            .model_id = try manager.allocator.dupe(u8, model_id),
            .cwd = try manager.allocator.dupe(u8, cwd),
            .session_dir = session_dir,
            .child = child,
            .active = true,
            .event_seq = initial_event_seq,
        };
        errdefer {
            manager.allocator.free(session.id);
            if (session.harness_version) |value| manager.allocator.free(value);
            manager.allocator.free(session.model_id);
            manager.allocator.free(session.cwd);
        }
        try manager.sessions.put(manager.allocator, session.id, session);
        manager.tasks.concurrent(manager.io, readHarness, .{ manager, session }) catch |failure| {
            _ = manager.sessions.remove(session.id);
            return failure;
        };
        return session;
    }

    fn spawnClaude(manager: *Manager, session_id: []const u8, native_id: []const u8, model_id: []const u8, cwd: []const u8, session_dir: []const u8, message: []const u8, thinking: ?[]const u8, tool_access: []const u8, resume_session: bool) !std.process.Child {
        const logs_dir = try std.fs.path.join(manager.allocator, &.{ session_dir, "logs" });
        defer manager.allocator.free(logs_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, logs_dir, @enumFromInt(0o700));
        const log_filename = try std.fmt.allocPrint(manager.allocator, "{s}.log", .{session_id});
        defer manager.allocator.free(log_filename);
        const log_path = try std.fs.path.join(manager.allocator, &.{ logs_dir, log_filename });
        defer manager.allocator.free(log_path);
        var log_file = try Io.Dir.cwd().createFile(manager.io, log_path, .{ .permissions = @enumFromInt(0o600), .truncate = false });
        defer log_file.close(manager.io);
        var model_route = try manager.model_route.prepare(model_id);
        defer model_route.deinit();
        const api_key = model_route.environment.get("LOCAL_STUDIO_HEAD_API_KEY") orelse return error.HeadCredentialRequired;
        const origin = if (std.mem.endsWith(u8, model_route.base_url, "/v1")) model_route.base_url[0 .. model_route.base_url.len - 3] else model_route.base_url;
        try model_route.environment.put("ANTHROPIC_BASE_URL", origin);
        try model_route.environment.put("ANTHROPIC_AUTH_TOKEN", api_key);
        try model_route.environment.put("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(manager.allocator);
        try argv.appendSlice(manager.allocator, &.{ manager.claude.executable, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", model_id, "--permission-mode", "dontAsk" });
        if (thinking) |value| if (!std.mem.eql(u8, value, "auto") and !std.mem.eql(u8, value, "off")) try argv.appendSlice(manager.allocator, &.{ "--effort", value });
        if (std.mem.eql(u8, tool_access, "full"))
            try argv.appendSlice(manager.allocator, &.{ "--tools", "default" })
        else
            try argv.appendSlice(manager.allocator, &.{ "--tools", "Read,Grep,Glob,WebFetch,WebSearch" });
        if (resume_session)
            try argv.appendSlice(manager.allocator, &.{ "--resume", native_id })
        else
            try argv.appendSlice(manager.allocator, &.{ "--session-id", native_id });
        try argv.append(manager.allocator, message);
        return std.process.spawn(manager.io, .{
            .argv = argv.items,
            .environ_map = &model_route.environment,
            .cwd = .{ .path = cwd },
            .stdin = .ignore,
            .stdout = .pipe,
            .stderr = .{ .file = log_file },
            .pgid = 0,
        });
    }

    fn uuid(manager: *Manager) ![]u8 {
        var bytes: [16]u8 = undefined;
        manager.io.random(&bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = std.fmt.bytesToHex(bytes, .lower);
        return std.fmt.allocPrint(manager.allocator, "{s}-{s}-{s}-{s}-{s}", .{ hex[0..8], hex[8..12], hex[12..16], hex[16..20], hex[20..32] });
    }

    fn addMcpBridgeEnvironment(manager: *Manager, environment: *std.process.Environ.Map, model_id: []const u8, session_id: []const u8) !void {
        try environment.put("LOCAL_STUDIO_MCP_BRIDGE_URL", manager.controller_origin);
        try environment.put("LOCAL_STUDIO_MCP_BRIDGE_MODEL", model_id);
        try environment.put("LOCAL_STUDIO_MCP_BRIDGE_SESSION", session_id);
        try environment.put("LOCAL_STUDIO_MCP_BRIDGE_KEY", manager.controller_api_key orelse "");
    }

    fn configureOpenCode(manager: *Manager, route: *pi_model_route.Route, session_dir: []const u8, model_id: []const u8) !void {
        const config_home = try std.fs.path.join(manager.allocator, &.{ session_dir, "config" });
        defer manager.allocator.free(config_home);
        const data_home = try std.fs.path.join(manager.allocator, &.{ session_dir, "data" });
        defer manager.allocator.free(data_home);
        const cache_home = try std.fs.path.join(manager.allocator, &.{ session_dir, "cache" });
        defer manager.allocator.free(cache_home);
        const config_dir = try std.fs.path.join(manager.allocator, &.{ config_home, "opencode" });
        defer manager.allocator.free(config_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, config_dir, @enumFromInt(0o700));
        const config_path = try std.fs.path.join(manager.allocator, &.{ config_dir, "opencode.json" });
        defer manager.allocator.free(config_path);
        var document: Io.Writer.Allocating = .init(manager.allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"model\":\"local-studio/selected\",\"providers\":{\"local-studio\":{\"name\":\"Local Studio\",\"env\":[\"LOCAL_STUDIO_HEAD_API_KEY\"],\"package\":\"aisdk:@ai-sdk/openai\",\"settings\":{\"baseURL\":");
        try std.json.Stringify.value(route.base_url, .{}, &document.writer);
        try document.writer.writeAll("},\"models\":{\"selected\":{\"modelID\":");
        try std.json.Stringify.value(model_id, .{}, &document.writer);
        try document.writer.writeAll(",\"name\":");
        try std.json.Stringify.value(model_id, .{}, &document.writer);
        try document.writer.writeAll(",\"capabilities\":{\"tools\":true,\"input\":[\"text\",\"image\"],\"output\":[\"text\"]}}}}},\"permissions\":[{\"action\":\"*\",\"resource\":\"*\",\"effect\":\"allow\"}]}");
        var file = try Io.Dir.cwd().createFile(manager.io, config_path, .{ .permissions = @enumFromInt(0o600), .truncate = true });
        defer file.close(manager.io);
        try file.writeStreamingAll(manager.io, document.writer.buffered());
        try route.environment.put("XDG_CONFIG_HOME", config_home);
        try route.environment.put("XDG_DATA_HOME", data_home);
        try route.environment.put("XDG_CACHE_HOME", cache_home);
    }

    fn configureFx(manager: *Manager, route: *pi_model_route.Route, model_id: []const u8) !void {
        const gateway_url = try std.fmt.allocPrint(manager.allocator, "{s}/internal/harness/v1/fx-gateway", .{manager.controller_origin});
        defer manager.allocator.free(gateway_url);
        try route.environment.put("AI_GATEWAY_API_KEY", manager.controller_api_key orelse "local-studio");
        try route.environment.put("FX_GATEWAY_CHAT_URL", gateway_url);
        try route.environment.put("FX_MODEL", model_id);
        try route.environment.put("FX_PERMISSION_MODE", "yolo");
        try route.environment.put("FX_AUTO_UPGRADE", "0");
    }

    fn ensureAcpSession(manager: *Manager, harness_kind: Harness, session_id: []const u8, native_session_id: ?[]const u8, model_id: []const u8, cwd_value: ?[]const u8, initial_event_seq: u64) !*Session {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.sessions.get(session_id)) |session| {
            if (session.running) {
                if (session.harness != harness_kind) return error.SessionHarnessMismatch;
                if (!std.mem.eql(u8, session.model_id, model_id)) return error.ModelChangeRequiresNewSession;
                return session;
            }
            _ = manager.sessions.remove(session_id);
            session.deinit(manager.io);
        }
        const harness_dir = try std.fs.path.join(manager.allocator, &.{ manager.data_dir, "harness", harness_kind.name() });
        defer manager.allocator.free(harness_dir);
        const session_dir = if (harness_kind == .opencode or harness_kind == .fx)
            try std.fs.path.join(manager.allocator, &.{ harness_dir, session_id })
        else
            try manager.allocator.dupe(u8, harness_dir);
        errdefer manager.allocator.free(session_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, session_dir, @enumFromInt(0o700));
        const resolved_cwd = if (cwd_value == null) try Io.Dir.cwd().realPathFileAlloc(manager.io, ".", manager.allocator) else null;
        defer if (resolved_cwd) |value| manager.allocator.free(value);
        const cwd = cwd_value orelse resolved_cwd.?;
        if (!std.fs.path.isAbsolute(cwd)) return error.CwdMustBeAbsolute;
        const log_directory = try std.fs.path.join(manager.allocator, &.{ session_dir, "logs" });
        defer manager.allocator.free(log_directory);
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, log_directory, @enumFromInt(0o700));
        const log_filename = try std.fmt.allocPrint(manager.allocator, "{s}.log", .{session_id});
        defer manager.allocator.free(log_filename);
        const log_path = try std.fs.path.join(manager.allocator, &.{ log_directory, log_filename });
        defer manager.allocator.free(log_path);
        var log_file = try Io.Dir.cwd().createFile(manager.io, log_path, .{ .permissions = @enumFromInt(0o600), .truncate = false });
        defer log_file.close(manager.io);
        const controller_executable = try std.process.executablePathAlloc(manager.io, manager.allocator);
        defer manager.allocator.free(controller_executable);
        var model_route = try manager.model_route.prepare(model_id);
        defer model_route.deinit();
        const installation = switch (harness_kind) {
            .fx => &manager.fx,
            .opencode => &manager.opencode,
            else => return error.HarnessDriverUnavailable,
        };
        if (harness_kind == .fx) {
            try manager.configureFx(&model_route, model_id);
            try model_route.environment.put("HOME", session_dir);
        }
        if (harness_kind == .opencode) try manager.configureOpenCode(&model_route, session_dir, model_id);
        var child = try std.process.spawn(manager.io, .{
            .argv = &.{ installation.executable, "acp" },
            .environ_map = &model_route.environment,
            .cwd = .{ .path = cwd },
            .stdin = .pipe,
            .stdout = .pipe,
            .stderr = .{ .file = log_file },
            .pgid = 0,
        });
        errdefer child.kill(manager.io);
        const initialized = try directFxRequest(manager.allocator, manager.io, &child, "initialize", "{\"jsonrpc\":\"2.0\",\"id\":\"initialize\",\"method\":\"initialize\",\"params\":{\"protocolVersion\":1,\"clientCapabilities\":{\"fs\":{\"readTextFile\":false,\"writeTextFile\":false},\"terminal\":false}}}");
        defer manager.allocator.free(initialized);
        const session_request = try acpSessionRequest(manager, "session", controller_executable, model_id, session_id, native_session_id, cwd);
        defer manager.allocator.free(session_request);
        const created = try directFxRequest(manager.allocator, manager.io, &child, "session", session_request);
        defer manager.allocator.free(created);
        const native_id = if (native_session_id) |value| resumed: {
            if (fxResponseSucceeded(manager.allocator, created)) break :resumed try manager.allocator.dupe(u8, value);
            const fallback_request = try acpSessionRequest(manager, "session-fallback", controller_executable, model_id, session_id, null, cwd);
            defer manager.allocator.free(fallback_request);
            const fallback = try directFxRequest(manager.allocator, manager.io, &child, "session-fallback", fallback_request);
            defer manager.allocator.free(fallback);
            break :resumed try fxSessionId(manager.allocator, fallback);
        } else try fxSessionId(manager.allocator, created);
        errdefer manager.allocator.free(native_id);
        const session = try manager.allocator.create(Session);
        errdefer manager.allocator.destroy(session);
        session.* = .{
            .allocator = manager.allocator,
            .harness = harness_kind,
            .id = try manager.allocator.dupe(u8, session_id),
            .native_id = native_id,
            .harness_version = if (installation.version) |value| try manager.allocator.dupe(u8, value) else null,
            .model_id = try manager.allocator.dupe(u8, model_id),
            .cwd = try manager.allocator.dupe(u8, cwd),
            .session_dir = session_dir,
            .child = child,
            .event_seq = initial_event_seq,
        };
        errdefer {
            manager.allocator.free(session.id);
            if (session.harness_version) |value| manager.allocator.free(value);
            manager.allocator.free(session.model_id);
            manager.allocator.free(session.cwd);
        }
        try manager.sessions.put(manager.allocator, session.id, session);
        manager.tasks.concurrent(manager.io, readHarness, .{ manager, session }) catch |failure| {
            _ = manager.sessions.remove(session.id);
            return failure;
        };
        return session;
    }

    fn ensureChatSession(manager: *Manager, session_id: []const u8, native_session_id: ?[]const u8, model_id: []const u8, initial_event_seq: u64) !*Session {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.sessions.get(session_id)) |session| {
            if (!session.running) return error.HarnessExited;
            if (session.harness != .chat) return error.SessionHarnessMismatch;
            if (!std.mem.eql(u8, session.model_id, model_id)) {
                if (session.active) return error.SessionAlreadyActive;
                var model_route = try manager.model_route.prepare(model_id);
                defer model_route.deinit();
                const api_key = model_route.environment.get("LOCAL_STUDIO_CHAT_API_KEY") orelse return error.ChatCredentialRequired;
                const gateway_url = model_route.environment.get("LOCAL_STUDIO_CHAT_GATEWAY_URL") orelse return error.ChatGatewayRequired;
                const replacement = try chat_runtime.Runtime.init(manager.allocator, manager.io, .{
                    .api_key = api_key,
                    .model = model_id,
                    .gateway_url = gateway_url,
                    .home = session.session_dir,
                    .session_id = session.native_id,
                    .bridge_url = manager.controller_origin,
                    .bridge_key = manager.controller_api_key,
                    .bridge_model = model_id,
                    .bridge_session = session_id,
                });
                session.chat.?.deinit();
                session.chat = replacement;
                manager.allocator.free(session.model_id);
                session.model_id = try manager.allocator.dupe(u8, model_id);
            }
            return session;
        }
        const session_dir = try std.fs.path.join(manager.allocator, &.{ manager.data_dir, "harness", "chat" });
        errdefer manager.allocator.free(session_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(manager.io, session_dir, @enumFromInt(0o700));
        const native_id = try harness_session_id.resolve(manager.allocator, session_id, native_session_id);
        errdefer manager.allocator.free(native_id);
        var model_route = try manager.model_route.prepare(model_id);
        defer model_route.deinit();
        const api_key = model_route.environment.get("LOCAL_STUDIO_CHAT_API_KEY") orelse return error.ChatCredentialRequired;
        const gateway_url = model_route.environment.get("LOCAL_STUDIO_CHAT_GATEWAY_URL") orelse return error.ChatGatewayRequired;
        var chat = try chat_runtime.Runtime.init(manager.allocator, manager.io, .{
            .api_key = api_key,
            .model = model_id,
            .gateway_url = gateway_url,
            .home = session_dir,
            .session_id = native_id,
            .bridge_url = manager.controller_origin,
            .bridge_key = manager.controller_api_key,
            .bridge_model = model_id,
            .bridge_session = session_id,
        });
        errdefer chat.deinit();
        const session = try manager.allocator.create(Session);
        errdefer manager.allocator.destroy(session);
        session.* = .{
            .allocator = manager.allocator,
            .harness = .chat,
            .id = try manager.allocator.dupe(u8, session_id),
            .native_id = native_id,
            .harness_version = try manager.allocator.dupe(u8, "0.0.0-local-studio"),
            .model_id = try manager.allocator.dupe(u8, model_id),
            .cwd = try manager.allocator.dupe(u8, session_dir),
            .session_dir = session_dir,
            .chat = chat,
            .event_seq = initial_event_seq,
        };
        errdefer {
            manager.allocator.free(session.id);
            manager.allocator.free(session.harness_version.?);
            manager.allocator.free(session.model_id);
            manager.allocator.free(session.cwd);
        }
        try manager.sessions.put(manager.allocator, session.id, session);
        return session;
    }

    fn sendChatPrompt(manager: *Manager, session: *Session, message: []const u8, thinking: ?[]const u8, browser_tool_enabled: bool) !void {
        const owned_message = try manager.allocator.dupe(u8, message);
        errdefer manager.allocator.free(owned_message);
        const owned_thinking = if (thinking) |value| try manager.allocator.dupe(u8, value) else null;
        errdefer if (owned_thinking) |value| manager.allocator.free(value);
        try manager.tasks.concurrent(manager.io, runChatPrompt, .{ChatPrompt{
            .manager = manager,
            .session = session,
            .message = owned_message,
            .thinking = owned_thinking,
            .browser_enabled = browser_tool_enabled,
        }});
    }

    fn sendAcpPrompt(manager: *Manager, session: *Session, message: []const u8) !void {
        session.retry_count = 0;
        session.continuation_count = 0;
        session.waiting_for_children = false;
        session.resume_scheduled = false;
        var subagent_iterator = session.pending_subagents.keyIterator();
        while (subagent_iterator.next()) |key| session.allocator.free(key.*);
        session.pending_subagents.clearRetainingCapacity();
        return manager.sendAcpPromptContinuation(session, message);
    }

    fn sendAcpPromptContinuation(manager: *Manager, session: *Session, message: []const u8) !void {
        const request_id = manager.commandId();
        var document: Io.Writer.Allocating = .init(manager.allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
        try std.json.Stringify.value(request_id[0..], .{}, &document.writer);
        try document.writer.writeAll(",\"method\":\"session/prompt\",\"params\":{\"sessionId\":");
        try std.json.Stringify.value(session.native_id, .{}, &document.writer);
        try document.writer.writeAll(",\"prompt\":[{\"type\":\"text\",\"text\":");
        try std.json.Stringify.value(message, .{}, &document.writer);
        try document.writer.writeAll("}]}}");
        const owned_request_id = try manager.allocator.dupe(u8, request_id[0..]);
        errdefer manager.allocator.free(owned_request_id);
        try manager.mutex.lock(manager.io);
        if (!session.running or session.child == null or session.child.?.stdin == null) {
            manager.mutex.unlock(manager.io);
            return error.HarnessExited;
        }
        if (session.active_request_id != null) {
            manager.mutex.unlock(manager.io);
            return error.SessionAlreadyActive;
        }
        session.active_request_id = owned_request_id;
        session.active = true;
        session.waiting_for_children = false;
        const write_result = session.child.?.stdin.?.writeStreamingAll(manager.io, document.writer.buffered());
        if (write_result) |_| {
            session.child.?.stdin.?.writeStreamingAll(manager.io, "\n") catch |failure| {
                manager.allocator.free(session.active_request_id.?);
                session.active_request_id = null;
                session.active = false;
                manager.mutex.unlock(manager.io);
                return failure;
            };
        } else |failure| {
            manager.allocator.free(session.active_request_id.?);
            session.active_request_id = null;
            session.active = false;
            manager.mutex.unlock(manager.io);
            return failure;
        }
        manager.mutex.unlock(manager.io);
    }

    fn existingSession(manager: *Manager, session_id: []const u8) !*Session {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        return manager.sessions.get(session_id) orelse error.SessionNotFound;
    }

    fn existingActiveSession(manager: *Manager, session_id: []const u8) !*Session {
        const session = try manager.existingSession(session_id);
        if (!session.running or !session.active) return error.SessionNotActive;
        return session;
    }

    fn send(manager: *Manager, session: *Session, document: []const u8) !void {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (!session.running) return error.HarnessExited;
        if (session.child) |*child| {
            if (child.stdin == null) return error.HarnessExited;
            try child.stdin.?.writeStreamingAll(manager.io, document);
            try child.stdin.?.writeStreamingAll(manager.io, "\n");
        } else return error.HarnessExited;
    }

    fn sendCommand(manager: *Manager, session: *Session, command_id: []const u8, document: []const u8) ![]u8 {
        try manager.send(session, document);
        var attempts: usize = 0;
        while (attempts < 500) : (attempts += 1) {
            try manager.mutex.lock(manager.io);
            if (session.responses.fetchRemove(command_id)) |entry| {
                manager.mutex.unlock(manager.io);
                manager.allocator.free(entry.key);
                const response = entry.value;
                validateAcknowledgement(manager.allocator, response) catch |failure| {
                    manager.allocator.free(response);
                    return failure;
                };
                return response;
            }
            const running = session.running;
            manager.mutex.unlock(manager.io);
            if (!running) return error.HarnessExited;
            try manager.io.sleep(.fromMilliseconds(10), .awake);
        }
        return error.HarnessCommandTimeout;
    }

    fn commandId(manager: *Manager) [32]u8 {
        var bytes: [16]u8 = undefined;
        manager.io.random(&bytes);
        return std.fmt.bytesToHex(bytes, .lower);
    }

    fn handleLine(manager: *Manager, session: *Session, line_value: []const u8) !void {
        const line = std.mem.trim(u8, line_value, " \t\r");
        if (line.len == 0 or line.len > runtime_limits.harness_event_bytes) return;
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, line, .{}) catch return;
        defer parsed.deinit();
        if (parsed.value != .object) return;
        if (session.harness == .fx) return manager.handleAcpLine(session, line, parsed.value.object);
        if (session.harness == .opencode) return manager.handleAcpLine(session, line, parsed.value.object);
        if (session.harness == .codex) return manager.handleCodexLine(session, line, parsed.value.object);
        if (session.harness == .claude) return manager.handleClaudeLine(session, line, parsed.value.object);
        const event_type = optionalString(parsed.value.object, "type") orelse return;
        if (std.mem.eql(u8, event_type, "response")) {
            const response_id = optionalString(parsed.value.object, "id") orelse return;
            try manager.mutex.lock(manager.io);
            defer manager.mutex.unlock(manager.io);
            if (session.responses.fetchRemove(response_id)) |previous| {
                manager.allocator.free(previous.key);
                manager.allocator.free(previous.value);
            }
            const key = try manager.allocator.dupe(u8, response_id);
            errdefer manager.allocator.free(key);
            try session.responses.put(manager.allocator, key, try manager.allocator.dupe(u8, line));
            return;
        }
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (std.mem.eql(u8, event_type, "agent_start")) session.active = true;
        if (std.mem.eql(u8, event_type, "agent_settled")) session.active = false;
        try manager.appendEvent(session, line);
    }

    fn handleAcpLine(manager: *Manager, session: *Session, line: []const u8, object: std.json.ObjectMap) !void {
        const method = optionalString(object, "method");
        const response_id = optionalString(object, "id");
        if (method == null and response_id == null) return;
        if (method) |name| if (std.mem.eql(u8, name, "session/request_permission")) {
            const id = object.get("id") orelse return;
            var response: Io.Writer.Allocating = .init(manager.allocator);
            defer response.deinit();
            try response.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
            try std.json.Stringify.value(id, .{}, &response.writer);
            try response.writer.writeAll(",\"result\":{\"outcome\":{\"outcome\":\"selected\",\"optionId\":\"allow_once\"}}}");
            try manager.send(session, response.writer.buffered());
        };
        try manager.mutex.lock(manager.io);
        errdefer manager.mutex.unlock(manager.io);
        if (method != null) {
            if (session.harness == .opencode and std.mem.eql(u8, method.?, "session/update")) try manager.observeOpenCodeSubagent(session, object);
            try manager.appendEvent(session, line);
            manager.mutex.unlock(manager.io);
            return;
        }
        const active_request_id = session.active_request_id;
        if (active_request_id == null or !std.mem.eql(u8, active_request_id.?, response_id.?)) {
            if (session.responses.fetchRemove(response_id.?)) |previous| {
                manager.allocator.free(previous.key);
                manager.allocator.free(previous.value);
            }
            const key = try manager.allocator.dupe(u8, response_id.?);
            errdefer manager.allocator.free(key);
            try session.responses.put(manager.allocator, key, try manager.allocator.dupe(u8, line));
            manager.mutex.unlock(manager.io);
            return;
        }
        manager.allocator.free(session.active_request_id.?);
        session.active_request_id = null;
        if (object.get("error")) |error_value| {
            if (isRetryableAcpError(error_value) and session.retry_count < 2) {
                session.retry_count += 1;
                session.active = true;
                session.resume_scheduled = true;
                try manager.appendAcpLifecycleEvent(session, "turn_retry", acpErrorMessage(error_value), null);
                manager.mutex.unlock(manager.io);
                try manager.tasks.concurrent(manager.io, resumeAcpPrompt, .{AcpResume{
                    .manager = manager,
                    .session = session,
                    .delay_ms = 250,
                    .wait_for_children = false,
                    .message = "The previous provider request was interrupted by a transient transport failure. Continue the current task from the existing session state without repeating completed work.",
                }});
                return;
            }
            session.active = false;
            session.waiting_for_children = false;
            session.resume_scheduled = false;
            try manager.setSessionError(session, acpErrorMessage(error_value));
            try manager.appendEvent(session, line);
            manager.mutex.unlock(manager.io);
            return;
        }
        if (session.harness == .opencode and session.pending_subagents.count() > 0) {
            if (session.continuation_count >= 8) {
                session.active = false;
                session.waiting_for_children = false;
                session.resume_scheduled = false;
                try manager.setSessionError(session, "Background subagents did not return control to the parent turn");
                try manager.appendAcpLifecycleEvent(session, "extension_error", session.last_error.?, null);
                manager.mutex.unlock(manager.io);
                return;
            }
            session.continuation_count += 1;
            session.active = true;
            session.waiting_for_children = true;
            session.resume_scheduled = true;
            try manager.appendAcpLifecycleEvent(session, "turn_waiting", "Waiting for background subagents", session.pending_subagents.count());
            manager.mutex.unlock(manager.io);
            try manager.tasks.concurrent(manager.io, resumeAcpPrompt, .{AcpResume{
                .manager = manager,
                .session = session,
                .delay_ms = 1000,
                .wait_for_children = true,
                .message = "Continue the current task. Wait for any background subagents that are still running, use every completed subagent result already present in this session, and return the complete answer instead of another progress update.",
            }});
            return;
        }
        session.active = false;
        session.waiting_for_children = false;
        session.resume_scheduled = false;
        try manager.setSessionError(session, null);
        try manager.appendEvent(session, line);
        manager.mutex.unlock(manager.io);
    }

    fn observeOpenCodeSubagent(manager: *Manager, session: *Session, object: std.json.ObjectMap) !void {
        const params = object.get("params") orelse return;
        if (params != .object) return;
        const update = params.object.get("update") orelse return;
        if (update != .object) return;
        const update_type = optionalString(update.object, "sessionUpdate") orelse return;
        const tool_call_id = optionalString(update.object, "toolCallId") orelse return;
        if (std.mem.indexOfScalar(u8, tool_call_id, ':') != null) return;
        if (std.mem.eql(u8, update_type, "tool_call") and std.mem.eql(u8, optionalString(update.object, "title") orelse "", "subagent")) {
            if (!session.pending_subagents.contains(tool_call_id)) try session.pending_subagents.put(manager.allocator, try manager.allocator.dupe(u8, tool_call_id), {});
            return;
        }
        if (!std.mem.eql(u8, update_type, "tool_call_update")) return;
        const status = optionalString(update.object, "status") orelse return;
        if (!std.mem.eql(u8, status, "completed") and !std.mem.eql(u8, status, "failed")) return;
        if (std.mem.eql(u8, status, "completed") and isBackgroundSubagentAcknowledgement(update.object)) return;
        if (session.pending_subagents.fetchRemove(tool_call_id)) |removed| manager.allocator.free(removed.key);
    }

    fn appendAcpLifecycleEvent(manager: *Manager, session: *Session, event_type: []const u8, message: []const u8, pending: ?usize) !void {
        var event: Io.Writer.Allocating = .init(manager.allocator);
        defer event.deinit();
        try event.writer.writeAll("{\"type\":");
        try std.json.Stringify.value(event_type, .{}, &event.writer);
        try event.writer.writeAll(",\"message\":");
        try std.json.Stringify.value(message, .{}, &event.writer);
        if (pending) |count| try event.writer.print(",\"pending\":{d}", .{count});
        try event.writer.writeByte('}');
        try manager.appendEvent(session, event.writer.buffered());
    }

    fn setSessionError(manager: *Manager, session: *Session, message: ?[]const u8) !void {
        if (session.last_error) |previous| manager.allocator.free(previous);
        session.last_error = if (message) |value| try manager.allocator.dupe(u8, value) else null;
    }

    fn handleCodexLine(manager: *Manager, session: *Session, line: []const u8, object: std.json.ObjectMap) !void {
        const event_type = optionalString(object, "type") orelse return;
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (std.mem.eql(u8, event_type, "thread.started")) if (optionalString(object, "thread_id")) |thread_id| {
            const owned = try manager.allocator.dupe(u8, thread_id);
            manager.allocator.free(session.native_id);
            session.native_id = owned;
        };
        if (std.mem.eql(u8, event_type, "turn.started")) session.active = true;
        if (std.mem.eql(u8, event_type, "turn.completed") or std.mem.eql(u8, event_type, "turn.failed")) session.active = false;
        try manager.appendEvent(session, line);
    }

    fn handleClaudeLine(manager: *Manager, session: *Session, _: []const u8, object: std.json.ObjectMap) !void {
        const event_type = optionalString(object, "type") orelse return;
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (std.mem.eql(u8, event_type, "system") and std.mem.eql(u8, optionalString(object, "subtype") orelse "", "init")) {
            if (optionalString(object, "session_id")) |native_id| {
                const owned = try manager.allocator.dupe(u8, native_id);
                manager.allocator.free(session.native_id);
                session.native_id = owned;
            }
            session.active = true;
            return manager.appendEvent(session, "{\"type\":\"agent_start\"}");
        }
        if (std.mem.eql(u8, event_type, "assistant")) return manager.appendClaudeAssistant(session, object);
        if (std.mem.eql(u8, event_type, "user")) return manager.appendClaudeToolResults(session, object);
        if (!std.mem.eql(u8, event_type, "result")) return;
        session.active = false;
        if (optionalBool(object, "is_error") orelse false) {
            var failure: Io.Writer.Allocating = .init(manager.allocator);
            defer failure.deinit();
            try failure.writer.writeAll("{\"type\":\"extension_error\",\"message\":");
            try std.json.Stringify.value(optionalString(object, "result") orelse "Claude Code turn failed", .{}, &failure.writer);
            try failure.writer.writeByte('}');
            try manager.appendEvent(session, failure.writer.buffered());
        }
        try manager.appendEvent(session, "{\"type\":\"agent_settled\"}");
    }

    fn appendClaudeAssistant(manager: *Manager, session: *Session, object: std.json.ObjectMap) !void {
        const message = object.get("message") orelse return;
        if (message != .object) return;
        const content = message.object.get("content") orelse return;
        if (content != .array) return;
        for (content.array.items) |block| {
            if (block != .object) continue;
            const block_type = optionalString(block.object, "type") orelse continue;
            var event: Io.Writer.Allocating = .init(manager.allocator);
            defer event.deinit();
            if (std.mem.eql(u8, block_type, "text") or std.mem.eql(u8, block_type, "thinking")) {
                try event.writer.writeAll("{\"type\":\"message_update\",\"assistantMessageEvent\":{\"type\":");
                try std.json.Stringify.value(if (std.mem.eql(u8, block_type, "thinking")) "thinking_delta" else "text_delta", .{}, &event.writer);
                try event.writer.writeAll(",\"delta\":");
                try std.json.Stringify.value(optionalString(block.object, block_type) orelse "", .{}, &event.writer);
                try event.writer.writeAll("}}");
            } else if (std.mem.eql(u8, block_type, "tool_use")) {
                try event.writer.writeAll("{\"type\":\"tool_execution_start\",\"toolCallId\":");
                try std.json.Stringify.value(optionalString(block.object, "id") orelse "claude-tool", .{}, &event.writer);
                try event.writer.writeAll(",\"toolName\":");
                try std.json.Stringify.value(optionalString(block.object, "name") orelse "tool", .{}, &event.writer);
                if (block.object.get("input")) |input| {
                    try event.writer.writeAll(",\"args\":");
                    try std.json.Stringify.value(input, .{}, &event.writer);
                }
                try event.writer.writeByte('}');
            } else continue;
            try manager.appendEvent(session, event.writer.buffered());
        }
    }

    fn appendClaudeToolResults(manager: *Manager, session: *Session, object: std.json.ObjectMap) !void {
        const message = object.get("message") orelse return;
        if (message != .object) return;
        const content = message.object.get("content") orelse return;
        if (content != .array) return;
        for (content.array.items) |block| {
            if (block != .object or !std.mem.eql(u8, optionalString(block.object, "type") orelse "", "tool_result")) continue;
            var event: Io.Writer.Allocating = .init(manager.allocator);
            defer event.deinit();
            try event.writer.writeAll("{\"type\":\"tool_execution_end\",\"toolCallId\":");
            try std.json.Stringify.value(optionalString(block.object, "tool_use_id") orelse "claude-tool", .{}, &event.writer);
            try event.writer.writeAll(",\"isError\":");
            try event.writer.writeAll(if (optionalBool(block.object, "is_error") orelse false) "true" else "false");
            if (block.object.get("content")) |result| {
                try event.writer.writeAll(",\"result\":{\"content\":");
                if (result == .string) {
                    try event.writer.writeAll("[{\"type\":\"text\",\"text\":");
                    try std.json.Stringify.value(result.string, .{}, &event.writer);
                    try event.writer.writeAll("}]");
                } else try std.json.Stringify.value(result, .{}, &event.writer);
                try event.writer.writeByte('}');
            }
            try event.writer.writeByte('}');
            try manager.appendEvent(session, event.writer.buffered());
        }
    }

    fn appendEvent(manager: *Manager, session: *Session, line: []const u8) !void {
        session.event_seq += 1;
        var timestamp: [24]u8 = undefined;
        _ = formatTimestamp(manager.io, &timestamp);
        try session.events.append(manager.allocator, .{
            .allocator = manager.allocator,
            .seq = session.event_seq,
            .document = try manager.allocator.dupe(u8, line),
            .timestamp = timestamp,
        }, LoggedEvent.deinit);
    }
};

const AcpResume = struct {
    manager: *Manager,
    session: *Session,
    delay_ms: i64,
    wait_for_children: bool,
    message: []const u8,
};

fn resumeAcpPrompt(task: AcpResume) Io.Cancelable!void {
    var wait_rounds: usize = 0;
    while (true) {
        try task.manager.io.sleep(.fromMilliseconds(if (wait_rounds == 0) task.delay_ms else 1000), .awake);
        try task.manager.mutex.lock(task.manager.io);
        if (!task.session.running or !task.session.active or !task.session.resume_scheduled or task.session.active_request_id != null) {
            task.manager.mutex.unlock(task.manager.io);
            return;
        }
        if (task.wait_for_children and task.session.pending_subagents.count() > 0 and wait_rounds < 1800) {
            wait_rounds += 1;
            task.manager.mutex.unlock(task.manager.io);
            continue;
        }
        break;
    }
    if (task.wait_for_children and task.session.pending_subagents.count() > 0) {
        task.session.resume_scheduled = false;
        task.session.active = false;
        task.session.waiting_for_children = false;
        task.manager.setSessionError(task.session, "Background subagents did not finish before the continuation deadline") catch {
            task.manager.mutex.unlock(task.manager.io);
            return;
        };
        task.manager.appendAcpLifecycleEvent(task.session, "extension_error", task.session.last_error.?, null) catch {
            task.manager.mutex.unlock(task.manager.io);
            return;
        };
        task.manager.mutex.unlock(task.manager.io);
        return;
    }
    task.session.resume_scheduled = false;
    task.manager.mutex.unlock(task.manager.io);
    task.manager.sendAcpPromptContinuation(task.session, task.message) catch |failure| {
        try task.manager.mutex.lock(task.manager.io);
        defer task.manager.mutex.unlock(task.manager.io);
        task.session.active = false;
        task.session.waiting_for_children = false;
        task.manager.setSessionError(task.session, @errorName(failure)) catch return;
        task.manager.appendAcpLifecycleEvent(task.session, "extension_error", task.session.last_error.?, null) catch return;
    };
}

fn acpErrorMessage(value: std.json.Value) []const u8 {
    if (value == .string) return value.string;
    if (value != .object) return "Harness request failed";
    return optionalString(value.object, "message") orelse "Harness request failed";
}

fn isRetryableAcpError(value: std.json.Value) bool {
    const message = acpErrorMessage(value);
    return std.mem.indexOf(u8, message, "ECONNRESET") != null or
        std.mem.indexOf(u8, message, "ETIMEDOUT") != null or
        std.mem.indexOf(u8, message, "EAI_AGAIN") != null or
        std.mem.indexOf(u8, message, "socket connection was closed") != null or
        std.mem.indexOf(u8, message, "connection reset") != null or
        std.mem.indexOf(u8, message, "temporarily unavailable") != null;
}

fn isBackgroundSubagentAcknowledgement(update: std.json.ObjectMap) bool {
    if (update.get("rawOutput")) |raw_output| if (raw_output == .object) {
        if (raw_output.object.get("metadata")) |metadata| if (metadata == .object) {
            if (std.mem.eql(u8, optionalString(metadata.object, "status") orelse "", "running")) return true;
        };
    };
    const content = update.get("content") orelse return false;
    if (content != .array) return false;
    for (content.array.items) |item| {
        if (item != .object) continue;
        const nested = item.object.get("content") orelse continue;
        if (nested != .object) continue;
        const text = optionalString(nested.object, "text") orelse continue;
        if (std.mem.indexOf(u8, text, "working in the background") != null) return true;
    }
    return false;
}

const ChatPrompt = struct {
    manager: *Manager,
    session: *Session,
    message: []u8,
    thinking: ?[]u8,
    browser_enabled: bool,
};

const ChatSinkContext = struct {
    manager: *Manager,
    session: *Session,

    fn emit(raw: *anyopaque, document: []const u8) !void {
        const context: *ChatSinkContext = @ptrCast(@alignCast(raw));
        try context.manager.handleLine(context.session, document);
    }
};

fn runChatPrompt(prompt: ChatPrompt) Io.Cancelable!void {
    defer prompt.manager.allocator.free(prompt.message);
    defer if (prompt.thinking) |value| prompt.manager.allocator.free(value);
    var context = ChatSinkContext{ .manager = prompt.manager, .session = prompt.session };
    if (prompt.session.chat) |*chat| {
        chat.prompt(prompt.message, prompt.thinking, prompt.browser_enabled, .{ .context = &context, .emit_fn = ChatSinkContext.emit });
    } else {
        ChatSinkContext.emit(&context, "{\"type\":\"extension_error\",\"message\":\"Chat runtime unavailable\"}") catch {};
        ChatSinkContext.emit(&context, "{\"type\":\"agent_settled\"}") catch {};
    }
}

fn directFxRequest(allocator: std.mem.Allocator, io: Io, child: *std.process.Child, request_id: []const u8, document: []const u8) ![]u8 {
    try child.stdin.?.writeStreamingAll(io, document);
    try child.stdin.?.writeStreamingAll(io, "\n");
    var pending: std.ArrayList(u8) = .empty;
    defer pending.deinit(allocator);
    var chunk: [64 * 1024]u8 = undefined;
    while (pending.items.len <= runtime_limits.harness_event_bytes) {
        const count = child.stdout.?.readStreaming(io, &.{&chunk}) catch |failure| switch (failure) {
            error.EndOfStream => return error.HarnessExited,
            else => return failure,
        };
        if (count == 0) return error.HarnessExited;
        try pending.appendSlice(allocator, chunk[0..count]);
        while (std.mem.indexOfScalar(u8, pending.items, '\n')) |newline| {
            const line = std.mem.trim(u8, pending.items[0..newline], " \t\r");
            var parsed = std.json.parseFromSlice(std.json.Value, allocator, line, .{}) catch {
                dropPrefix(&pending, newline + 1);
                continue;
            };
            const matches = parsed.value == .object and optionalString(parsed.value.object, "id") != null and std.mem.eql(u8, optionalString(parsed.value.object, "id").?, request_id);
            parsed.deinit();
            if (matches) return allocator.dupe(u8, line);
            dropPrefix(&pending, newline + 1);
        }
    }
    return error.HarnessResponseTooLarge;
}

fn acpSessionRequest(manager: *Manager, request_id: []const u8, controller_executable: []const u8, model_id: []const u8, session_id: []const u8, native_session_id: ?[]const u8, cwd: []const u8) ![]u8 {
    var request: Io.Writer.Allocating = .init(manager.allocator);
    errdefer request.deinit();
    try request.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
    try std.json.Stringify.value(request_id, .{}, &request.writer);
    try request.writer.writeAll(",\"method\":");
    try std.json.Stringify.value(if (native_session_id == null) "session/new" else "session/load", .{}, &request.writer);
    try request.writer.writeAll(",\"params\":{\"cwd\":");
    try std.json.Stringify.value(cwd, .{}, &request.writer);
    try request.writer.writeByte(',');
    if (native_session_id) |value| {
        try request.writer.writeAll("\"sessionId\":");
        try std.json.Stringify.value(value, .{}, &request.writer);
        try request.writer.writeByte(',');
    }
    try request.writer.writeAll("\"mcpServers\":[{\"name\":\"local-studio\",\"command\":");
    try std.json.Stringify.value(controller_executable, .{}, &request.writer);
    try request.writer.writeAll(",\"args\":[\"mcp-bridge\"],\"env\":[{\"name\":\"LOCAL_STUDIO_MCP_BRIDGE_URL\",\"value\":");
    try std.json.Stringify.value(manager.controller_origin, .{}, &request.writer);
    try request.writer.writeAll("},{\"name\":\"LOCAL_STUDIO_MCP_BRIDGE_MODEL\",\"value\":");
    try std.json.Stringify.value(model_id, .{}, &request.writer);
    try request.writer.writeAll("},{\"name\":\"LOCAL_STUDIO_MCP_BRIDGE_SESSION\",\"value\":");
    try std.json.Stringify.value(session_id, .{}, &request.writer);
    if (manager.controller_api_key) |key| {
        try request.writer.writeAll("},{\"name\":\"LOCAL_STUDIO_MCP_BRIDGE_KEY\",\"value\":");
        try std.json.Stringify.value(key, .{}, &request.writer);
    }
    try request.writer.writeAll("}]}]}}");
    return request.toOwnedSlice();
}

fn fxResponseSucceeded(allocator: std.mem.Allocator, document: []const u8) bool {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return false;
    defer parsed.deinit();
    return parsed.value == .object and parsed.value.object.get("error") == null and parsed.value.object.get("result") != null;
}

fn fxSessionId(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidHarnessResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidHarnessResponse;
    const result = parsed.value.object.get("result") orelse return error.InvalidHarnessResponse;
    if (result != .object) return error.InvalidHarnessResponse;
    return allocator.dupe(u8, requiredString(result.object, "sessionId") orelse return error.InvalidHarnessResponse);
}

fn dropPrefix(buffer: *std.ArrayList(u8), count: usize) void {
    const remaining = buffer.items[count..];
    std.mem.copyForwards(u8, buffer.items[0..remaining.len], remaining);
    buffer.items.len = remaining.len;
}

fn readHarness(manager: *Manager, session: *Session) Io.Cancelable!void {
    const child = if (session.child) |*value| value else return;
    var pending: std.ArrayList(u8) = .empty;
    defer pending.deinit(manager.allocator);
    var chunk: [64 * 1024]u8 = undefined;
    while (true) {
        const count = child.stdout.?.readStreaming(manager.io, &.{&chunk}) catch |failure| switch (failure) {
            error.EndOfStream => break,
            error.Canceled => return error.Canceled,
            else => break,
        };
        if (count == 0) break;
        pending.appendSlice(manager.allocator, chunk[0..count]) catch break;
        if (pending.items.len > runtime_limits.harness_event_bytes) {
            pending.clearRetainingCapacity();
            continue;
        }
        var consumed: usize = 0;
        while (std.mem.indexOfScalarPos(u8, pending.items, consumed, '\n')) |newline| {
            manager.handleLine(session, pending.items[consumed..newline]) catch {};
            consumed = newline + 1;
        }
        if (consumed > 0) {
            const remaining = pending.items[consumed..];
            std.mem.copyForwards(u8, pending.items[0..remaining.len], remaining);
            pending.items.len = remaining.len;
        }
    }
    if (pending.items.len > 0) manager.handleLine(session, pending.items) catch {};
    try manager.mutex.lock(manager.io);
    defer manager.mutex.unlock(manager.io);
    const term = if (child.id != null) child.wait(manager.io) catch null else null;
    session.running = false;
    session.active = false;
    if (term) |value| switch (value) {
        .exited => |code| {
            if (code != 0) session.last_error = std.fmt.allocPrint(manager.allocator, "{s} exited with code {d}", .{ session.harness.name(), code }) catch null;
        },
        .signal => |signal| {
            session.last_error = std.fmt.allocPrint(manager.allocator, "{s} exited on signal {d}", .{ session.harness.name(), @intFromEnum(signal) }) catch null;
        },
        else => {
            session.last_error = std.fmt.allocPrint(manager.allocator, "{s} exited unexpectedly", .{session.harness.name()}) catch null;
        },
    };
}

fn writeStatus(writer: *Io.Writer, session: *const Session) !void {
    try writer.print("{{\"running\":{},\"active\":{},\"harness\":", .{ session.running, session.active });
    try std.json.Stringify.value(session.harness.name(), .{}, writer);
    try writer.writeAll(",\"modelId\":");
    try std.json.Stringify.value(session.model_id, .{}, writer);
    try writer.writeAll(",\"cwd\":");
    try std.json.Stringify.value(session.cwd, .{}, writer);
    if (session.harness == .pi) {
        try writer.writeAll(",\"piSessionId\":");
        try std.json.Stringify.value(session.native_id, .{}, writer);
    }
    try writer.writeAll(",\"nativeSessionId\":");
    try std.json.Stringify.value(session.native_id, .{}, writer);
    try writer.writeAll(",\"harnessVersion\":");
    if (session.harness_version) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"capabilities\":");
    try harness_catalog.writeCapabilities(writer, session.harness.name());
    try writer.writeAll(",\"agentDir\":");
    try std.json.Stringify.value(session.session_dir, .{}, writer);
    try writer.print(",\"eventSeq\":{d},\"lastError\":", .{session.event_seq});
    if (session.last_error) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"contextUsage\":null}");
}

fn statusDocument(allocator: std.mem.Allocator, session: *const Session) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try writeStatus(&output.writer, session);
    return output.toOwnedSlice();
}

fn writeEvents(writer: *Io.Writer, session: *const Session, after: u64) !void {
    var wrote = false;
    for (session.events.values()) |event| if (event.seq > after) {
        if (wrote) try writer.writeByte(',');
        try writer.print("{{\"seq\":{d},\"harness\":", .{event.seq});
        try std.json.Stringify.value(session.harness.name(), .{}, writer);
        try writer.writeAll(",\"normalized\":");
        try harness_events.writeNormalized(session.allocator, writer, session.harness.name(), event.document);
        try writer.writeAll(",\"event\":");
        try harness_events.writeCanonical(session.allocator, writer, session.harness.name(), event.document);
        try writer.writeAll(",\"native\":");
        try writer.writeAll(event.document);
        try writer.writeAll(",\"timestamp\":");
        try std.json.Stringify.value(event.timestamp[0..], .{}, writer);
        try writer.writeByte('}');
        wrote = true;
    };
}

fn sessionIdFromDocument(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidSessionPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidSessionPayload;
    const id = optionalString(parsed.value.object, "sessionId") orelse "default";
    if (!harness_session_id.validRuntime(id)) return error.InvalidSessionId;
    return allocator.dupe(u8, id);
}

fn validateAcknowledgement(allocator: std.mem.Allocator, document: []const u8) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidHarnessResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidHarnessResponse;
    const success = parsed.value.object.get("success") orelse return error.InvalidHarnessResponse;
    if (success != .bool) return error.InvalidHarnessResponse;
    if (!success.bool) return error.HarnessCommandRejected;
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn optionalBool(object: std.json.ObjectMap, name: []const u8) ?bool {
    const value = object.get(name) orelse return null;
    return if (value == .bool) value.bool else null;
}

fn optionalUnsigned(object: std.json.ObjectMap, name: []const u8) ?u64 {
    const value = object.get(name) orelse return null;
    if (value != .integer or value.integer < 0) return null;
    return @intCast(value.integer);
}

fn requiredString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    return optionalString(object, name);
}

fn configAssignment(allocator: std.mem.Allocator, key: []const u8, value: anytype) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll(key);
    try output.writer.writeByte('=');
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn validEntryId(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |character| if (!std.ascii.isAlphanumeric(character) and character != '-' and character != '_') return false;
    return true;
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
