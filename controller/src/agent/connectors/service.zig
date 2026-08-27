const std = @import("std");
const config = @import("../../app/config.zig");
const repository = @import("store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const harness_nodes = @import("../harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");
const connector_runtime = @import("runtime.zig");
const mcp_client = @import("../mcp/client.zig");
const mcp_catalog = @import("../mcp/catalog.zig");
const google_workspace = @import("../../accounts/google/workspace.zig");

const Io = std.Io;
const http = std.http;
const mask = "••••••••";

pub fn sshPathPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8) ![]u8 {
    if (mode == .standalone) return sshPathLocal(allocator, io);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    return node_transport.get(allocator, client, &target, "/internal/node/v1/connectors/ssh-server-path") catch |failure| switch (failure) {
        error.NodeUnavailable => error.ConnectorNodeUnavailable,
        else => failure,
    };
}

pub fn sshPathLocal(allocator: std.mem.Allocator, io: Io) ![]u8 {
    const executable = try std.process.executablePathAlloc(io, allocator);
    defer allocator.free(executable);
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"path\":");
    try std.json.Stringify.value(executable, .{}, &output.writer);
    try output.writer.writeAll(",\"args\":[\"mcp-ssh\"]}");
    return output.toOwnedSlice();
}

pub fn listPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8) ![]u8 {
    if (mode == .standalone) return listLocal(allocator, io, database);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    return node_transport.get(allocator, client, &target, "/internal/node/v1/connectors") catch |failure| switch (failure) {
        error.NodeUnavailable => error.ConnectorNodeUnavailable,
        else => failure,
    };
}

pub fn upsertPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, document: []const u8) ![]u8 {
    if (mode == .standalone) return upsertLocal(allocator, io, database, document);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    return node_transport.send(allocator, client, &target, "/internal/node/v1/connectors", .POST, document) catch |failure| switch (failure) {
        error.NodeRequestRejected => error.ConnectorNodeRejected,
        else => failure,
    };
}

pub fn deletePayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, id: []const u8) ![]u8 {
    if (!validId(id)) return error.InvalidConnectorId;
    if (mode == .standalone) return deleteLocal(allocator, io, database, id);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    const path = try std.fmt.allocPrint(allocator, "/internal/node/v1/connectors?id={s}", .{id});
    defer allocator.free(path);
    return node_transport.send(allocator, client, &target, path, .DELETE, null) catch |failure| switch (failure) {
        error.NodeRequestRejected => error.ConnectorNodeRejected,
        else => failure,
    };
}

pub fn listLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database) ![]u8 {
    try database.lock(io);
    var connectors = repository.list(allocator, database) catch |failure| {
        database.unlock(io);
        return failure;
    };
    database.unlock(io);
    defer connectors.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"connectors\":[");
    for (connectors.documents, 0..) |document, index| {
        if (index > 0) try output.writer.writeByte(',');
        try writeView(allocator, &output.writer, document);
    }
    try output.writer.writeAll("],\"catalog\":");
    try mcp_catalog.write(&output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

pub fn upsertLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, document: []const u8) ![]u8 {
    var incoming = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidConnectorPayload;
    defer incoming.deinit();
    if (incoming.value != .object) return error.InvalidConnectorPayload;
    const object = &incoming.value.object;
    const id = stringField(object.*, "id") orelse return error.ConnectorIdRequired;
    if (!validId(id)) return error.InvalidConnectorId;
    const transport = stringField(object.*, "transport") orelse return error.ConnectorTransportRequired;
    if (!std.mem.eql(u8, transport, "stdio") and !std.mem.eql(u8, transport, "http")) return error.InvalidConnectorTransport;
    if (std.mem.eql(u8, transport, "stdio") and stringField(object.*, "command") == null and object.get("runtime") == null) return error.ConnectorCommandRequired;
    if (object.get("runtime")) |runtime| {
        if (!std.mem.eql(u8, transport, "stdio")) return error.InvalidConnectorRuntime;
        try connector_runtime.validate(runtime);
    }
    if (std.mem.eql(u8, transport, "http")) {
        const url = stringField(object.*, "url") orelse return error.ConnectorUrlRequired;
        const uri = std.Uri.parse(url) catch return error.InvalidConnectorUrl;
        if ((!std.ascii.eqlIgnoreCase(uri.scheme, "http") and !std.ascii.eqlIgnoreCase(uri.scheme, "https")) or uri.host == null) return error.InvalidConnectorUrl;
    }
    try validateOptionalFields(object.*);
    try database.lock(io);
    defer database.unlock(io);
    var connectors = try repository.list(allocator, database);
    defer connectors.deinit();
    for (connectors.documents) |stored_document| {
        var candidate = std.json.parseFromSlice(std.json.Value, allocator, stored_document, .{}) catch continue;
        defer candidate.deinit();
        if (candidate.value != .object) continue;
        const candidate_id = stringField(candidate.value.object, "id") orelse continue;
        if (!std.mem.eql(u8, candidate_id, id) and samePrefix(candidate_id, id)) return error.ConnectorNamespaceCollision;
    }
    const stored_document = try repository.get(allocator, database, id);
    defer if (stored_document) |value| allocator.free(value);
    var stored = if (stored_document) |value| try std.json.parseFromSlice(std.json.Value, allocator, value, .{}) else null;
    defer if (stored) |*value| value.deinit();
    if (stored) |*value| if (value.value == .object) {
        try preserveFields(incoming.arena.allocator(), object, value.value.object);
        restoreSecrets(object, value.value.object, "env", "envSecret");
        restoreSecrets(object, value.value.object, "headers", "headerSecret");
    };
    const arena = incoming.arena.allocator();
    const name = stringField(object.*, "name") orelse id;
    try object.put(arena, "name", .{ .string = try arena.dupe(u8, name) });
    const enabled = booleanField(object.*, "enabled") orelse true;
    try object.put(arena, "enabled", .{ .bool = enabled });
    _ = object.orderedRemove("allowTools");
    const stored_value = try stringify(allocator, incoming.value);
    defer allocator.free(stored_value);
    try repository.save(database, id, enabled, stored_value);
    return listLocked(allocator, database);
}

pub fn deleteLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) ![]u8 {
    if (!validId(id)) return error.InvalidConnectorId;
    try database.lock(io);
    defer database.unlock(io);
    try repository.delete(database, id);
    try repository.deleteConnectorGrants(database, id);
    return listLocked(allocator, database);
}

pub fn connectOAuthLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, account: ?[]const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    const stored_document = try repository.get(allocator, database, "github");
    defer if (stored_document) |value| allocator.free(value);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, stored_document orelse "{}", .{}) catch return error.InvalidConnectorRecord;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidConnectorRecord;
    const arena = parsed.arena.allocator();
    const object = &parsed.value.object;
    try object.put(arena, "id", .{ .string = "github" });
    const name = if (account) |value| try std.fmt.allocPrint(arena, "GitHub · {s}", .{value}) else "GitHub";
    try object.put(arena, "name", .{ .string = name });
    try object.put(arena, "transport", .{ .string = "stdio" });
    _ = object.orderedRemove("command");
    _ = object.orderedRemove("args");
    var runtime: std.json.ObjectMap = .empty;
    try runtime.put(arena, "kind", .{ .string = "node" });
    try runtime.put(arena, "package", .{ .string = mcp_catalog.github_package });
    try runtime.put(arena, "version", .{ .string = mcp_catalog.github_version });
    try runtime.put(arena, "executable", .{ .string = mcp_catalog.github_executable });
    try object.put(arena, "runtime", .{ .object = runtime });
    try object.put(arena, "protocolEra", .{ .string = "legacy" });
    var auth: std.json.ObjectMap = .empty;
    try auth.put(arena, "type", .{ .string = "oauth" });
    try auth.put(arena, "provider", .{ .string = "github" });
    try auth.put(arena, "account", .{ .string = account orelse "github" });
    try object.put(arena, "auth", .{ .object = auth });
    const enabled = booleanField(object.*, "enabled") orelse false;
    try object.put(arena, "enabled", .{ .bool = enabled });
    removeOAuthEnv(object);
    const document = try stringify(allocator, parsed.value);
    defer allocator.free(document);
    try repository.save(database, "github", enabled, document);
}

pub fn disconnectOAuthLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database) !void {
    try database.lock(io);
    defer database.unlock(io);
    const stored_document = (try repository.get(allocator, database, "github")) orelse return;
    defer allocator.free(stored_document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, stored_document, .{}) catch return error.InvalidConnectorRecord;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidConnectorRecord;
    const object = &parsed.value.object;
    _ = object.orderedRemove("auth");
    try object.put(parsed.arena.allocator(), "name", .{ .string = "GitHub" });
    try object.put(parsed.arena.allocator(), "enabled", .{ .bool = false });
    removeOAuthEnv(object);
    const document = try stringify(allocator, parsed.value);
    defer allocator.free(document);
    try repository.save(database, "github", false, document);
}

pub fn connectGoogleLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, service: []const u8, account_key: []const u8, email: []const u8) !void {
    const slug = if (std.mem.eql(u8, service, "gmail")) "gmail" else if (std.mem.eql(u8, service, "google-calendar")) "calendar" else return error.InvalidGoogleService;
    const id = try std.fmt.allocPrint(allocator, "account-google-{s}-{s}", .{ slug, account_key });
    defer allocator.free(id);
    const endpoint = if (std.mem.eql(u8, service, "gmail")) "https://gmail.googleapis.com/gmail/v1" else "https://www.googleapis.com/calendar/v3";
    const name = try std.fmt.allocPrint(allocator, "{s} · {s}", .{ if (std.mem.eql(u8, service, "gmail")) "Gmail" else "Google Calendar", email });
    defer allocator.free(name);
    const account = try std.fmt.allocPrint(allocator, "{s}:{s}", .{ account_key, service });
    defer allocator.free(account);
    var document: Io.Writer.Allocating = .init(allocator);
    defer document.deinit();
    try document.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, &document.writer);
    try document.writer.writeAll(",\"name\":");
    try std.json.Stringify.value(name, .{}, &document.writer);
    try document.writer.writeAll(",\"transport\":\"http\",\"url\":");
    try std.json.Stringify.value(endpoint, .{}, &document.writer);
    try document.writer.writeAll(",\"auth\":{\"type\":\"oauth\",\"provider\":\"google-workspace\",\"account\":");
    try std.json.Stringify.value(account, .{}, &document.writer);
    try document.writer.writeAll("},\"origin\":{\"kind\":\"account-adapter\",\"id\":");
    try std.json.Stringify.value(account, .{}, &document.writer);
    try document.writer.writeAll(",\"binding\":\"google-workspace\"},\"enabled\":true");
    try document.writer.writeByte('}');
    const response = try upsertLocal(allocator, io, database, document.writer.buffered());
    allocator.free(response);
}

pub fn disconnectGoogleLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, service: []const u8, account_key: []const u8) !void {
    const slug = if (std.mem.eql(u8, service, "gmail")) "gmail" else if (std.mem.eql(u8, service, "google-calendar")) "calendar" else return error.InvalidGoogleService;
    const id = try std.fmt.allocPrint(allocator, "account-google-{s}-{s}", .{ slug, account_key });
    defer allocator.free(id);
    try database.lock(io);
    defer database.unlock(io);
    const stored_document = (try repository.get(allocator, database, id)) orelse return;
    defer allocator.free(stored_document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, stored_document, .{}) catch return error.InvalidConnectorRecord;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidConnectorRecord;
    try parsed.value.object.put(parsed.arena.allocator(), "enabled", .{ .bool = false });
    const next = try stringify(allocator, parsed.value);
    defer allocator.free(next);
    try repository.save(database, id, false, next);
}

pub fn clearGoogleLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database) !void {
    try database.lock(io);
    defer database.unlock(io);
    var connectors = try repository.list(allocator, database);
    defer connectors.deinit();
    for (connectors.documents) |document| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const id = stringField(parsed.value.object, "id") orelse continue;
        if (!std.mem.startsWith(u8, id, "account-google-")) continue;
        try parsed.value.object.put(parsed.arena.allocator(), "enabled", .{ .bool = false });
        const next = try stringify(allocator, parsed.value);
        defer allocator.free(next);
        try repository.save(database, id, false, next);
    }
}

pub fn connectCodeStorageLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, account_id: []const u8, organization: []const u8, label: []const u8) !void {
    const id = try std.fmt.allocPrint(allocator, "account-code-storage-{s}", .{account_id});
    defer allocator.free(id);
    const name = try std.fmt.allocPrint(allocator, "Code.Storage · {s}", .{label});
    defer allocator.free(name);
    const executable = try std.process.executablePathAlloc(io, allocator);
    defer allocator.free(executable);
    var document: Io.Writer.Allocating = .init(allocator);
    defer document.deinit();
    try document.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, &document.writer);
    try document.writer.writeAll(",\"name\":");
    try std.json.Stringify.value(name, .{}, &document.writer);
    try document.writer.writeAll(",\"transport\":\"stdio\",\"protocolEra\":\"legacy\",\"command\":");
    try std.json.Stringify.value(executable, .{}, &document.writer);
    try document.writer.writeAll(",\"args\":[\"mcp-code-storage\"],\"auth\":{\"type\":\"credential\",\"provider\":\"code-storage\",\"account\":");
    try std.json.Stringify.value(account_id, .{}, &document.writer);
    try document.writer.writeAll("},\"origin\":{\"kind\":\"account-adapter\",\"id\":");
    try std.json.Stringify.value(account_id, .{}, &document.writer);
    try document.writer.writeAll(",\"binding\":\"code-storage\"},\"env\":{\"CODE_STORAGE_ORGANIZATION\":");
    try std.json.Stringify.value(organization, .{}, &document.writer);
    try document.writer.writeAll("},\"enabled\":true}");
    const response = try upsertLocal(allocator, io, database, document.writer.buffered());
    allocator.free(response);
}

pub fn disconnectCodeStorageLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, account_id: []const u8) !void {
    const id = try std.fmt.allocPrint(allocator, "account-code-storage-{s}", .{account_id});
    defer allocator.free(id);
    try database.lock(io);
    defer database.unlock(io);
    try repository.delete(database, id);
    try repository.deleteConnectorGrants(database, id);
}

fn removeOAuthEnv(object: *std.json.ObjectMap) void {
    for ([_][]const u8{ "env", "envSecret" }) |name| {
        const record = object.getPtr(name) orelse continue;
        if (record.* != .object) continue;
        _ = record.object.orderedRemove("GITHUB_PERSONAL_ACCESS_TOKEN");
        if (record.object.count() == 0) _ = object.orderedRemove(name);
    }
}

pub fn grantsPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, probe_id: ?[]const u8) ![]u8 {
    if (probe_id) |value| if (!validId(value)) return error.InvalidConnectorId;
    if (mode == .standalone) return grantsLocal(allocator, io, configuration, client, database, probe_id);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    const path = if (probe_id) |value| try std.fmt.allocPrint(allocator, "/internal/node/v1/connector-grants?connector={s}", .{value}) else try allocator.dupe(u8, "/internal/node/v1/connector-grants");
    defer allocator.free(path);
    return node_transport.get(allocator, client, &target, path) catch |failure| switch (failure) {
        error.NodeUnavailable => error.ConnectorNodeUnavailable,
        else => failure,
    };
}

pub fn inventoryPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, model_id: []const u8) ![]u8 {
    if (mode == .standalone) return inventoryLocal(allocator, io, configuration, client, database, model_id);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    const encoded_model = try encodeQuery(allocator, model_id);
    defer allocator.free(encoded_model);
    const path = try std.fmt.allocPrint(allocator, "/internal/node/v1/connector-call?model_id={s}", .{encoded_model});
    defer allocator.free(path);
    return node_transport.get(allocator, client, &target, path) catch |failure| switch (failure) {
        error.NodeUnavailable => error.ConnectorNodeUnavailable,
        else => failure,
    };
}

pub fn callPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, document: []const u8) ![]u8 {
    if (mode == .standalone) return callLocal(allocator, io, configuration, client, database, document);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    return node_transport.send(allocator, client, &target, "/internal/node/v1/connector-call", .POST, document) catch |failure| switch (failure) {
        error.NodeRequestRejected => error.ConnectorNodeRejected,
        else => failure,
    };
}

pub fn testPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, document: []const u8) ![]u8 {
    if (mode == .standalone) return testLocal(allocator, io, configuration, client, database, document);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    return node_transport.send(allocator, client, &target, "/internal/node/v1/connector-test", .POST, document) catch |failure| switch (failure) {
        error.NodeRequestRejected => error.ConnectorNodeRejected,
        else => failure,
    };
}

pub fn putGrantPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, document: []const u8) ![]u8 {
    if (mode == .standalone) return putGrantLocal(allocator, io, database, document);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    return node_transport.send(allocator, client, &target, "/internal/node/v1/connector-grants", .PUT, document) catch |failure| switch (failure) {
        error.NodeRequestRejected => error.ConnectorNodeRejected,
        else => failure,
    };
}

pub fn deleteGrantPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, model_id: []const u8, connector_id: []const u8) ![]u8 {
    try validateGrantIds(model_id, connector_id);
    if (mode == .standalone) return deleteGrantLocal(allocator, io, database, model_id, connector_id);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    var document: Io.Writer.Allocating = .init(allocator);
    defer document.deinit();
    try document.writer.writeAll("{\"modelId\":");
    try std.json.Stringify.value(model_id, .{}, &document.writer);
    try document.writer.writeAll(",\"connectorId\":");
    try std.json.Stringify.value(connector_id, .{}, &document.writer);
    try document.writer.writeAll(",\"tools\":[]}");
    return node_transport.send(allocator, client, &target, "/internal/node/v1/connector-grants", .PUT, document.writer.buffered()) catch |failure| switch (failure) {
        error.NodeRequestRejected => error.ConnectorNodeRejected,
        else => failure,
    };
}

pub fn grantsLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, probe_id: ?[]const u8) ![]u8 {
    try database.lock(io);
    defer database.unlock(io);
    var grants = try repository.listGrants(allocator, database);
    defer grants.deinit();
    var connectors = try repository.listEnabled(allocator, database);
    defer connectors.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"grants\":[");
    try writeGrants(&output.writer, grants.grants);
    try output.writer.writeAll("],\"connectors\":[");
    for (connectors.documents, 0..) |document, index| {
        if (index > 0) try output.writer.writeByte(',');
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidConnectorRecord;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidConnectorRecord;
        const id = stringField(parsed.value.object, "id") orelse return error.InvalidConnectorRecord;
        const name = stringField(parsed.value.object, "name") orelse id;
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(id, .{}, &output.writer);
        try output.writer.writeAll(",\"name\":");
        try std.json.Stringify.value(name, .{}, &output.writer);
        try output.writer.writeAll(",\"tools\":[");
        if (probe_id) |probe| if (std.mem.eql(u8, probe, id)) {
            const tools_result = executeConnector(allocator, io, configuration, client, parsed.value.object, .tools) catch null;
            if (tools_result) |result| {
                defer allocator.free(result);
                var tools_document = std.json.parseFromSlice(std.json.Value, allocator, result, .{}) catch null;
                if (tools_document) |*tools_parsed| {
                    defer tools_parsed.deinit();
                    if (tools_parsed.value == .object) if (tools_parsed.value.object.get("tools")) |tools| if (tools == .array) {
                        var wrote_tool = false;
                        for (tools.array.items) |tool| {
                            if (tool != .object) continue;
                            const tool_name = stringField(tool.object, "name") orelse continue;
                            if (wrote_tool) try output.writer.writeByte(',');
                            try std.json.Stringify.value(tool_name, .{}, &output.writer);
                            wrote_tool = true;
                        }
                    };
                }
            }
        };
        try output.writer.writeAll("]}");
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn putGrantLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, document: []const u8) ![]u8 {
    var parsed = try parseGrant(allocator, document, true);
    defer parsed.deinit();
    const model_id = stringField(parsed.value.object, "modelId") orelse return error.ConnectorGrantFieldsRequired;
    const connector_id = stringField(parsed.value.object, "connectorId") orelse return error.ConnectorGrantFieldsRequired;
    const tools = parsed.value.object.get("tools") orelse return error.ConnectorGrantFieldsRequired;
    const tools_json = try stringify(allocator, tools);
    defer allocator.free(tools_json);
    try database.lock(io);
    defer database.unlock(io);
    if (tools == .array and tools.array.items.len == 0) {
        try repository.deleteGrant(database, model_id, connector_id);
    } else {
        var timestamp_buffer: [24]u8 = undefined;
        try repository.saveGrant(database, model_id, connector_id, tools_json, formatTimestamp(io, &timestamp_buffer));
    }
    return grantsOnlyLocked(allocator, database);
}

pub fn deleteGrantLocal(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, model_id: []const u8, connector_id: []const u8) ![]u8 {
    try validateGrantIds(model_id, connector_id);
    try database.lock(io);
    defer database.unlock(io);
    try repository.deleteGrant(database, model_id, connector_id);
    return grantsOnlyLocked(allocator, database);
}

pub fn inventoryLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, model_id: []const u8) ![]u8 {
    if (model_id.len > 512) return error.InvalidConnectorCallPayload;
    try database.lock(io);
    var connectors = repository.listEnabled(allocator, database) catch |failure| {
        database.unlock(io);
        return failure;
    };
    database.unlock(io);
    defer connectors.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"connectors\":[");
    var wrote = false;
    for (connectors.documents) |document| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const id = stringField(parsed.value.object, "id") orelse continue;
        if (wrote) try output.writer.writeByte(',');
        const name = stringField(parsed.value.object, "name") orelse id;
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(id, .{}, &output.writer);
        try output.writer.writeAll(",\"name\":");
        try std.json.Stringify.value(name, .{}, &output.writer);
        const tools_result = executeConnector(allocator, io, configuration, client, parsed.value.object, .tools) catch |failure| {
            try output.writer.writeAll(",\"tools\":[],\"error\":");
            try std.json.Stringify.value(@errorName(failure), .{}, &output.writer);
            try output.writer.writeByte('}');
            wrote = true;
            continue;
        };
        defer allocator.free(tools_result);
        try output.writer.writeAll(",\"tools\":");
        try writeTools(allocator, &output.writer, tools_result);
        try output.writer.writeByte('}');
        wrote = true;
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn callLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, document: []const u8) ![]u8 {
    var body = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidConnectorCallPayload;
    defer body.deinit();
    if (body.value != .object) return error.InvalidConnectorCallPayload;
    const connector_id = stringField(body.value.object, "connector_id") orelse return error.ConnectorCallFieldsRequired;
    const tool = stringField(body.value.object, "tool") orelse return error.ConnectorCallFieldsRequired;
    const model_id = stringField(body.value.object, "model_id") orelse "";
    const arguments = body.value.object.get("args") orelse std.json.Value{ .object = .empty };
    if (!validId(connector_id) or tool.len > 512 or model_id.len > 512 or arguments != .object) return error.InvalidConnectorCallPayload;
    try database.lock(io);
    const stored = repository.get(allocator, database, connector_id) catch |failure| {
        database.unlock(io);
        return failure;
    };
    database.unlock(io);
    defer if (stored) |value| allocator.free(value);
    const connector_document = stored orelse return error.ConnectorNotFound;
    var connector = std.json.parseFromSlice(std.json.Value, allocator, connector_document, .{}) catch return error.InvalidConnectorRecord;
    defer connector.deinit();
    if (connector.value != .object or !(booleanField(connector.value.object, "enabled") orelse false)) return error.ConnectorDisabled;
    const result = try executeConnector(allocator, io, configuration, client, connector.value.object, .{ .call = .{ .name = tool, .arguments = arguments } });
    defer allocator.free(result);
    return std.fmt.allocPrint(allocator, "{{\"ok\":true,\"result\":{s}}}", .{result});
}

pub fn testLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, document: []const u8) ![]u8 {
    var body = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidConnectorPayload;
    defer body.deinit();
    if (body.value != .object) return error.InvalidConnectorPayload;
    const id = stringField(body.value.object, "id") orelse return error.ConnectorIdRequired;
    if (!validId(id)) return error.InvalidConnectorId;
    try database.lock(io);
    const stored = repository.get(allocator, database, id) catch |failure| {
        database.unlock(io);
        return failure;
    };
    database.unlock(io);
    defer if (stored) |value| allocator.free(value);
    var connector = std.json.parseFromSlice(std.json.Value, allocator, stored orelse return error.ConnectorNotFound, .{}) catch return error.InvalidConnectorRecord;
    defer connector.deinit();
    if (connector.value != .object) return error.InvalidConnectorRecord;
    const result = try executeConnector(allocator, io, configuration, client, connector.value.object, .tools);
    defer allocator.free(result);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, result, .{}) catch return error.InvalidMcpResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidMcpResponse;
    const tools = parsed.value.object.get("tools") orelse return error.InvalidMcpResponse;
    if (tools != .array) return error.InvalidMcpResponse;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"ok\":true,\"tool_count\":{d},\"tool_names\":[", .{tools.array.items.len});
    for (tools.array.items[0..@min(tools.array.items.len, 40)], 0..) |tool_value, index| {
        if (index > 0) try output.writer.writeByte(',');
        const name = if (tool_value == .object) stringField(tool_value.object, "name") orelse "" else "";
        try std.json.Stringify.value(name, .{}, &output.writer);
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn grantsOnlyLocked(allocator: std.mem.Allocator, database: *sqlite.Database) ![]u8 {
    var grants = try repository.listGrants(allocator, database);
    defer grants.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"grants\":[");
    try writeGrants(&output.writer, grants.grants);
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn writeGrants(writer: *Io.Writer, grants: []const repository.Grant) !void {
    for (grants, 0..) |grant, index| {
        if (index > 0) try writer.writeByte(',');
        try writer.writeAll("{\"modelId\":");
        try std.json.Stringify.value(grant.model_id, .{}, writer);
        try writer.writeAll(",\"connectorId\":");
        try std.json.Stringify.value(grant.connector_id, .{}, writer);
        try writer.writeAll(",\"tools\":");
        try writer.writeAll(grant.tools_json);
        try writer.writeAll(",\"createdAt\":");
        try std.json.Stringify.value(grant.created_at, .{}, writer);
        try writer.writeByte('}');
    }
}

fn parseGrant(allocator: std.mem.Allocator, document: []const u8, require_tools: bool) !std.json.Parsed(std.json.Value) {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidConnectorGrantPayload;
    errdefer parsed.deinit();
    if (parsed.value != .object) return error.InvalidConnectorGrantPayload;
    const model_id = stringField(parsed.value.object, "modelId") orelse return error.ConnectorGrantFieldsRequired;
    const connector_id = stringField(parsed.value.object, "connectorId") orelse return error.ConnectorGrantFieldsRequired;
    if (model_id.len > 512 or !validId(connector_id)) return error.InvalidConnectorGrantPayload;
    if (require_tools) {
        const tools = parsed.value.object.get("tools") orelse return error.ConnectorGrantFieldsRequired;
        if (tools == .string) {
            if (!std.mem.eql(u8, tools.string, "all")) return error.InvalidConnectorGrantPayload;
        } else if (tools == .array) {
            if (tools.array.items.len > 1000) return error.InvalidConnectorGrantPayload;
            for (tools.array.items) |tool| if (tool != .string or tool.string.len == 0 or tool.string.len > 512) return error.InvalidConnectorGrantPayload;
        } else return error.InvalidConnectorGrantPayload;
    }
    return parsed;
}

fn validateGrantIds(model_id: []const u8, connector_id: []const u8) !void {
    if (model_id.len == 0 or model_id.len > 512 or !validId(connector_id)) return error.InvalidConnectorGrantPayload;
}

fn executeConnector(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, client: *http.Client, connector: std.json.ObjectMap, operation: mcp_client.Operation) ![]u8 {
    if (google_workspace.owns(connector)) return google_workspace.execute(allocator, io, client, configuration.data_dir, connector, operation);
    const transport = stringField(connector, "transport") orelse return error.InvalidConnectorRecord;
    if (std.mem.eql(u8, transport, "stdio")) return mcp_client.executeStdio(allocator, io, configuration.environment, configuration.data_dir, connector, operation);
    if (std.mem.eql(u8, transport, "http")) return mcp_client.executeHttp(allocator, io, client, connector, operation);
    return error.UnsupportedMcpTransport;
}

fn writeTools(allocator: std.mem.Allocator, writer: *Io.Writer, document: []const u8) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidMcpResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidMcpResponse;
    const tools = parsed.value.object.get("tools") orelse return error.InvalidMcpResponse;
    if (tools != .array) return error.InvalidMcpResponse;
    try writer.writeByte('[');
    var wrote = false;
    for (tools.array.items) |tool_value| {
        if (tool_value != .object) continue;
        _ = stringField(tool_value.object, "name") orelse continue;
        if (wrote) try writer.writeByte(',');
        try std.json.Stringify.value(tool_value, .{}, writer);
        wrote = true;
    }
    try writer.writeByte(']');
}

fn listLocked(allocator: std.mem.Allocator, database: *sqlite.Database) ![]u8 {
    var connectors = try repository.list(allocator, database);
    defer connectors.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"connectors\":[");
    for (connectors.documents, 0..) |document, index| {
        if (index > 0) try output.writer.writeByte(',');
        try writeView(allocator, &output.writer, document);
    }
    try output.writer.writeAll("],\"catalog\":");
    try mcp_catalog.write(&output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn writeView(allocator: std.mem.Allocator, writer: *Io.Writer, document: []const u8) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidConnectorRecord;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidConnectorRecord;
    var secret_keys: std.json.Array = .init(parsed.arena.allocator());
    try maskRecord(parsed.arena.allocator(), &parsed.value.object, "env", "envSecret", &secret_keys);
    try maskRecord(parsed.arena.allocator(), &parsed.value.object, "headers", "headerSecret", &secret_keys);
    try parsed.value.object.put(parsed.arena.allocator(), "secret_keys", .{ .array = secret_keys });
    try std.json.Stringify.value(parsed.value, .{}, writer);
}

fn maskRecord(allocator: std.mem.Allocator, object: *std.json.ObjectMap, record_name: []const u8, flags_name: []const u8, secret_keys: *std.json.Array) !void {
    const record = object.getPtr(record_name) orelse return;
    if (record.* != .object) return;
    var iterator = record.object.iterator();
    while (iterator.next()) |entry| {
        if (!secretKey(object.*, flags_name, entry.key_ptr.*) or entry.value_ptr.* != .string or entry.value_ptr.string.len == 0) continue;
        entry.value_ptr.* = .{ .string = mask };
        try secret_keys.append(.{ .string = try allocator.dupe(u8, entry.key_ptr.*) });
    }
}

fn restoreSecrets(incoming: *std.json.ObjectMap, stored: std.json.ObjectMap, record_name: []const u8, flags_name: []const u8) void {
    const record = incoming.getPtr(record_name) orelse return;
    if (record.* != .object) return;
    const stored_record = stored.get(record_name) orelse return;
    if (stored_record != .object) return;
    var iterator = record.object.iterator();
    while (iterator.next()) |entry| {
        if (entry.value_ptr.* != .string or !std.mem.eql(u8, entry.value_ptr.string, mask)) continue;
        if (!secretKey(stored, flags_name, entry.key_ptr.*)) continue;
        const previous = stored_record.object.get(entry.key_ptr.*) orelse continue;
        if (previous == .string and previous.string.len > 0) entry.value_ptr.* = previous;
    }
}

fn preserveFields(allocator: std.mem.Allocator, incoming: *std.json.ObjectMap, stored: std.json.ObjectMap) !void {
    for ([_][]const u8{ "envSecret", "headerSecret", "cwd", "origin", "auth", "runtime", "protocolEra" }) |name| {
        if (incoming.get(name) == null) if (stored.get(name)) |value| try incoming.put(allocator, name, value);
    }
}

fn validateOptionalFields(object: std.json.ObjectMap) !void {
    for ([_][]const u8{"args"}) |name| if (object.get(name)) |value| {
        if (value != .array or value.array.items.len > 1000) return error.InvalidConnectorPayload;
        for (value.array.items) |entry| if (entry != .string or entry.string.len > 4096) return error.InvalidConnectorPayload;
    };
    for ([_][]const u8{ "env", "headers" }) |name| if (object.get(name)) |value| {
        if (value != .object or value.object.count() > 256) return error.InvalidConnectorPayload;
        var iterator = value.object.iterator();
        while (iterator.next()) |entry| if (entry.key_ptr.len > 256 or entry.value_ptr.* != .string or entry.value_ptr.string.len > 64 * 1024) return error.InvalidConnectorPayload;
    };
    for ([_][]const u8{ "envSecret", "headerSecret" }) |name| if (object.get(name)) |value| {
        if (value != .object or value.object.count() > 256) return error.InvalidConnectorPayload;
        var iterator = value.object.iterator();
        while (iterator.next()) |entry| if (entry.value_ptr.* != .bool) return error.InvalidConnectorPayload;
    };
    if (object.get("enabled")) |value| if (value != .bool) return error.InvalidConnectorPayload;
    if (object.get("protocolEra")) |value| {
        if (value != .string) return error.InvalidConnectorPayload;
        if (!std.mem.eql(u8, value.string, "modern") and !std.mem.eql(u8, value.string, "auto") and !std.mem.eql(u8, value.string, "legacy")) return error.InvalidConnectorPayload;
    }
}

fn secretKey(object: std.json.ObjectMap, flags_name: []const u8, key: []const u8) bool {
    if (object.get(flags_name)) |flags| if (flags == .object) if (flags.object.get(key)) |flag| if (flag == .bool) return flag.bool;
    for ([_][]const u8{ "token", "key", "secret", "password", "auth" }) |needle| if (containsIgnoreCase(key, needle)) return true;
    return false;
}

fn containsIgnoreCase(value: []const u8, needle: []const u8) bool {
    if (needle.len > value.len) return false;
    var index: usize = 0;
    while (index + needle.len <= value.len) : (index += 1) if (std.ascii.eqlIgnoreCase(value[index .. index + needle.len], needle)) return true;
    return false;
}

fn samePrefix(left: []const u8, right: []const u8) bool {
    if (left.len != right.len) return false;
    for (left, right) |a, b| if ((if (a == '-') '_' else a) != (if (b == '-') '_' else b)) return false;
    return true;
}

fn validId(value: []const u8) bool {
    if (value.len == 0 or value.len > 64 or !std.ascii.isLower(value[0]) and !std.ascii.isDigit(value[0])) return false;
    for (value) |character| if (!std.ascii.isLower(character) and !std.ascii.isDigit(character) and character != '-' and character != '_') return false;
    return true;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
}

fn booleanField(object: std.json.ObjectMap, name: []const u8) ?bool {
    const value = object.get(name) orelse return null;
    return if (value == .bool) value.bool else null;
}

fn stringify(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn formatTimestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds, 0)) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{ year_day.year, month_day.month.numeric(), month_day.day_index + 1, day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute() }) catch unreachable;
}

fn encodeQuery(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const hex = "0123456789ABCDEF";
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    for (value) |byte| {
        if (std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '_' or byte == '.' or byte == '~') {
            try output.writer.writeByte(byte);
        } else {
            try output.writer.writeByte('%');
            try output.writer.writeByte(hex[byte >> 4]);
            try output.writer.writeByte(hex[byte & 15]);
        }
    }
    return output.toOwnedSlice();
}
