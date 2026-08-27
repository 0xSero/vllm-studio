const std = @import("std");
const contract = @import("model_catalog_contract");

const Io = std.Io;

pub const ProviderModels = struct {
    allocator: std.mem.Allocator,
    document: []u8,
    count: usize,

    pub fn deinit(models: *ProviderModels) void {
        models.allocator.free(models.document);
        models.* = undefined;
    }
};

pub fn providerModels(allocator: std.mem.Allocator, provider_id: []const u8) !ProviderModels {
    var catalog = std.json.parseFromSlice(std.json.Value, allocator, contract.document, .{}) catch return error.InvalidModelCatalog;
    defer catalog.deinit();
    if (catalog.value != .object) return error.InvalidModelCatalog;
    const models = catalog.value.object.get("models") orelse return error.InvalidModelCatalog;
    if (models != .array) return error.InvalidModelCatalog;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeByte('[');
    var count: usize = 0;
    for (models.array.items) |model| {
        if (model != .object) continue;
        const route = providerRoute(model.object, provider_id) orelse continue;
        if (count > 0) try output.writer.writeByte(',');
        count += 1;
        const id = stringField(route, "model") orelse continue;
        const name = stringField(model.object, "name") orelse id;
        const context_window = positive(model.object.get("contextWindow")) orelse 128_000;
        const max_output = positive(model.object.get("maxOutputTokens")) orelse 65_536;
        const capabilities = objectField(model.object, "capabilities");
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(id, .{}, &output.writer);
        try output.writer.writeAll(",\"name\":");
        try std.json.Stringify.value(name, .{}, &output.writer);
        try output.writer.print(",\"contextWindow\":{d},\"maxTokens\":{d},\"reasoning\":{},\"vision\":{}}}", .{
            context_window,
            max_output,
            if (capabilities) |value| explicitBool(value.get("reasoning")) orelse false else false,
            if (capabilities) |value| stringArrayContains(value.get("input"), "image") else false,
        });
    }
    try output.writer.writeByte(']');
    return .{ .allocator = allocator, .document = try output.toOwnedSlice(), .count = count };
}

pub fn providerHasModel(allocator: std.mem.Allocator, provider_id: []const u8, model_id: []const u8) !bool {
    var catalog = std.json.parseFromSlice(std.json.Value, allocator, contract.document, .{}) catch return error.InvalidModelCatalog;
    defer catalog.deinit();
    if (catalog.value != .object) return error.InvalidModelCatalog;
    const models = catalog.value.object.get("models") orelse return error.InvalidModelCatalog;
    if (models != .array) return error.InvalidModelCatalog;
    for (models.array.items) |model| {
        if (model != .object) continue;
        const route = providerRoute(model.object, provider_id) orelse continue;
        if (stringField(route, "model")) |id| if (std.mem.eql(u8, id, model_id)) return true;
    }
    return false;
}

pub fn offersPayload(allocator: std.mem.Allocator, runtime_document: []const u8, controller_url: []const u8) ![]u8 {
    var catalog = std.json.parseFromSlice(std.json.Value, allocator, contract.document, .{}) catch return error.InvalidModelCatalog;
    defer catalog.deinit();
    var runtime = std.json.parseFromSlice(std.json.Value, allocator, runtime_document, .{}) catch return error.InvalidRuntimeModelCatalog;
    defer runtime.deinit();
    if (catalog.value != .object or runtime.value != .object) return error.InvalidModelCatalog;
    const models = catalog.value.object.get("models") orelse return error.InvalidModelCatalog;
    const labs = catalog.value.object.get("labs") orelse return error.InvalidModelCatalog;
    const data = runtime.value.object.get("data") orelse return error.InvalidRuntimeModelCatalog;
    if (models != .array or labs != .array or data != .array) return error.InvalidModelCatalog;

    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"version\":");
    if (catalog.value.object.get("version")) |version| try std.json.Stringify.value(version, .{}, &output.writer) else try output.writer.writeByte('1');
    try output.writer.writeAll(",\"updated\":");
    if (catalog.value.object.get("updated")) |updated| try std.json.Stringify.value(updated, .{}, &output.writer) else try output.writer.writeAll("\"\"");
    try output.writer.writeAll(",\"models\":[");
    var wrote_model = false;
    for (models.array.items) |model| {
        if (model != .object) continue;
        if (wrote_model) try output.writer.writeByte(',');
        wrote_model = true;
        try writeCatalogOffer(&output.writer, model.object, labs.array.items, data.array.items, controller_url);
    }
    for (data.array.items) |runtime_model| {
        if (runtime_model != .object) continue;
        if (findCatalogModel(models.array.items, runtime_model.object) != null) continue;
        if (wrote_model) try output.writer.writeByte(',');
        wrote_model = true;
        try writeCustomOffer(&output.writer, runtime_model.object, controller_url);
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn canonicalId(allocator: std.mem.Allocator, requested: []const u8) !?[]u8 {
    var catalog = std.json.parseFromSlice(std.json.Value, allocator, contract.document, .{}) catch return error.InvalidModelCatalog;
    defer catalog.deinit();
    if (catalog.value != .object) return error.InvalidModelCatalog;
    const models = catalog.value.object.get("models") orelse return error.InvalidModelCatalog;
    if (models != .array) return error.InvalidModelCatalog;
    for (models.array.items) |model| {
        if (model != .object) continue;
        const id = stringField(model.object, "id") orelse continue;
        if (std.ascii.eqlIgnoreCase(id, requested) or matchesAliases(model.object, requested)) return @as(?[]u8, try allocator.dupe(u8, id));
        const routes = model.object.get("routes") orelse continue;
        if (routes != .array) continue;
        for (routes.array.items) |route| {
            if (route != .object) continue;
            const route_model = stringField(route.object, "model") orelse continue;
            if (std.ascii.eqlIgnoreCase(route_model, requested)) return @as(?[]u8, try allocator.dupe(u8, id));
        }
    }
    return null;
}

pub fn routeForModel(allocator: std.mem.Allocator, runtime_document: []const u8, model_id: []const u8, preferred_route: ?[]const u8) !?[]u8 {
    var catalog = std.json.parseFromSlice(std.json.Value, allocator, contract.document, .{}) catch return error.InvalidModelCatalog;
    defer catalog.deinit();
    var runtime = std.json.parseFromSlice(std.json.Value, allocator, runtime_document, .{}) catch return error.InvalidRuntimeModelCatalog;
    defer runtime.deinit();
    if (catalog.value != .object or runtime.value != .object) return error.InvalidModelCatalog;
    const models = catalog.value.object.get("models") orelse return error.InvalidModelCatalog;
    const data = runtime.value.object.get("data") orelse return error.InvalidRuntimeModelCatalog;
    if (models != .array or data != .array) return error.InvalidModelCatalog;
    const canonical = findCatalogModelById(models.array.items, model_id) orelse return null;
    if (preferred_route) |route_id| {
        for (data.array.items) |runtime_model| {
            if (runtime_model != .object) continue;
            const id = stringField(runtime_model.object, "id") orelse continue;
            if (!std.mem.eql(u8, id, route_id) or !runtimeMatches(canonical, runtime_model.object) or !runtimeReady(runtime_model.object)) continue;
            return @as(?[]u8, try allocator.dupe(u8, id));
        }
        return null;
    }
    for (data.array.items) |runtime_model| {
        if (runtime_model != .object or !runtimeMatches(canonical, runtime_model.object)) continue;
        const id = stringField(runtime_model.object, "id") orelse continue;
        if (runtimeReady(runtime_model.object)) return @as(?[]u8, try allocator.dupe(u8, id));
    }
    return null;
}

fn writeCatalogOffer(writer: *Io.Writer, model: std.json.ObjectMap, labs: []const std.json.Value, runtime_models: []const std.json.Value, controller_url: []const u8) !void {
    const id = stringField(model, "id") orelse "";
    const name = stringField(model, "name") orelse id;
    const lab_id = stringField(model, "lab") orelse "local";
    const family = stringField(model, "family") orelse id;
    const lifecycle = stringField(model, "lifecycle") orelse "active";
    const capabilities = model.get("capabilities") orelse return error.InvalidModelCatalog;
    const context_window = positive(model.get("contextWindow")) orelse 128_000;
    const max_output = positive(model.get("maxOutputTokens")) orelse @min(context_window, 65_536);
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, writer);
    try writer.writeAll(",\"name\":");
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeAll(",\"lab\":");
    try writeLab(writer, labs, lab_id);
    try writer.writeAll(",\"family\":");
    try std.json.Stringify.value(family, .{}, writer);
    try writer.writeAll(",\"lifecycle\":");
    try std.json.Stringify.value(lifecycle, .{}, writer);
    try writer.writeAll(",\"capabilities\":");
    try std.json.Stringify.value(capabilities, .{}, writer);
    try writer.print(",\"contextWindow\":{d},\"maxOutputTokens\":{d},\"routes\":[", .{ context_window, max_output });
    var wrote_route = false;
    var default_route: ?[]const u8 = null;
    for (runtime_models) |runtime_model| {
        if (runtime_model != .object or !runtimeMatches(model, runtime_model.object)) continue;
        const route_id = stringField(runtime_model.object, "id") orelse continue;
        if (wrote_route) try writer.writeByte(',');
        wrote_route = true;
        if (default_route == null and runtimeReady(runtime_model.object)) default_route = route_id;
        try writeRoute(writer, model, runtime_model.object, controller_url, context_window, max_output);
    }
    try writer.writeAll("],\"defaultRouteId\":");
    if (default_route) |route_id| try std.json.Stringify.value(route_id, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"available\":");
    try writer.writeAll(if (default_route != null) "true" else "false");
    try writer.writeAll(",\"custom\":false}");
}

fn writeCustomOffer(writer: *Io.Writer, runtime_model: std.json.ObjectMap, controller_url: []const u8) !void {
    const id = stringField(runtime_model, "id") orelse "unknown";
    const metadata = objectField(runtime_model, "metadata");
    const name = stringField(runtime_model, "name") orelse if (metadata) |value| stringField(value, "name") orelse id else id;
    const context_window = firstPositive(&.{ runtime_model.get("contextWindow"), runtime_model.get("context_window"), runtime_model.get("max_model_len"), if (metadata) |value| value.get("contextWindow") else null }, 128_000);
    const max_output = firstPositive(&.{ runtime_model.get("maxTokens"), runtime_model.get("max_tokens"), if (metadata) |value| value.get("maxTokens") else null }, @min(context_window, 65_536));
    const reasoning = explicitBool(runtime_model.get("reasoning")) orelse if (metadata) |value| explicitBool(value.get("reasoning")) orelse false else false;
    const vision = if (metadata) |value| explicitBool(value.get("vision")) orelse false else false;
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, writer);
    try writer.writeAll(",\"name\":");
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeAll(",\"lab\":{\"id\":\"local\",\"name\":\"Local\",\"logo\":null},\"family\":");
    try std.json.Stringify.value(id, .{}, writer);
    try writer.writeAll(",\"lifecycle\":\"active\",\"capabilities\":{\"input\":[\"text\"");
    if (vision) try writer.writeAll(",\"image\"");
    try writer.writeAll("],\"output\":[\"text\"],\"tools\":true,\"reasoning\":");
    try writer.writeAll(if (reasoning) "true" else "false");
    try writer.writeAll(",\"thinkingLevels\":");
    try writer.writeAll(if (reasoning) "[\"off\",\"auto\",\"low\",\"medium\",\"high\",\"max\"]" else "[\"off\"]");
    try writer.print("}},\"contextWindow\":{d},\"maxOutputTokens\":{d},\"routes\":[", .{ context_window, max_output });
    try writeRoute(writer, null, runtime_model, controller_url, context_window, max_output);
    try writer.writeAll("],\"defaultRouteId\":");
    try std.json.Stringify.value(id, .{}, writer);
    try writer.writeAll(",\"available\":true,\"custom\":true}");
}

fn writeRoute(writer: *Io.Writer, catalog_model: ?std.json.ObjectMap, runtime_model: std.json.ObjectMap, controller_url: []const u8, default_context: u64, default_output: u64) !void {
    const id = stringField(runtime_model, "id") orelse "unknown";
    const metadata = objectField(runtime_model, "metadata");
    const provider = providerId(runtime_model, metadata, id);
    const raw_model = rawModelId(provider, id);
    const context_window = firstPositive(&.{ runtime_model.get("contextWindow"), runtime_model.get("context_window"), runtime_model.get("max_model_len"), if (metadata) |value| value.get("contextWindow") else null }, default_context);
    const max_output = firstPositive(&.{ runtime_model.get("maxTokens"), runtime_model.get("max_tokens"), if (metadata) |value| value.get("maxTokens") else null }, default_output);
    const active = runtimeReady(runtime_model);
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, writer);
    try writer.writeAll(",\"providerId\":");
    try std.json.Stringify.value(provider, .{}, writer);
    try writer.writeAll(",\"label\":");
    try std.json.Stringify.value(providerLabel(provider), .{}, writer);
    try writer.writeAll(",\"rawModelId\":");
    try std.json.Stringify.value(raw_model, .{}, writer);
    try writer.writeAll(",\"status\":");
    try std.json.Stringify.value(if (active) "ready" else "stopped", .{}, writer);
    try writer.writeAll(",\"protocols\":");
    try writeProtocols(writer, catalog_model, runtime_model, provider, raw_model);
    try writer.print(",\"contextWindow\":{d},\"maxOutputTokens\":{d},\"active\":{},\"controllerUrl\":", .{ context_window, max_output, active });
    try std.json.Stringify.value(controller_url, .{}, writer);
    try writer.writeByte('}');
}

fn writeProtocols(writer: *Io.Writer, catalog_model: ?std.json.ObjectMap, runtime_model: std.json.ObjectMap, provider: []const u8, raw_model: []const u8) !void {
    if (objectField(runtime_model, "metadata")) |metadata| if (stringField(metadata, "api")) |api| {
        if (std.mem.eql(u8, api, "openai-responses") or std.mem.eql(u8, api, "openai-completions")) {
            try writer.writeAll("[");
            try std.json.Stringify.value(api, .{}, writer);
            try writer.writeAll("]");
            return;
        }
    };
    if (catalog_model) |model| if (matchingRoute(model, provider, raw_model)) |route| if (route.get("protocols")) |protocols| {
        try std.json.Stringify.value(protocols, .{}, writer);
        return;
    };
    try writer.writeAll("[\"openai-completions\",\"openai-responses\"]");
}

fn writeLab(writer: *Io.Writer, labs: []const std.json.Value, lab_id: []const u8) !void {
    for (labs) |lab| {
        if (lab != .object) continue;
        const id = stringField(lab.object, "id") orelse continue;
        if (!std.mem.eql(u8, id, lab_id)) continue;
        try std.json.Stringify.value(lab, .{}, writer);
        return;
    }
    try writer.writeAll("{\"id\":\"local\",\"name\":\"Local\",\"logo\":null}");
}

fn findCatalogModel(models: []const std.json.Value, runtime_model: std.json.ObjectMap) ?std.json.ObjectMap {
    for (models) |model| {
        if (model != .object) continue;
        if (runtimeMatches(model.object, runtime_model)) return model.object;
    }
    return null;
}

fn findCatalogModelById(models: []const std.json.Value, model_id: []const u8) ?std.json.ObjectMap {
    for (models) |model| {
        if (model != .object) continue;
        const id = stringField(model.object, "id") orelse continue;
        if (std.ascii.eqlIgnoreCase(id, model_id) or matchesAliases(model.object, model_id)) return model.object;
    }
    return null;
}

fn runtimeMatches(model: std.json.ObjectMap, runtime_model: std.json.ObjectMap) bool {
    const runtime_id = stringField(runtime_model, "id") orelse return false;
    const metadata = objectField(runtime_model, "metadata");
    const provider = providerId(runtime_model, metadata, runtime_id);
    const raw_model = rawModelId(provider, runtime_id);
    const id = stringField(model, "id") orelse return false;
    if (std.ascii.eqlIgnoreCase(id, runtime_id) or std.ascii.eqlIgnoreCase(id, raw_model)) return true;
    if (matchesAliases(model, runtime_id) or matchesAliases(model, raw_model)) return true;
    return matchingRoute(model, provider, raw_model) != null;
}

fn matchingRoute(model: std.json.ObjectMap, provider: []const u8, raw_model: []const u8) ?std.json.ObjectMap {
    const routes = model.get("routes") orelse return null;
    if (routes != .array) return null;
    for (routes.array.items) |route| {
        if (route != .object) continue;
        const route_model = stringField(route.object, "model") orelse continue;
        if (!std.ascii.eqlIgnoreCase(route_model, raw_model)) continue;
        const expected_provider = stringField(route.object, "provider");
        if (expected_provider == null or std.ascii.eqlIgnoreCase(expected_provider.?, provider)) return route.object;
    }
    return null;
}

fn providerRoute(model: std.json.ObjectMap, provider: []const u8) ?std.json.ObjectMap {
    const routes = model.get("routes") orelse return null;
    if (routes != .array) return null;
    for (routes.array.items) |route| {
        if (route != .object) continue;
        const route_provider = stringField(route.object, "provider") orelse continue;
        if (std.ascii.eqlIgnoreCase(route_provider, provider)) return route.object;
    }
    return null;
}

fn stringArrayContains(value: ?std.json.Value, expected: []const u8) bool {
    const array = value orelse return false;
    if (array != .array) return false;
    for (array.array.items) |item| if (item == .string and std.mem.eql(u8, item.string, expected)) return true;
    return false;
}

fn matchesAliases(model: std.json.ObjectMap, value: []const u8) bool {
    const aliases = model.get("aliases") orelse return false;
    if (aliases != .array) return false;
    for (aliases.array.items) |alias| if (alias == .string and std.ascii.eqlIgnoreCase(alias.string, value)) return true;
    return false;
}

fn providerId(runtime_model: std.json.ObjectMap, metadata: ?std.json.ObjectMap, id: []const u8) []const u8 {
    if (metadata) |value| if (stringField(value, "provider")) |provider| return provider;
    if (stringField(runtime_model, "owned_by")) |owner| if (!std.mem.eql(u8, owner, "local-studio")) return owner;
    const delimiter = std.mem.indexOfScalar(u8, id, '/') orelse return "local";
    const prefix = id[0..delimiter];
    for ([_][]const u8{ "openai-codex", "cursor", "openrouter", "openai", "anthropic", "google", "xai", "groq", "together", "fireworks", "deepinfra", "ollama", "lmstudio" }) |candidate| {
        if (std.ascii.eqlIgnoreCase(prefix, candidate)) return prefix;
    }
    return "local";
}

fn rawModelId(provider: []const u8, id: []const u8) []const u8 {
    if (std.mem.eql(u8, provider, "local")) return id;
    const delimiter = std.mem.indexOfScalar(u8, id, '/') orelse return id;
    return id[delimiter + 1 ..];
}

fn providerLabel(provider: []const u8) []const u8 {
    if (std.ascii.eqlIgnoreCase(provider, "openai-codex")) return "OpenAI subscription";
    if (std.ascii.eqlIgnoreCase(provider, "openrouter")) return "OpenRouter";
    if (std.ascii.eqlIgnoreCase(provider, "cursor")) return "Cursor";
    if (std.ascii.eqlIgnoreCase(provider, "local")) return "Local";
    return provider;
}

fn runtimeReady(model: std.json.ObjectMap) bool {
    const metadata = objectField(model, "metadata");
    const id = stringField(model, "id") orelse "";
    const provider = providerId(model, metadata, id);
    if (!std.mem.eql(u8, provider, "local")) return true;
    return explicitBool(model.get("active")) orelse if (metadata) |value| explicitBool(value.get("active")) orelse false else false;
}

fn objectField(object: std.json.ObjectMap, name: []const u8) ?std.json.ObjectMap {
    const value = object.get(name) orelse return null;
    return if (value == .object) value.object else null;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn firstPositive(values: []const ?std.json.Value, fallback: u64) u64 {
    for (values) |value| if (positive(value)) |number| return number;
    return fallback;
}

fn positive(value: ?std.json.Value) ?u64 {
    const present = value orelse return null;
    const number: i64 = switch (present) {
        .integer => |integer| integer,
        .float => |float| @intFromFloat(float),
        .number_string => |text| std.fmt.parseInt(i64, text, 10) catch return null,
        else => return null,
    };
    return if (number > 0) @intCast(number) else null;
}

fn explicitBool(value: ?std.json.Value) ?bool {
    const present = value orelse return null;
    return if (present == .bool) present.bool else null;
}
