const std = @import("std");
const builtin = @import("builtin");
const harness_nodes = @import("../harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");
const sqlite = @import("../../storage/sqlite.zig");
const cdp = @import("cdp.zig");

const Io = std.Io;
const max_response_bytes = 512 * 1024;

const BrowserSession = struct {
    context_id: []u8,
    target_id: []u8,
    session_id: []u8,
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    environment: *const std.process.Environ.Map,
    data_dir: []u8,
    preference: []u8,
    mutex: Io.Mutex = .init,
    sessions: std.StringHashMapUnmanaged([]u8) = .empty,
    contexts: std.StringHashMapUnmanaged(BrowserSession) = .empty,
    devtools: ?cdp.Client = null,
    active_session: ?[]u8 = null,

    pub fn init(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, data_dir: []const u8) !Manager {
        const owned_data_dir = try allocator.dupe(u8, data_dir);
        errdefer allocator.free(owned_data_dir);
        return .{
            .allocator = allocator,
            .io = io,
            .environment = environment,
            .data_dir = owned_data_dir,
            .preference = try loadPreference(allocator, io, environment, data_dir),
        };
    }

    pub fn deinit(manager: *Manager) void {
        var iterator = manager.sessions.iterator();
        while (iterator.next()) |entry| {
            manager.allocator.free(entry.key_ptr.*);
            manager.allocator.free(entry.value_ptr.*);
        }
        manager.sessions.deinit(manager.allocator);
        var context_iterator = manager.contexts.iterator();
        while (context_iterator.next()) |entry| {
            manager.allocator.free(entry.key_ptr.*);
            manager.allocator.free(entry.value_ptr.context_id);
            manager.allocator.free(entry.value_ptr.target_id);
            manager.allocator.free(entry.value_ptr.session_id);
        }
        manager.contexts.deinit(manager.allocator);
        if (manager.devtools) |*client| client.deinit();
        if (manager.active_session) |value| manager.allocator.free(value);
        manager.allocator.free(manager.data_dir);
        manager.allocator.free(manager.preference);
        manager.* = undefined;
    }

    pub fn start(manager: *Manager) !void {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        try manager.ensureDevTools();
    }

    pub fn verbPayload(manager: *Manager, client: *std.http.Client, verb: []const u8, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, if (document.len == 0) "{}" else document, .{}) catch return error.InvalidBrowserPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidBrowserPayload;
        const session = sessionKey(parsed.value.object);
        if (std.mem.eql(u8, verb, "navigate")) {
            const raw_url = stringField(parsed.value.object, "url") orelse return browserError(manager.allocator, "valid public or localhost http(s) url required");
            if (manager.cdpPayload(session, verb, parsed.value.object)) |payload| return payload else |failure| std.log.warn("interactive browser navigation failed: {t}", .{failure});
            const page = fetchReadable(manager.allocator, manager.io, client, raw_url) catch return browserError(manager.allocator, "Browser navigation failed");
            defer page.deinit();
            try manager.remember(session, page.url);
            var output: Io.Writer.Allocating = .init(manager.allocator);
            errdefer output.deinit();
            try output.writer.writeAll("{\"ok\":true,\"data\":{\"url\":");
            try std.json.Stringify.value(page.url, .{}, &output.writer);
            try output.writer.writeAll(",\"title\":");
            try std.json.Stringify.value(page.title, .{}, &output.writer);
            try output.writer.writeAll(",\"readingMode\":true}}");
            return output.toOwnedSlice();
        }
        if (std.mem.eql(u8, verb, "get-url")) return manager.cdpPayload(session, verb, parsed.value.object) catch manager.urlPayload(session);
        if (std.mem.eql(u8, verb, "get-text") or std.mem.eql(u8, verb, "get-html")) {
            if (manager.cdpPayload(session, verb, parsed.value.object)) |payload| return payload else |failure| std.log.warn("interactive browser read failed: {t}", .{failure});
            const url = stringField(parsed.value.object, "url") orelse try manager.remembered(session) orelse return browserError(manager.allocator, "Browser unavailable");
            defer if (stringField(parsed.value.object, "url") == null) manager.allocator.free(url);
            const page = fetchReadable(manager.allocator, manager.io, client, url) catch return browserError(manager.allocator, "Browser fetch failed");
            defer page.deinit();
            try manager.remember(session, page.url);
            var output: Io.Writer.Allocating = .init(manager.allocator);
            errdefer output.deinit();
            try output.writer.writeAll("{\"ok\":true,\"data\":{");
            try std.json.Stringify.value(if (std.mem.eql(u8, verb, "get-text")) "text" else "html", .{}, &output.writer);
            try output.writer.writeByte(':');
            try std.json.Stringify.value(if (std.mem.eql(u8, verb, "get-text")) page.text else page.body, .{}, &output.writer);
            try output.writer.writeAll(",\"readingMode\":true}}");
            return output.toOwnedSlice();
        }
        return manager.cdpPayload(session, verb, parsed.value.object) catch browserError(manager.allocator, "Interactive browser operation failed");
    }

    pub fn fetchPayload(manager: *Manager, client: *std.http.Client, url: []const u8) ![]u8 {
        const page = try fetchReadable(manager.allocator, manager.io, client, url);
        defer page.deinit();
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"url\":");
        try std.json.Stringify.value(page.url, .{}, &output.writer);
        try output.writer.writeAll(",\"title\":");
        try std.json.Stringify.value(page.title, .{}, &output.writer);
        try output.writer.writeAll(",\"text\":");
        try std.json.Stringify.value(page.text, .{}, &output.writer);
        try output.writer.writeAll(",\"contentType\":");
        try std.json.Stringify.value(page.content_type, .{}, &output.writer);
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn statePayload(manager: *Manager) ![]u8 {
        const url = try manager.activeUrl();
        defer if (url) |value| manager.allocator.free(value);
        if (url == null) return manager.allocator.dupe(u8, "{\"ok\":false,\"error\":\"Browser unavailable\"}");
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"ok\":true,\"data\":{\"url\":");
        try std.json.Stringify.value(url.?, .{}, &output.writer);
        try output.writer.writeAll(",\"title\":\"\",\"canGoBack\":false,\"canGoForward\":false,\"readingMode\":true}}");
        return output.toOwnedSlice();
    }

    pub fn historyPayload(manager: *Manager, visited_only: bool) ![]u8 {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll(if (visited_only) "{\"ok\":true,\"data\":{\"visited\":[" else "{\"ok\":true,\"data\":{\"entries\":[");
        var iterator = manager.sessions.iterator();
        var first = true;
        while (iterator.next()) |entry| {
            if (!first) try output.writer.writeByte(',');
            if (visited_only) try std.json.Stringify.value(entry.value_ptr.*, .{}, &output.writer) else {
                try output.writer.writeAll("{\"action\":\"navigate\",\"url\":");
                try std.json.Stringify.value(entry.value_ptr.*, .{}, &output.writer);
                try output.writer.writeAll(",\"ok\":true}");
            }
            first = false;
        }
        try output.writer.writeAll("]}}");
        return output.toOwnedSlice();
    }

    pub fn enginesPayload(manager: *Manager) ![]u8 {
        const engines = try discoverEngines(manager.allocator, manager.io, manager.environment);
        defer {
            for (engines) |entry| {
                manager.allocator.free(entry.id);
                manager.allocator.free(entry.label);
                if (entry.path) |value| manager.allocator.free(value);
            }
            manager.allocator.free(engines);
        }
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        const override = manager.environment.get("LOCAL_STUDIO_CHROME_PATH");
        const selected = selectEngine(manager.io, engines, manager.preference, override);
        const preferred = engineById(engines, manager.preference);
        try output.writer.writeAll("{\"ok\":true,\"data\":{\"preference\":");
        try std.json.Stringify.value(manager.preference, .{}, &output.writer);
        try output.writer.print(",\"preferenceUnavailable\":{},\"override\":", .{preferred == null or preferred.?.path == null});
        if (override) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"active\":");
        if (selected) |entry| {
            try output.writer.writeAll("{\"id\":");
            try std.json.Stringify.value(entry.id, .{}, &output.writer);
            try output.writer.writeAll(",\"label\":");
            try std.json.Stringify.value(entry.label, .{}, &output.writer);
            try output.writer.writeAll(",\"path\":");
            try std.json.Stringify.value(entry.path.?, .{}, &output.writer);
            try output.writer.writeAll(",\"source\":");
            try std.json.Stringify.value(entry.source, .{}, &output.writer);
            try output.writer.writeByte('}');
        } else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"unavailableReason\":");
        if (selected == null) try std.json.Stringify.value("Interactive browser engine unavailable", .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"engines\":[");
        for (engines, 0..) |entry, index| {
            if (index > 0) try output.writer.writeByte(',');
            try output.writer.writeAll("{\"id\":");
            try std.json.Stringify.value(entry.id, .{}, &output.writer);
            try output.writer.writeAll(",\"label\":");
            try std.json.Stringify.value(entry.label, .{}, &output.writer);
            try output.writer.writeAll(",\"path\":");
            if (entry.path) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
            try output.writer.writeByte('}');
        }
        try output.writer.writeAll("]}}");
        return output.toOwnedSlice();
    }

    pub fn selectEnginePayload(manager: *Manager, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidBrowserPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidBrowserPayload;
        const requested = stringField(parsed.value.object, "engine") orelse return error.BrowserEngineRequired;
        const engine = normalizedEngine(requested);
        if (!validEngineId(engine)) return error.UnknownBrowserEngine;
        try manager.mutex.lock(manager.io);
        const replacement = manager.allocator.dupe(u8, engine) catch |failure| {
            manager.mutex.unlock(manager.io);
            return failure;
        };
        persistPreference(manager.allocator, manager.io, manager.data_dir, engine) catch |failure| {
            manager.allocator.free(replacement);
            manager.mutex.unlock(manager.io);
            return failure;
        };
        manager.allocator.free(manager.preference);
        manager.preference = replacement;
        manager.mutex.unlock(manager.io);
        return manager.enginesPayload();
    }

    fn remember(manager: *Manager, session_value: []const u8, url: []const u8) !void {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.sessions.getPtr(session_value)) |existing| {
            manager.allocator.free(existing.*);
            existing.* = try manager.allocator.dupe(u8, url);
        } else {
            try manager.sessions.put(manager.allocator, try manager.allocator.dupe(u8, session_value), try manager.allocator.dupe(u8, url));
        }
        if (manager.active_session) |value| manager.allocator.free(value);
        manager.active_session = try manager.allocator.dupe(u8, session_value);
    }

    fn remembered(manager: *Manager, session_value: []const u8) !?[]u8 {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        return if (manager.sessions.get(session_value)) |value| try manager.allocator.dupe(u8, value) else null;
    }

    fn activeUrl(manager: *Manager) !?[]u8 {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        const session = manager.active_session orelse return null;
        return if (manager.sessions.get(session)) |value| try manager.allocator.dupe(u8, value) else null;
    }

    fn urlPayload(manager: *Manager, session: []const u8) ![]u8 {
        const url = try manager.remembered(session);
        defer if (url) |value| manager.allocator.free(value);
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"ok\":true,\"data\":{\"url\":");
        try std.json.Stringify.value(url orelse "", .{}, &output.writer);
        try output.writer.writeAll(",\"title\":\"\"}}");
        return output.toOwnedSlice();
    }

    fn cdpPayload(manager: *Manager, session_key: []const u8, verb: []const u8, object: std.json.ObjectMap) ![]u8 {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        const browser_session = try manager.ensureBrowserSession(session_key);
        if (std.mem.eql(u8, verb, "navigate")) {
            const url = stringField(object, "url") orelse return error.InvalidBrowserPayload;
            try validateUrl(manager.io, url);
            var params: Io.Writer.Allocating = .init(manager.allocator);
            defer params.deinit();
            try params.writer.writeAll("{\"url\":");
            try std.json.Stringify.value(url, .{}, &params.writer);
            try params.writer.writeByte('}');
            const response = try manager.devtools.?.command(manager.allocator, "Page.navigate", params.writer.buffered(), browser_session.session_id);
            manager.allocator.free(response);
            for (0..50) |_| {
                const state = manager.evaluate(browser_session, "document.readyState");
                if (state) |value| {
                    defer manager.allocator.free(value);
                    if (std.mem.eql(u8, value, "complete") or std.mem.eql(u8, value, "interactive")) break;
                } else |_| {}
                try manager.io.sleep(.fromMilliseconds(100), .awake);
            }
            return manager.evaluatePayload(browser_session, "({url:location.href,title:document.title,readingMode:false})", null);
        }
        if (std.mem.eql(u8, verb, "get-url")) return manager.evaluatePayload(browser_session, "({url:location.href,title:document.title})", null);
        if (std.mem.eql(u8, verb, "get-text")) return manager.evaluatePayload(browser_session, "document.body?.innerText??''", "text");
        if (std.mem.eql(u8, verb, "get-html")) return manager.evaluatePayload(browser_session, "document.documentElement?.outerHTML??''", "html");
        if (std.mem.eql(u8, verb, "observe")) return manager.evaluatePayload(browser_session, "Array.from(document.querySelectorAll('a,button,input,textarea,select,[role]')).slice(0,500).map((e,index)=>({index,tag:e.tagName.toLowerCase(),role:e.getAttribute('role'),text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').trim().slice(0,500),name:e.getAttribute('name'),type:e.getAttribute('type'),href:e.href||null,disabled:!!e.disabled}))", "elements");
        if (std.mem.eql(u8, verb, "click")) {
            const selector = stringField(object, "selector") orelse return error.InvalidBrowserPayload;
            const expression = try selectorExpression(manager.allocator, selector, null, .click);
            defer manager.allocator.free(expression);
            return manager.evaluatePayload(browser_session, expression, "result");
        }
        if (std.mem.eql(u8, verb, "type")) {
            const selector = stringField(object, "selector") orelse return error.InvalidBrowserPayload;
            const text = stringField(object, "text") orelse return error.InvalidBrowserPayload;
            const expression = try selectorExpression(manager.allocator, selector, text, .type_text);
            defer manager.allocator.free(expression);
            return manager.evaluatePayload(browser_session, expression, "result");
        }
        if (std.mem.eql(u8, verb, "screenshot")) {
            const response = try manager.devtools.?.command(manager.allocator, "Page.captureScreenshot", "{\"format\":\"png\"}", browser_session.session_id);
            defer manager.allocator.free(response);
            return resultFieldPayload(manager.allocator, response, "data", "image");
        }
        if (std.mem.eql(u8, verb, "network")) return manager.evaluatePayload(browser_session, "performance.getEntriesByType('resource').slice(-200).map(e=>({name:e.name,initiatorType:e.initiatorType,duration:e.duration,transferSize:e.transferSize}))", "entries");
        return error.InvalidBrowserPath;
    }

    fn ensureBrowserSession(manager: *Manager, session_key: []const u8) !*BrowserSession {
        if (manager.contexts.getPtr(session_key)) |existing| return existing;
        try manager.ensureDevTools();
        const context_response = manager.devtools.?.command(manager.allocator, "Target.createBrowserContext", "{}", null) catch null;
        defer if (context_response) |value| manager.allocator.free(value);
        const context_id = if (context_response) |value| try resultString(manager.allocator, value, "browserContextId") else try manager.allocator.dupe(u8, "");
        errdefer manager.allocator.free(context_id);
        const target_id = try manager.devtools.?.createTarget(manager.allocator, session_key, if (context_id.len > 0) context_id else null);
        errdefer manager.allocator.free(target_id);
        var attach_params: Io.Writer.Allocating = .init(manager.allocator);
        defer attach_params.deinit();
        try attach_params.writer.writeAll("{\"flatten\":true,\"targetId\":");
        try std.json.Stringify.value(target_id, .{}, &attach_params.writer);
        try attach_params.writer.writeByte('}');
        const attach_response = try manager.devtools.?.command(manager.allocator, "Target.attachToTarget", attach_params.writer.buffered(), null);
        defer manager.allocator.free(attach_response);
        const session_id = try resultString(manager.allocator, attach_response, "sessionId");
        errdefer manager.allocator.free(session_id);
        const enable_response = try manager.devtools.?.command(manager.allocator, "Page.enable", "{}", session_id);
        manager.allocator.free(enable_response);
        const owned_key = try manager.allocator.dupe(u8, session_key);
        errdefer manager.allocator.free(owned_key);
        try manager.contexts.put(manager.allocator, owned_key, .{ .context_id = context_id, .target_id = target_id, .session_id = session_id });
        return manager.contexts.getPtr(session_key).?;
    }

    fn ensureDevTools(manager: *Manager) !void {
        if (manager.devtools != null) return;
        const engines = try discoverEngines(manager.allocator, manager.io, manager.environment);
        defer {
            for (engines) |entry| {
                manager.allocator.free(entry.id);
                manager.allocator.free(entry.label);
                if (entry.path) |value| manager.allocator.free(value);
            }
            manager.allocator.free(engines);
        }
        const selected = selectEngine(manager.io, engines, manager.preference, manager.environment.get("LOCAL_STUDIO_CHROME_PATH")) orelse return error.BrowserInteractiveUnavailable;
        const host_script = if (std.mem.eql(u8, selected.id, "bundled")) manager.environment.get("LOCAL_STUDIO_BROWSER_HOST_SCRIPT") else null;
        manager.devtools = try cdp.Client.start(manager.allocator, manager.io, selected.path.?, host_script, manager.data_dir);
    }

    fn evaluate(manager: *Manager, browser_session: *const BrowserSession, expression: []const u8) ![]u8 {
        var params: Io.Writer.Allocating = .init(manager.allocator);
        defer params.deinit();
        try params.writer.writeAll("{\"awaitPromise\":true,\"returnByValue\":true,\"expression\":");
        try std.json.Stringify.value(expression, .{}, &params.writer);
        try params.writer.writeByte('}');
        const response = try manager.devtools.?.command(manager.allocator, "Runtime.evaluate", params.writer.buffered(), browser_session.session_id);
        defer manager.allocator.free(response);
        return evaluationString(manager.allocator, response);
    }

    fn evaluatePayload(manager: *Manager, browser_session: *const BrowserSession, expression: []const u8, field: ?[]const u8) ![]u8 {
        var params: Io.Writer.Allocating = .init(manager.allocator);
        defer params.deinit();
        try params.writer.writeAll("{\"awaitPromise\":true,\"returnByValue\":true,\"expression\":");
        try std.json.Stringify.value(expression, .{}, &params.writer);
        try params.writer.writeByte('}');
        const response = try manager.devtools.?.command(manager.allocator, "Runtime.evaluate", params.writer.buffered(), browser_session.session_id);
        defer manager.allocator.free(response);
        return evaluationPayload(manager.allocator, response, field);
    }
};

const SelectorAction = enum { click, type_text };

fn selectorExpression(allocator: std.mem.Allocator, selector: []const u8, text: ?[]const u8, action: SelectorAction) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    if (action == .click) {
        try output.writer.writeAll("(s=>{const e=document.querySelector(s);if(!e)return {ok:false,error:'element not found'};e.scrollIntoView({block:'center'});e.click();return {ok:true}})(");
        try std.json.Stringify.value(selector, .{}, &output.writer);
        try output.writer.writeByte(')');
    } else {
        try output.writer.writeAll("((s,v)=>{const e=document.querySelector(s);if(!e)return {ok:false,error:'element not found'};e.focus();const p=Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value');if(p?.set)p.set.call(e,v);else e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true}})(");
        try std.json.Stringify.value(selector, .{}, &output.writer);
        try output.writer.writeByte(',');
        try std.json.Stringify.value(text orelse "", .{}, &output.writer);
        try output.writer.writeByte(')');
    }
    return output.toOwnedSlice();
}

fn resultString(allocator: std.mem.Allocator, document: []const u8, field: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidDevToolsResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidDevToolsResponse;
    const result = parsed.value.object.get("result") orelse return error.InvalidDevToolsResponse;
    if (result != .object) return error.InvalidDevToolsResponse;
    const value = result.object.get(field) orelse return error.InvalidDevToolsResponse;
    if (value != .string) return error.InvalidDevToolsResponse;
    return allocator.dupe(u8, value.string);
}

fn evaluationValue(document: []const u8, allocator: std.mem.Allocator) !std.json.Parsed(std.json.Value) {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidDevToolsResponse;
    errdefer parsed.deinit();
    if (parsed.value != .object) return error.InvalidDevToolsResponse;
    const command_result = parsed.value.object.get("result") orelse return error.InvalidDevToolsResponse;
    if (command_result != .object) return error.InvalidDevToolsResponse;
    const runtime_result = command_result.object.get("result") orelse return error.InvalidDevToolsResponse;
    if (runtime_result != .object or runtime_result.object.get("exceptionDetails") != null) return error.DevToolsEvaluationFailed;
    if (runtime_result.object.get("value") == null) return error.InvalidDevToolsResponse;
    return parsed;
}

fn evaluationString(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = try evaluationValue(document, allocator);
    defer parsed.deinit();
    const value = parsed.value.object.get("result").?.object.get("result").?.object.get("value").?;
    if (value != .string) return error.InvalidDevToolsResponse;
    return allocator.dupe(u8, value.string);
}

fn evaluationPayload(allocator: std.mem.Allocator, document: []const u8, field: ?[]const u8) ![]u8 {
    var parsed = try evaluationValue(document, allocator);
    defer parsed.deinit();
    const value = parsed.value.object.get("result").?.object.get("result").?.object.get("value").?;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"data\":");
    if (field) |name| {
        try output.writer.writeByte('{');
        try std.json.Stringify.value(name, .{}, &output.writer);
        try output.writer.writeByte(':');
        try std.json.Stringify.value(value, .{}, &output.writer);
        try output.writer.writeByte('}');
    } else try std.json.Stringify.value(value, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn resultFieldPayload(allocator: std.mem.Allocator, document: []const u8, source_field: []const u8, output_field: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidDevToolsResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidDevToolsResponse;
    const result = parsed.value.object.get("result") orelse return error.InvalidDevToolsResponse;
    if (result != .object) return error.InvalidDevToolsResponse;
    const value = result.object.get(source_field) orelse return error.InvalidDevToolsResponse;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"data\":{");
    try std.json.Stringify.value(output_field, .{}, &output.writer);
    try output.writer.writeByte(':');
    try std.json.Stringify.value(value, .{}, &output.writer);
    try output.writer.writeAll("}}");
    return output.toOwnedSlice();
}

pub fn remotePayload(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, database: *sqlite.Database, target: []const u8, method: std.http.Method, document: ?[]const u8, preferred_node: ?[]const u8) ![]u8 {
    var node = (try harness_nodes.selectCapability(allocator, io, database, "browser", preferred_node)) orelse return error.BrowserNodeRequired;
    defer node.deinit();
    const prefix = "/api/agent/browser";
    if (!std.mem.startsWith(u8, target, prefix)) return error.InvalidBrowserPath;
    const path = try std.fmt.allocPrint(allocator, "/internal/node/v1/browser{s}", .{target[prefix.len..]});
    defer allocator.free(path);
    return if (method == .GET)
        node_transport.get(allocator, client, &node, path) catch |failure| switch (failure) {
            error.NodeUnavailable => error.BrowserNodeUnavailable,
            else => failure,
        }
    else
        node_transport.send(allocator, client, &node, path, method, document) catch |failure| switch (failure) {
            error.NodeRequestRejected => error.BrowserNodeUnavailable,
            else => failure,
        };
}

const Page = struct {
    allocator: std.mem.Allocator,
    url: []u8,
    title: []u8,
    text: []u8,
    body: []u8,
    content_type: []u8,

    fn deinit(page: *const Page) void {
        page.allocator.free(page.url);
        page.allocator.free(page.title);
        page.allocator.free(page.text);
        page.allocator.free(page.body);
        page.allocator.free(page.content_type);
    }
};

fn fetchReadable(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, raw_url: []const u8) !Page {
    try validateUrl(io, raw_url);
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var body: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = raw_url },
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = &.{
            .{ .name = "Accept", .value = "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5" },
            .{ .name = "User-Agent", .value = "Local-Studio-Zig/1.0" },
        },
        .response_writer = &body,
    });
    if (@intFromEnum(response.status) >= 300 and @intFromEnum(response.status) < 400) return error.BrowserRedirectUnsupported;
    if (response.status.class() != .success) return error.BrowserUpstreamRejected;
    const content_type = "text/html";
    const owned_body = try allocator.dupe(u8, body.buffered());
    errdefer allocator.free(owned_body);
    const title = try htmlTitle(allocator, owned_body, raw_url);
    errdefer allocator.free(title);
    const text = try readableText(allocator, owned_body);
    errdefer allocator.free(text);
    return .{
        .allocator = allocator,
        .url = try allocator.dupe(u8, raw_url),
        .title = title,
        .text = text,
        .body = owned_body,
        .content_type = try allocator.dupe(u8, content_type),
    };
}

fn validateUrl(io: Io, raw_url: []const u8) !void {
    if (raw_url.len == 0 or raw_url.len > 8192) return error.InvalidBrowserUrl;
    const uri = std.Uri.parse(raw_url) catch return error.InvalidBrowserUrl;
    if (!std.ascii.eqlIgnoreCase(uri.scheme, "http") and !std.ascii.eqlIgnoreCase(uri.scheme, "https")) return error.InvalidBrowserUrl;
    var host_buffer: [Io.net.HostName.max_len]u8 = undefined;
    const host = (try uri.getHost(&host_buffer)).bytes;
    const loopback_name = std.ascii.eqlIgnoreCase(host, "localhost");
    var lookup_buffer: [32]Io.net.HostName.LookupResult = undefined;
    var queue: Io.Queue(Io.net.HostName.LookupResult) = .init(&lookup_buffer);
    var future = io.async(Io.net.HostName.lookup, .{ try Io.net.HostName.init(host), io, &queue, .{ .port = uri.port orelse if (std.ascii.eqlIgnoreCase(uri.scheme, "https")) 443 else 80 } });
    defer future.cancel(io) catch {};
    var found = false;
    while (queue.getOne(io)) |result| switch (result) {
        .canonical_name => {},
        .address => |address| {
            found = true;
            if (!addressAllowed(address, loopback_name)) return error.BrowserAddressRejected;
        },
    } else |failure| switch (failure) {
        error.Closed => try future.await(io),
        else => return failure,
    }
    if (!found) return error.BrowserAddressRejected;
}

fn addressAllowed(address: Io.net.IpAddress, allow_loopback: bool) bool {
    return switch (address) {
        .ip4 => |value| blk: {
            const b = value.bytes;
            const loopback = b[0] == 127;
            if (loopback) break :blk allow_loopback;
            break :blk b[0] != 10 and !(b[0] == 172 and b[1] >= 16 and b[1] <= 31) and !(b[0] == 192 and b[1] == 168) and !(b[0] == 169 and b[1] == 254) and b[0] != 0 and b[0] < 224;
        },
        .ip6 => |value| blk: {
            const b = value.bytes;
            const loopback = std.mem.allEqual(u8, b[0..15], 0) and b[15] == 1;
            if (loopback) break :blk allow_loopback;
            break :blk (b[0] & 0xfe) != 0xfc and !(b[0] == 0xfe and (b[1] & 0xc0) == 0x80) and !std.mem.allEqual(u8, &b, 0);
        },
    };
}

fn htmlTitle(allocator: std.mem.Allocator, body: []const u8, fallback: []const u8) ![]u8 {
    const start = std.ascii.indexOfIgnoreCase(body, "<title");
    if (start) |index| {
        const close = std.mem.findScalarPos(u8, body, index, '>') orelse return allocator.dupe(u8, fallback);
        const end = std.ascii.indexOfIgnoreCase(body[close + 1 ..], "</title>") orelse return allocator.dupe(u8, fallback);
        return allocator.dupe(u8, std.mem.trim(u8, body[close + 1 .. close + 1 + end], " \t\r\n"));
    }
    return allocator.dupe(u8, fallback);
}

fn readableText(allocator: std.mem.Allocator, body: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    var in_tag = false;
    var pending_space = false;
    for (body) |character| {
        if (character == '<') {
            in_tag = true;
            pending_space = true;
        } else if (character == '>') {
            in_tag = false;
        } else if (!in_tag) {
            if (std.ascii.isWhitespace(character)) {
                pending_space = true;
            } else {
                if (pending_space and output.writer.buffered().len > 0) try output.writer.writeByte(' ');
                try output.writer.writeByte(character);
                pending_space = false;
            }
        }
    }
    return output.toOwnedSlice();
}

const Engine = struct { id: []u8, label: []u8, path: ?[]u8 };
const ResolvedEngine = struct { id: []const u8, label: []const u8, path: ?[]const u8, source: []const u8 };

fn discoverEngines(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map) ![]Engine {
    const candidates: []const [3][]const u8 = switch (builtin.os.tag) {
        .macos => &[_][3][]const u8{
            .{ "chrome", "Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
            .{ "chromium", "Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium" },
            .{ "brave", "Brave", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
            .{ "edge", "Microsoft Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
            .{ "arc", "Arc", "/Applications/Arc.app/Contents/MacOS/Arc" },
            .{ "vivaldi", "Vivaldi", "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi" },
        },
        .linux => &[_][3][]const u8{
            .{ "chromium", "Chromium", "/usr/bin/chromium" },
            .{ "chrome", "Google Chrome", "/usr/bin/google-chrome" },
            .{ "brave", "Brave", "/usr/bin/brave-browser" },
            .{ "edge", "Microsoft Edge", "/usr/bin/microsoft-edge" },
            .{ "vivaldi", "Vivaldi", "/usr/bin/vivaldi" },
        },
        else => &[_][3][]const u8{},
    };
    var engines = try allocator.alloc(Engine, candidates.len + 1);
    const bundled = environment.get("LOCAL_STUDIO_BUNDLED_CHROMIUM_PATH");
    engines[0] = .{ .id = try allocator.dupe(u8, "bundled"), .label = try allocator.dupe(u8, "Bundled Chromium"), .path = if (bundled) |value| if (pathAvailable(io, value)) try allocator.dupe(u8, value) else null else null };
    for (candidates, 0..) |candidate, index| engines[index + 1] = .{
        .id = try allocator.dupe(u8, candidate[0]),
        .label = try allocator.dupe(u8, candidate[1]),
        .path = if (pathAvailable(io, candidate[2])) try allocator.dupe(u8, candidate[2]) else null,
    };
    return engines;
}

fn selectEngine(io: Io, engines: []const Engine, preference: []const u8, override: ?[]const u8) ?ResolvedEngine {
    if (override) |path| if (pathAvailable(io, path)) return .{ .id = "custom", .label = "Custom", .path = path, .source = "override" };
    if (engineById(engines, preference)) |entry| if (entry.path != null) return .{ .id = entry.id, .label = entry.label, .path = entry.path, .source = if (std.mem.eql(u8, entry.id, "bundled")) "bundled" else "preference" };
    if (engineById(engines, "bundled")) |entry| if (entry.path != null) return .{ .id = entry.id, .label = entry.label, .path = entry.path, .source = "bundled" };
    for (engines) |entry| if (entry.path != null) return .{ .id = entry.id, .label = entry.label, .path = entry.path, .source = "detected" };
    return null;
}

fn engineById(engines: []const Engine, id: []const u8) ?Engine {
    for (engines) |entry| if (std.mem.eql(u8, entry.id, id)) return entry;
    return null;
}

fn pathAvailable(io: Io, path: []const u8) bool {
    if (!std.fs.path.isAbsolute(path)) return false;
    _ = Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return true;
}

fn loadPreference(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, data_dir: []const u8) ![]u8 {
    const preference_path = try std.fs.path.join(allocator, &.{ data_dir, "browser-engine.json" });
    defer allocator.free(preference_path);
    const document = Io.Dir.cwd().readFileAlloc(io, preference_path, allocator, .limited(4096)) catch |failure| switch (failure) {
        error.FileNotFound => null,
        else => return failure,
    };
    if (document) |value| {
        defer allocator.free(value);
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, value, .{}) catch null;
        if (parsed) |*body| {
            defer body.deinit();
            if (body.value == .object) if (stringField(body.value.object, "engine")) |engine| if (validEngineId(normalizedEngine(engine))) return allocator.dupe(u8, normalizedEngine(engine));
        }
    }
    const configured = normalizedEngine(environment.get("LOCAL_STUDIO_BROWSER_ENGINE") orelse "bundled");
    return allocator.dupe(u8, if (validEngineId(configured)) configured else "bundled");
}

fn persistPreference(allocator: std.mem.Allocator, io: Io, data_dir: []const u8, engine: []const u8) !void {
    const preference_path = try std.fs.path.join(allocator, &.{ data_dir, "browser-engine.json" });
    defer allocator.free(preference_path);
    var output: Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"engine\":");
    try std.json.Stringify.value(engine, .{}, &output.writer);
    try output.writer.writeByte('}');
    var atomic_file = try Io.Dir.cwd().createFileAtomic(io, preference_path, .{ .permissions = @enumFromInt(0o600), .make_path = true, .replace = true });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, output.writer.buffered());
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
}

fn validEngineId(value: []const u8) bool {
    for ([_][]const u8{ "bundled", "chrome", "chromium", "brave", "edge", "arc", "vivaldi" }) |candidate| if (std.mem.eql(u8, value, candidate)) return true;
    return false;
}

fn normalizedEngine(value: []const u8) []const u8 {
    return if (std.mem.eql(u8, value, "auto")) "bundled" else value;
}

fn sessionKey(object: std.json.ObjectMap) []const u8 {
    const value = stringField(object, "sessionId") orelse return "shared";
    if (value.len > 128) return "shared";
    for (value) |character| if (!std.ascii.isAlphanumeric(character) and character != '.' and character != '_' and character != ':' and character != '-') return "shared";
    return value;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}

fn browserError(allocator: std.mem.Allocator, message: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"ok\":false,\"error\":");
    try std.json.Stringify.value(message, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}
