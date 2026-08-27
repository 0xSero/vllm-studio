const std = @import("std");
const repository = @import("store.zig");
const mcp_client = @import("../../agent/mcp/client.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 16 * 1024 * 1024;

pub fn owns(connector: std.json.ObjectMap) bool {
    const auth = connector.get("auth") orelse return false;
    if (auth != .object) return false;
    return if (stringField(auth.object, "provider")) |provider| std.mem.eql(u8, provider, "google-workspace") else false;
}

pub fn execute(allocator: std.mem.Allocator, io: Io, client: *http.Client, data_dir: []const u8, connector: std.json.ObjectMap, operation: mcp_client.Operation) ![]u8 {
    const identity = try connectorIdentity(connector);
    return switch (operation) {
        .tools => allocator.dupe(u8, if (identity.service == .gmail) gmail_tools else calendar_tools),
        .call => |call| callTool(allocator, io, client, data_dir, identity, call.name, call.arguments),
    };
}

const Identity = struct { key: []const u8, service: repository.Service };

fn connectorIdentity(connector: std.json.ObjectMap) !Identity {
    const auth = connector.get("auth") orelse return error.InvalidGoogleConnector;
    if (auth != .object) return error.InvalidGoogleConnector;
    const account = stringField(auth.object, "account") orelse return error.InvalidGoogleConnector;
    const separator = std.mem.findScalar(u8, account, ':') orelse return error.InvalidGoogleConnector;
    const key = account[0..separator];
    if (!repository.validKey(key)) return error.InvalidGoogleConnector;
    return .{ .key = key, .service = try repository.Service.parse(account[separator + 1 ..]) };
}

fn callTool(allocator: std.mem.Allocator, io: Io, client: *http.Client, data_dir: []const u8, identity: Identity, name: []const u8, arguments: std.json.Value) ![]u8 {
    if (arguments != .object) return error.InvalidGoogleToolArguments;
    const access = try accessToken(allocator, io, client, data_dir, identity);
    defer allocator.free(access);
    var request = try buildRequest(allocator, identity.service, name, arguments.object);
    defer request.deinit();
    const response = try fetch(allocator, client, access, request.url, request.method, request.body);
    defer allocator.free(response.body);
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    if (response.status.class() != .success) {
        try output.writer.writeAll("{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":");
        const message = try std.fmt.allocPrint(allocator, "{s} failed: Google returned {d}", .{ name, @intFromEnum(response.status) });
        defer allocator.free(message);
        try std.json.Stringify.value(message, .{}, &output.writer);
        try output.writer.writeAll("}]}");
        return output.toOwnedSlice();
    }
    try output.writer.writeAll("{\"content\":[{\"type\":\"text\",\"text\":");
    try std.json.Stringify.value(response.body, .{}, &output.writer);
    try output.writer.writeAll("}]}");
    return output.toOwnedSlice();
}

const Request = struct {
    allocator: std.mem.Allocator,
    url: []u8,
    method: http.Method = .GET,
    body: ?[]u8 = null,

    fn deinit(request: *Request) void {
        request.allocator.free(request.url);
        if (request.body) |value| request.allocator.free(value);
        request.* = undefined;
    }
};

fn buildRequest(allocator: std.mem.Allocator, service: repository.Service, name: []const u8, arguments: std.json.ObjectMap) !Request {
    var url: Io.Writer.Allocating = .init(allocator);
    defer url.deinit();
    try url.writer.writeAll(service.endpoint());
    var method: http.Method = .GET;
    var body: ?[]u8 = null;
    if (service == .gmail) {
        if (std.mem.eql(u8, name, "list_labels")) {
            try url.writer.writeAll("/users/me/labels");
        } else if (std.mem.eql(u8, name, "search_threads")) {
            try url.writer.writeAll("/users/me/threads?maxResults=");
            try url.writer.print("{d}", .{boundedCount(arguments, "max_results", 20)});
            try appendQuery(&url.writer, "q", optionalString(arguments, "query"));
            try appendQuery(&url.writer, "pageToken", optionalString(arguments, "page_token"));
        } else if (std.mem.eql(u8, name, "get_thread")) {
            try url.writer.writeAll("/users/me/threads/");
            try queryEncode(&url.writer, requiredString(arguments, "thread_id") orelse return error.GoogleToolArgumentRequired);
            try url.writer.writeAll("?format=full");
        } else if (std.mem.eql(u8, name, "get_message")) {
            try url.writer.writeAll("/users/me/messages/");
            try queryEncode(&url.writer, requiredString(arguments, "message_id") orelse return error.GoogleToolArgumentRequired);
            try url.writer.writeAll("?format=full");
        } else if (std.mem.eql(u8, name, "list_drafts")) {
            try url.writer.writeAll("/users/me/drafts?maxResults=");
            try url.writer.print("{d}", .{boundedCount(arguments, "max_results", 20)});
        } else return error.GoogleToolNotFound;
    } else {
        if (std.mem.eql(u8, name, "list_calendars")) {
            try url.writer.writeAll("/users/me/calendarList");
        } else if (std.mem.eql(u8, name, "list_events")) {
            try url.writer.writeAll("/calendars/");
            try queryEncode(&url.writer, optionalString(arguments, "calendar_id") orelse "primary");
            try url.writer.writeAll("/events?singleEvents=true&orderBy=startTime&maxResults=");
            try url.writer.print("{d}", .{boundedCount(arguments, "max_results", 50)});
            try appendQuery(&url.writer, "timeMin", optionalString(arguments, "time_min"));
            try appendQuery(&url.writer, "timeMax", optionalString(arguments, "time_max"));
            try appendQuery(&url.writer, "q", optionalString(arguments, "query"));
        } else if (std.mem.eql(u8, name, "get_event")) {
            try url.writer.writeAll("/calendars/");
            try queryEncode(&url.writer, optionalString(arguments, "calendar_id") orelse "primary");
            try url.writer.writeAll("/events/");
            try queryEncode(&url.writer, requiredString(arguments, "event_id") orelse return error.GoogleToolArgumentRequired);
        } else if (std.mem.eql(u8, name, "suggest_time")) {
            const time_min = requiredString(arguments, "time_min") orelse return error.GoogleToolArgumentRequired;
            const time_max = requiredString(arguments, "time_max") orelse return error.GoogleToolArgumentRequired;
            try url.writer.writeAll("/freeBusy");
            method = .POST;
            var document: Io.Writer.Allocating = .init(allocator);
            defer document.deinit();
            try document.writer.writeAll("{\"timeMin\":");
            try std.json.Stringify.value(time_min, .{}, &document.writer);
            try document.writer.writeAll(",\"timeMax\":");
            try std.json.Stringify.value(time_max, .{}, &document.writer);
            try document.writer.writeAll(",\"items\":[");
            const calendars = arguments.get("calendar_ids");
            var wrote = false;
            if (calendars) |values| if (values == .array) for (values.array.items) |value| {
                if (value != .string or value.string.len == 0) continue;
                if (wrote) try document.writer.writeByte(',');
                try document.writer.writeAll("{\"id\":");
                try std.json.Stringify.value(value.string, .{}, &document.writer);
                try document.writer.writeByte('}');
                wrote = true;
            };
            if (!wrote) try document.writer.writeAll("{\"id\":\"primary\"}");
            try document.writer.writeAll("]}");
            body = try document.toOwnedSlice();
        } else return error.GoogleToolNotFound;
    }
    return .{ .allocator = allocator, .url = try url.toOwnedSlice(), .method = method, .body = body };
}

fn accessToken(allocator: std.mem.Allocator, io: Io, client: *http.Client, data_dir: []const u8, identity: Identity) ![]u8 {
    var store = try repository.load(allocator, io, data_dir);
    defer store.deinit();
    const client_id = store.client_id orelse return error.GoogleClientRequired;
    const account = store.find(identity.key) orelse return error.GoogleAccountNotFound;
    const connection = account.connection(identity.service).* orelse return error.GoogleAccountNotFound;
    var form: Io.Writer.Allocating = .init(allocator);
    defer form.deinit();
    try form.writer.writeAll("client_id=");
    try queryEncode(&form.writer, client_id);
    try form.writer.writeAll("&refresh_token=");
    try queryEncode(&form.writer, connection.refresh_token);
    try form.writer.writeAll("&grant_type=refresh_token");
    if (store.client_secret) |value| {
        try form.writer.writeAll("&client_secret=");
        try queryEncode(&form.writer, value);
    }
    const response = try fetch(allocator, client, null, "https://oauth2.googleapis.com/token", .POST, form.writer.buffered());
    defer allocator.free(response.body);
    if (response.status.class() != .success) return error.GoogleTokenRefreshFailed;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response.body, .{}) catch return error.GoogleTokenRefreshFailed;
    defer parsed.deinit();
    if (parsed.value != .object) return error.GoogleTokenRefreshFailed;
    const access = stringField(parsed.value.object, "access_token") orelse return error.GoogleTokenRefreshFailed;
    return allocator.dupe(u8, access);
}

const FetchResponse = struct { status: http.Status, body: []u8 };

fn fetch(allocator: std.mem.Allocator, client: *http.Client, access: ?[]const u8, url: []const u8, method: http.Method, payload: ?[]const u8) !FetchResponse {
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
        headers[count] = .{ .name = "Content-Type", .value = if (access == null) "application/x-www-form-urlencoded" else "application/json" };
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

fn appendQuery(writer: *Io.Writer, name: []const u8, value: ?[]const u8) !void {
    const present = value orelse return;
    try writer.writeByte('&');
    try writer.writeAll(name);
    try writer.writeByte('=');
    try queryEncode(writer, present);
}

fn boundedCount(object: std.json.ObjectMap, name: []const u8, fallback: u16) u16 {
    const value = object.get(name) orelse return fallback;
    const integer: i64 = if (value == .integer) value.integer else return fallback;
    return @intCast(@min(@max(integer, 1), 500));
}

fn requiredString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    return optionalString(object, name);
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0 or trimmed.len > 64 * 1024) null else trimmed;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    return optionalString(object, name);
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

const gmail_tools =
    "{\"tools\":[{\"name\":\"list_labels\",\"description\":\"List Gmail labels.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false},\"annotations\":{\"readOnlyHint\":true}},{\"name\":\"search_threads\",\"description\":\"Search Gmail threads.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"},\"max_results\":{\"type\":\"number\"},\"page_token\":{\"type\":\"string\"}},\"additionalProperties\":false},\"annotations\":{\"readOnlyHint\":true}},{\"name\":\"get_thread\",\"description\":\"Read a Gmail thread.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"thread_id\":{\"type\":\"string\"}},\"required\":[\"thread_id\"],\"additionalProperties\":false},\"annotations\":{\"readOnlyHint\":true}},{\"name\":\"get_message\",\"description\":\"Read a Gmail message.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"message_id\":{\"type\":\"string\"}},\"required\":[\"message_id\"],\"additionalProperties\":false},\"annotations\":{\"readOnlyHint\":true}},{\"name\":\"list_drafts\",\"description\":\"List Gmail drafts.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"max_results\":{\"type\":\"number\"}},\"additionalProperties\":false},\"annotations\":{\"readOnlyHint\":true}}]}";

const calendar_tools =
    "{\"tools\":[{\"name\":\"list_calendars\",\"description\":\"List calendars.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false},\"annotations\":{\"readOnlyHint\":true}},{\"name\":\"list_events\",\"description\":\"List calendar events.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"calendar_id\":{\"type\":\"string\"},\"time_min\":{\"type\":\"string\"},\"time_max\":{\"type\":\"string\"},\"query\":{\"type\":\"string\"},\"max_results\":{\"type\":\"number\"}},\"additionalProperties\":false},\"annotations\":{\"readOnlyHint\":true}},{\"name\":\"get_event\",\"description\":\"Read a calendar event.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"calendar_id\":{\"type\":\"string\"},\"event_id\":{\"type\":\"string\"}},\"required\":[\"event_id\"],\"additionalProperties\":false},\"annotations\":{\"readOnlyHint\":true}},{\"name\":\"suggest_time\",\"description\":\"Return busy intervals for calendars.\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"time_min\":{\"type\":\"string\"},\"time_max\":{\"type\":\"string\"},\"calendar_ids\":{\"type\":\"array\",\"items\":{\"type\":\"string\"}}},\"required\":[\"time_min\",\"time_max\"],\"additionalProperties\":false},\"annotations\":{\"readOnlyHint\":true}}]}";
