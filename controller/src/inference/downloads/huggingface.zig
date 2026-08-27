const std = @import("std");

const Io = std.Io;
const max_metadata_bytes = 8 * 1024 * 1024;
const metadata_timeout = Io.Duration.fromSeconds(30);

pub const File = struct {
    path: []const u8,
    size_bytes: ?u64,
};

pub const Selection = struct {
    arena: std.heap.ArenaAllocator,
    revision: ?[]const u8,
    files: []File,

    pub fn deinit(selection: *Selection) void {
        selection.arena.deinit();
        selection.* = undefined;
    }
};

pub fn select(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, environment: *const std.process.Environ.Map, model_id: []const u8, requested_revision: ?[]const u8, token: ?[]const u8, allow_patterns: []const []const u8, ignore_patterns: []const []const u8) !Selection {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    const owned = arena.allocator();
    const origin_value = environment.get("LOCAL_STUDIO_HF_ORIGIN") orelse "https://huggingface.co";
    const origin = std.mem.trimEnd(u8, std.mem.trim(u8, origin_value, " \t\r\n"), "/");
    if (origin.len == 0) return error.InvalidHuggingFaceOrigin;
    var url: Io.Writer.Allocating = .init(allocator);
    defer url.deinit();
    try url.writer.print("{s}/api/models/", .{origin});
    try writePath(&url.writer, model_id);
    try url.writer.writeAll("?blobs=true");
    if (requested_revision) |revision| {
        try url.writer.writeAll("&revision=");
        try writeQueryValue(&url.writer, revision);
    }
    const body = try fetchMetadata(allocator, io, client, url.writer.buffered(), token);
    defer allocator.free(body);
    var parsed = std.json.parseFromSlice(std.json.Value, owned, body, .{}) catch return error.InvalidHuggingFaceModelInfo;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidHuggingFaceModelInfo;
    const object = parsed.value.object;
    if (object.get("modelId")) |model_value| if (model_value != .string) return error.InvalidHuggingFaceModelInfo;
    const sha = if (object.get("sha")) |sha_value| if (sha_value == .string) sha_value.string else return error.InvalidHuggingFaceModelInfo else null;
    const siblings_value = object.get("siblings");
    if (siblings_value != null and siblings_value.? != .array) return error.InvalidHuggingFaceModelInfo;
    const siblings = if (siblings_value) |value| value.array.items else &.{};
    if (siblings.len > 100_000) return error.TooManyHuggingFaceFiles;
    var files: std.ArrayList(File) = .empty;
    for (siblings) |sibling| {
        if (sibling != .object) return error.InvalidHuggingFaceModelInfo;
        const filename_value = sibling.object.get("rfilename") orelse return error.InvalidHuggingFaceModelInfo;
        if (filename_value != .string) return error.InvalidHuggingFaceModelInfo;
        const filename = filename_value.string;
        const size_bytes = if (sibling.object.get("size")) |size_value| switch (size_value) {
            .null => null,
            .integer => |value| if (value >= 0) @as(?u64, @intCast(value)) else return error.InvalidHuggingFaceModelInfo,
            .float => |value| if (std.math.isFinite(value) and value >= 0 and value <= @as(f64, @floatFromInt(std.math.maxInt(u64))) and @floor(value) == value) @as(?u64, @intFromFloat(value)) else return error.InvalidHuggingFaceModelInfo,
            .number_string => |value| std.fmt.parseInt(u64, value, 10) catch return error.InvalidHuggingFaceModelInfo,
            else => return error.InvalidHuggingFaceModelInfo,
        } else null;
        if (filename.len == 0 or matchesAny(filename, ignore_patterns)) continue;
        if (allow_patterns.len > 0 and !matchesAny(filename, allow_patterns)) continue;
        try files.append(owned, .{ .path = try owned.dupe(u8, filename), .size_bytes = size_bytes });
    }
    if (allow_patterns.len == 0) try rejectMultipleGgufFamilies(owned, siblings);
    if (files.items.len == 0) return error.NoDownloadableFiles;
    return .{
        .arena = arena,
        .revision = if (sha) |value| try owned.dupe(u8, value) else if (requested_revision) |value| try owned.dupe(u8, value) else null,
        .files = try files.toOwnedSlice(owned),
    };
}

fn rejectMultipleGgufFamilies(allocator: std.mem.Allocator, siblings: []const std.json.Value) !void {
    var families: std.StringHashMapUnmanaged(void) = .empty;
    defer {
        var keys = families.keyIterator();
        while (keys.next()) |key| allocator.free(key.*);
        families.deinit(allocator);
    }
    for (siblings) |sibling| {
        if (sibling != .object) continue;
        const value = sibling.object.get("rfilename") orelse continue;
        if (value != .string or !endsWithIgnoreCase(value.string, ".gguf") or auxiliaryGguf(value.string)) continue;
        const family = try ggufFamily(allocator, value.string);
        const entry = try families.getOrPut(allocator, family);
        if (entry.found_existing) allocator.free(family);
        if (families.count() > 1) return error.MultipleGgufVariants;
    }
}

fn ggufFamily(allocator: std.mem.Allocator, filename: []const u8) ![]u8 {
    const extension_start = filename.len - ".gguf".len;
    if (extension_start >= 15) {
        const suffix = filename[extension_start - 15 .. extension_start];
        if (suffix[0] == '-' and std.mem.eql(u8, suffix[6..10], "-of-") and digits(suffix[1..6]) and digits(suffix[10..15])) {
            return std.fmt.allocPrint(allocator, "{s}.gguf", .{filename[0 .. extension_start - 15]});
        }
    }
    return allocator.dupe(u8, filename);
}

fn digits(value: []const u8) bool {
    for (value) |character| if (!std.ascii.isDigit(character)) return false;
    return value.len > 0;
}

fn auxiliaryGguf(filename: []const u8) bool {
    for ([_][]const u8{ "mmproj", "projector", "adapter", "draft" }) |marker| {
        var index: usize = 0;
        while (index + marker.len <= filename.len) : (index += 1) {
            if (!std.ascii.eqlIgnoreCase(filename[index .. index + marker.len], marker)) continue;
            const before = index == 0 or separator(filename[index - 1]);
            const after_index = index + marker.len;
            const after = after_index == filename.len or separator(filename[after_index]);
            if (before and after) return true;
        }
    }
    return false;
}

fn separator(character: u8) bool {
    return character == '-' or character == '_' or character == '.';
}

fn matchesAny(value: []const u8, patterns: []const []const u8) bool {
    for (patterns) |pattern| if (globMatches(value, pattern)) return true;
    return false;
}

fn globMatches(value: []const u8, pattern: []const u8) bool {
    var value_index: usize = 0;
    var pattern_index: usize = 0;
    var star_index: ?usize = null;
    var star_value_index: usize = 0;
    while (value_index < value.len) {
        if (pattern_index < pattern.len and pattern[pattern_index] != '*' and std.ascii.toLower(value[value_index]) == std.ascii.toLower(pattern[pattern_index])) {
            value_index += 1;
            pattern_index += 1;
        } else if (pattern_index < pattern.len and pattern[pattern_index] == '*') {
            star_index = pattern_index;
            pattern_index += 1;
            star_value_index = value_index;
        } else if (star_index) |star| {
            pattern_index = star + 1;
            star_value_index += 1;
            value_index = star_value_index;
        } else return false;
    }
    while (pattern_index < pattern.len and pattern[pattern_index] == '*') pattern_index += 1;
    return pattern_index == pattern.len;
}

fn endsWithIgnoreCase(value: []const u8, suffix: []const u8) bool {
    return value.len >= suffix.len and std.ascii.eqlIgnoreCase(value[value.len - suffix.len ..], suffix);
}

const FetchResult = struct { status: std.http.Status, body: []u8 };

fn fetchMetadata(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, url: []const u8, token: ?[]const u8) ![]u8 {
    const SelectionResult = union(enum) { request: anyerror!FetchResult, timer: Io.Cancelable!void };
    var selections: [2]SelectionResult = undefined;
    var select_request = Io.Select(SelectionResult).init(io, &selections);
    try select_request.concurrent(.request, fetchRequest, .{ allocator, client, url, token });
    select_request.concurrent(.timer, waitForTimeout, .{io}) catch {
        while (select_request.cancel()) |pending| deinitFetch(allocator, pending);
        return error.ConcurrencyUnavailable;
    };
    const selected = try select_request.await();
    switch (selected) {
        .request => |result| {
            select_request.cancelDiscard();
            const response = try result;
            if (response.status.class() != .success) {
                allocator.free(response.body);
                return error.HuggingFaceApiError;
            }
            return response.body;
        },
        .timer => |result| {
            result catch |failure| switch (failure) {
                error.Canceled => return error.Canceled,
            };
            while (select_request.cancel()) |pending| deinitFetch(allocator, pending);
            return error.HuggingFaceMetadataTimeout;
        },
    }
}

fn fetchRequest(allocator: std.mem.Allocator, client: *std.http.Client, url: []const u8, token: ?[]const u8) !FetchResult {
    const storage = try allocator.alloc(u8, max_metadata_bytes);
    defer allocator.free(storage);
    var body: Io.Writer = .fixed(storage);
    var headers: [1]std.http.Header = undefined;
    const extra_headers: []const std.http.Header = if (token) |value| headers: {
        headers[0] = .{ .name = "Authorization", .value = try std.fmt.allocPrint(allocator, "Bearer {s}", .{value}) };
        break :headers headers[0..1];
    } else &.{};
    defer if (extra_headers.len > 0) allocator.free(extra_headers[0].value);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .authorization = .omit },
        .extra_headers = extra_headers,
        .response_writer = &body,
    });
    return .{ .status = response.status, .body = try allocator.dupe(u8, body.buffered()) };
}

fn waitForTimeout(io: Io) Io.Cancelable!void {
    return io.sleep(metadata_timeout, .awake);
}

fn deinitFetch(allocator: std.mem.Allocator, selection: anytype) void {
    switch (selection) {
        .request => |result| if (result) |response| allocator.free(response.body) else |_| {},
        .timer => {},
    }
}

pub fn writePath(writer: *Io.Writer, value: []const u8) !void {
    var segments = std.mem.splitAny(u8, value, "/\\");
    var first = true;
    while (segments.next()) |segment| {
        if (segment.len == 0) continue;
        if (!first) try writer.writeByte('/');
        try writeQueryValue(writer, segment);
        first = false;
    }
}

pub fn writeQueryValue(writer: *Io.Writer, value: []const u8) !void {
    for (value) |character| {
        if (std.ascii.isAlphanumeric(character) or character == '-' or character == '_' or character == '.' or character == '~') {
            try writer.writeByte(character);
        } else {
            try writer.print("%{X:0>2}", .{character});
        }
    }
}
