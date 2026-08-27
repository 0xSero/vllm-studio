const std = @import("std");

const Io = std.Io;
const max_response_bytes = 8 * 1024 * 1024;
const request_timeout = Io.Duration.fromSeconds(15);

pub const Result = struct {
    allocator: std.mem.Allocator,
    status: std.http.Status,
    body: []u8,

    pub fn deinit(result: *Result) void {
        result.allocator.free(result.body);
        result.* = undefined;
    }
};

pub fn payload(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, environment: *const std.process.Environ.Map, search: ?[]const u8, filter: ?[]const u8, sort: ?[]const u8, limit: usize, offset: usize) !Result {
    const origin_value = environment.get("LOCAL_STUDIO_HF_ORIGIN") orelse "https://huggingface.co";
    const origin = std.mem.trimEnd(u8, std.mem.trim(u8, origin_value, " \t\r\n"), "/");
    if (origin.len == 0) return error.InvalidHuggingFaceOrigin;
    const request_limit = @min(limit +| offset, 500);
    var list_url: std.Io.Writer.Allocating = .init(allocator);
    defer list_url.deinit();
    try list_url.writer.print("{s}/api/models?limit={d}&full=false", .{ origin, request_limit });
    if (sort) |value| {
        try list_url.writer.writeAll("&sort=");
        try writeQueryValue(&list_url.writer, mappedSort(value));
    }
    if (search) |value| {
        try list_url.writer.writeAll("&search=");
        try writeQueryValue(&list_url.writer, value);
    }
    if (filter) |value| {
        try list_url.writer.writeAll("&filter=");
        try writeQueryValue(&list_url.writer, value);
    }
    const list_response = try fetch(allocator, io, client, list_url.writer.buffered());
    defer allocator.free(list_response.body);
    if (list_response.status.class() != .success) {
        return .{ .allocator = allocator, .status = list_response.status, .body = try std.fmt.allocPrint(allocator, "{{\"detail\":\"HuggingFace API error: {d}\"}}", .{@intFromEnum(list_response.status)}) };
    }
    var list_parsed = std.json.parseFromSlice(std.json.Value, allocator, list_response.body, .{}) catch return error.InvalidHuggingFaceResponse;
    defer list_parsed.deinit();
    if (list_parsed.value != .array) return error.InvalidHuggingFaceResponse;

    var exact_parsed: ?std.json.Parsed(std.json.Value) = null;
    defer if (exact_parsed) |*parsed| parsed.deinit();
    var exact_model: ?*std.json.Value = null;
    if (search) |value| if (std.mem.indexOfScalar(u8, value, '/') != null) {
        var exact_url: std.Io.Writer.Allocating = .init(allocator);
        defer exact_url.deinit();
        try exact_url.writer.print("{s}/api/models/", .{origin});
        try writeModelPath(&exact_url.writer, value);
        const exact_response = try fetch(allocator, io, client, exact_url.writer.buffered());
        defer allocator.free(exact_response.body);
        if (exact_response.status.class() == .success) {
            exact_parsed = std.json.parseFromSlice(std.json.Value, allocator, exact_response.body, .{}) catch return error.InvalidHuggingFaceResponse;
            if (exact_parsed.?.value != .object) return error.InvalidHuggingFaceResponse;
            try normalize(&exact_parsed.?.value, exact_parsed.?.arena.allocator());
            exact_model = &exact_parsed.?.value;
        }
    };

    for (list_parsed.value.array.items) |*model| {
        if (model.* != .object) return error.InvalidHuggingFaceResponse;
        try normalize(model, list_parsed.arena.allocator());
    }
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeByte('[');
    var wrote = false;
    const exact_id = if (exact_model) |model| modelId(model.*) else null;
    if (exact_model) |model| if (exact_id != null and exact_id.?.len > 0) {
        try std.json.Stringify.value(model.*, .{}, &output.writer);
        wrote = true;
    };
    const start = @min(offset, list_parsed.value.array.items.len);
    const end = @min(start +| limit, list_parsed.value.array.items.len);
    for (list_parsed.value.array.items[start..end]) |model| {
        if (exact_id) |id| if (modelId(model)) |candidate| if (std.ascii.eqlIgnoreCase(id, candidate)) continue;
        if (wrote) try output.writer.writeByte(',');
        try std.json.Stringify.value(model, .{}, &output.writer);
        wrote = true;
    }
    try output.writer.writeByte(']');
    return .{ .allocator = allocator, .status = .ok, .body = try output.toOwnedSlice() };
}

const FetchResult = struct { status: std.http.Status, body: []u8 };

fn fetch(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, url: []const u8) !FetchResult {
    const Selection = union(enum) { request: anyerror!FetchResult, timer: Io.Cancelable!void };
    var selections: [2]Selection = undefined;
    var select = Io.Select(Selection).init(io, &selections);
    try select.concurrent(.request, fetchRequest, .{ allocator, client, url });
    select.concurrent(.timer, waitForTimeout, .{io}) catch {
        while (select.cancel()) |pending| deinitSelection(allocator, pending);
        return error.ConcurrencyUnavailable;
    };
    const selected = try select.await();
    switch (selected) {
        .request => |result| {
            select.cancelDiscard();
            return result;
        },
        .timer => |result| {
            result catch |failure| switch (failure) {
                error.Canceled => return error.Canceled,
            };
            while (select.cancel()) |pending| deinitSelection(allocator, pending);
            return error.HuggingFaceRequestTimeout;
        },
    }
}

fn fetchRequest(allocator: std.mem.Allocator, client: *std.http.Client, url: []const u8) !FetchResult {
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var body: std.Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .redirect_behavior = .init(5),
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .response_writer = &body,
    });
    return .{ .status = response.status, .body = try allocator.dupe(u8, body.buffered()) };
}

fn waitForTimeout(io: Io) Io.Cancelable!void {
    return io.sleep(request_timeout, .awake);
}

fn deinitSelection(allocator: std.mem.Allocator, selection: anytype) void {
    switch (selection) {
        .request => |result| if (result) |response| {
            allocator.free(response.body);
        } else |_| {},
        .timer => {},
    }
}

fn normalize(model: *std.json.Value, allocator: std.mem.Allocator) !void {
    const object = &model.object;
    const id = stringValue(object.get("modelId")) orelse stringValue(object.get("id")) orelse "";
    const internal_id = stringValue(object.get("_id")) orelse id;
    try object.put(allocator, "_id", .{ .string = internal_id });
    try object.put(allocator, "modelId", .{ .string = id });
    try object.put(allocator, "downloads", numericValue(object.get("downloads")));
    try object.put(allocator, "likes", numericValue(object.get("likes")));
    const tags = object.get("tags");
    if (tags == null or tags.? != .array) try object.put(allocator, "tags", .{ .array = .init(allocator) });
    const private = object.get("private");
    try object.put(allocator, "private", .{ .bool = private != null and truthy(private.?) });
}

fn numericValue(value: ?std.json.Value) std.json.Value {
    const present = value orelse return .{ .integer = 0 };
    return switch (present) {
        .integer, .float, .number_string => present,
        else => .{ .integer = 0 },
    };
}

fn truthy(value: std.json.Value) bool {
    return switch (value) {
        .null => false,
        .bool => |present| present,
        .integer => |present| present != 0,
        .float => |present| present != 0,
        .number_string => |present| !std.mem.eql(u8, present, "0") and present.len > 0,
        .string => |present| present.len > 0,
        .array => true,
        .object => true,
    };
}

fn stringValue(value: ?std.json.Value) ?[]const u8 {
    const present = value orelse return null;
    return if (present == .string) present.string else null;
}

fn modelId(model: std.json.Value) ?[]const u8 {
    if (model != .object) return null;
    return stringValue(model.object.get("modelId"));
}

fn mappedSort(value: []const u8) []const u8 {
    if (std.mem.eql(u8, value, "createdAt")) return "createdAt";
    if (std.mem.eql(u8, value, "downloads")) return "downloads";
    if (std.mem.eql(u8, value, "likes")) return "likes";
    if (std.mem.eql(u8, value, "lastModified") or std.mem.eql(u8, value, "modified")) return "lastModified";
    return "trendingScore";
}

fn writeModelPath(writer: *std.Io.Writer, value: []const u8) !void {
    var segments = std.mem.splitScalar(u8, value, '/');
    var first = true;
    while (segments.next()) |segment| {
        if (!first) try writer.writeByte('/');
        try writeQueryValue(writer, segment);
        first = false;
    }
}

fn writeQueryValue(writer: *std.Io.Writer, value: []const u8) !void {
    for (value) |character| {
        if (std.ascii.isAlphanumeric(character) or character == '-' or character == '_' or character == '.' or character == '~') {
            try writer.writeByte(character);
        } else {
            try writer.print("%{X:0>2}", .{character});
        }
    }
}
