const std = @import("std");
const provider_settings = @import("store.zig");

const max_catalog_models = 100_000;

pub const Route = struct {
    provider: *const provider_settings.Provider,
    model_id: []const u8,
};

pub fn resolve(providers: []const provider_settings.Provider, requested_model: []const u8) ?Route {
    const delimiter = std.mem.indexOfScalar(u8, requested_model, '/') orelse return null;
    if (delimiter == 0 or delimiter + 1 >= requested_model.len) return null;
    const provider_id = std.mem.trim(u8, requested_model[0..delimiter], " \t\r\n");
    const model_id = std.mem.trim(u8, requested_model[delimiter + 1 ..], " \t\r\n");
    if (provider_id.len == 0 or model_id.len == 0) return null;
    for (providers) |*provider| {
        if (provider.enabled and provider.api_key.len > 0 and std.ascii.eqlIgnoreCase(provider.id, provider_id)) return .{ .provider = provider, .model_id = model_id };
    }
    return null;
}

pub fn rewriteModel(allocator: std.mem.Allocator, parsed: *std.json.Parsed(std.json.Value), model_id: []const u8) ![]u8 {
    if (parsed.value != .object) return error.InvalidInferencePayload;
    try parsed.value.object.put(parsed.arena.allocator(), "model", .{ .string = try parsed.arena.allocator().dupe(u8, model_id) });
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    return output.toOwnedSlice();
}

pub fn mergedModelCatalog(allocator: std.mem.Allocator, worker_document: []const u8, provider_document: []const u8) ![]u8 {
    var workers = std.json.parseFromSlice(std.json.Value, allocator, worker_document, .{}) catch return error.InvalidWorkerCatalog;
    defer workers.deinit();
    var providers = std.json.parseFromSlice(std.json.Value, allocator, provider_document, .{}) catch return error.InvalidProviderCatalog;
    defer providers.deinit();
    if (workers.value != .object or providers.value != .object) return error.InvalidProviderCatalog;
    const worker_data = workers.value.object.get("data") orelse return error.InvalidWorkerCatalog;
    const provider_data = providers.value.object.get("providers") orelse return error.InvalidProviderCatalog;
    if (worker_data != .array or provider_data != .array) return error.InvalidProviderCatalog;
    var count: usize = worker_data.array.items.len;
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"object\":\"list\",\"data\":[");
    for (worker_data.array.items, 0..) |model, index| {
        if (index > 0) try output.writer.writeByte(',');
        try std.json.Stringify.value(model, .{}, &output.writer);
    }
    for (provider_data.array.items) |provider| {
        if (provider != .object) return error.InvalidProviderCatalog;
        const provider_id = provider.object.get("provider") orelse return error.InvalidProviderCatalog;
        const models = provider.object.get("models") orelse return error.InvalidProviderCatalog;
        if (provider_id != .string or models != .array) return error.InvalidProviderCatalog;
        for (models.array.items) |model| {
            if (count >= max_catalog_models or model != .object) return error.InvalidProviderCatalog;
            const model_id = model.object.get("id") orelse continue;
            if (model_id != .string or model_id.string.len == 0) continue;
            if (count > 0) try output.writer.writeByte(',');
            count += 1;
            const namespaced = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ provider_id.string, model_id.string });
            defer allocator.free(namespaced);
            try output.writer.writeAll("{\"id\":");
            try std.json.Stringify.value(namespaced, .{}, &output.writer);
            try output.writer.writeAll(",\"object\":\"model\",\"created\":0,\"owned_by\":");
            try std.json.Stringify.value(provider_id.string, .{}, &output.writer);
            try output.writer.writeAll(",\"metadata\":{\"provider\":");
            try std.json.Stringify.value(provider_id.string, .{}, &output.writer);
            if (model.object.get("name")) |name| if (name == .string) {
                try output.writer.writeAll(",\"name\":");
                try std.json.Stringify.value(name.string, .{}, &output.writer);
            };
            try output.writer.writeAll("}}");
        }
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn mergeProviderCatalogs(allocator: std.mem.Allocator, first_document: []const u8, second_document: []const u8) ![]u8 {
    var first = std.json.parseFromSlice(std.json.Value, allocator, first_document, .{}) catch return error.InvalidProviderCatalog;
    defer first.deinit();
    var second = std.json.parseFromSlice(std.json.Value, allocator, second_document, .{}) catch return error.InvalidProviderCatalog;
    defer second.deinit();
    if (first.value != .object or second.value != .object) return error.InvalidProviderCatalog;
    const first_providers = first.value.object.get("providers") orelse return error.InvalidProviderCatalog;
    const second_providers = second.value.object.get("providers") orelse return error.InvalidProviderCatalog;
    if (first_providers != .array or second_providers != .array) return error.InvalidProviderCatalog;
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"providers\":[");
    var count: usize = 0;
    for (first_providers.array.items) |provider| {
        if (count > 0) try output.writer.writeByte(',');
        try std.json.Stringify.value(provider, .{}, &output.writer);
        count += 1;
    }
    for (second_providers.array.items) |provider| {
        if (count > 0) try output.writer.writeByte(',');
        try std.json.Stringify.value(provider, .{}, &output.writer);
        count += 1;
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}
