const std = @import("std");
const config = @import("../../app/config.zig");
const account_repository = @import("../../accounts/store.zig");
const repository = @import("store.zig");
const coordinator = @import("../sessions/coordinator.zig");
const run_completion = @import("../sessions/run_completion.zig");
const agent_models = @import("../models/service.zig");
const session_change = @import("../sessions/change.zig");
const workbench_change = @import("../../workbench/change.zig");
const harness_runtime = @import("../harness/runtime.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 8 * 1024 * 1024;

const RouteMenuKind = enum { provider, context };

const TelegramCommand = struct {
    name: []const u8,
};

const TypingPulse = struct {
    manager: *Manager,
    client: *http.Client,
    account_id: []const u8,
    conversation_id: []const u8,
};

const BotAccount = struct {
    allocator: std.mem.Allocator,
    id: []u8,

    fn deinit(account: *BotAccount) void {
        account.allocator.free(account.id);
        account.* = undefined;
    }
};

const BotAccountList = struct {
    allocator: std.mem.Allocator,
    accounts: std.ArrayList(BotAccount) = .empty,

    fn deinit(list: *BotAccountList) void {
        for (list.accounts.items) |*account| account.deinit();
        list.accounts.deinit(list.allocator);
        list.* = undefined;
    }
};

const BotConfiguration = struct {
    allocator: std.mem.Allocator,
    token: []u8,
    public_key: ?[]u8,

    fn deinit(configuration: *BotConfiguration) void {
        configuration.allocator.free(configuration.token);
        if (configuration.public_key) |value| configuration.allocator.free(value);
        configuration.* = undefined;
    }
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []u8,
    environment: *const std.process.Environ.Map,
    configuration_state: *const config.Config,
    registered_accounts: std.StringHashMapUnmanaged(void) = .empty,

    pub fn init(allocator: std.mem.Allocator, io: Io, configuration_state: *const config.Config) !Manager {
        return .{ .allocator = allocator, .io = io, .data_dir = try allocator.dupe(u8, configuration_state.data_dir), .environment = configuration_state.environment, .configuration_state = configuration_state };
    }

    pub fn deinit(manager: *Manager) void {
        var iterator = manager.registered_accounts.keyIterator();
        while (iterator.next()) |key| manager.allocator.free(key.*);
        manager.registered_accounts.deinit(manager.allocator);
        manager.allocator.free(manager.data_dir);
        manager.* = undefined;
    }

    pub fn runTelegramPoller(manager: *Manager, mode: config.Mode, client: *http.Client, database: *sqlite.Database, harness: *harness_runtime.Manager) Io.Cancelable!void {
        while (true) {
            var accounts = manager.botAccounts("telegram") catch |failure| {
                std.log.warn("Telegram account discovery failed: {t}", .{failure});
                try manager.io.sleep(.fromSeconds(5), .awake);
                continue;
            };
            defer accounts.deinit();
            for (accounts.accounts.items) |account| manager.pollTelegram(mode, client, database, harness, account.id) catch |failure| std.log.warn("Telegram polling failed for account {s}: {t}", .{ account.id, failure });
            try manager.io.sleep(.fromSeconds(2), .awake);
        }
    }

    pub fn runDispatcher(manager: *Manager, mode: config.Mode, client: *http.Client, database: *sqlite.Database, harness: *harness_runtime.Manager) Io.Cancelable!void {
        while (true) {
            var message = blk: {
                try database.lock(manager.io);
                defer database.unlock(manager.io);
                break :blk repository.takeNext(manager.allocator, database) catch |failure| {
                    std.log.warn("Messaging queue read failed: {t}", .{failure});
                    break :blk null;
                };
            };
            if (message == null) {
                try manager.io.sleep(.fromMilliseconds(500), .awake);
                continue;
            }
            defer message.?.deinit();
            manager.dispatch(mode, client, database, harness, &message.?) catch |failure| {
                lockedFinish(manager.io, database, message.?.id, @errorName(failure)) catch {};
                manager.sendReply(client, message.?.provider, message.?.account_id, message.?.conversation_id, "The Chat run failed. Check Local Studio and try again.") catch {};
                continue;
            };
            lockedFinish(manager.io, database, message.?.id, null) catch |failure| {
                std.log.warn("Messaging queue completion failed for {s}: {t}", .{ message.?.id, failure });
            };
        }
    }

    pub fn accessPayload(manager: *Manager, database: *sqlite.Database) ![]u8 {
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        return repository.accessPayload(manager.allocator, database);
    }

    pub fn defaultsPayload(manager: *Manager, database: *sqlite.Database) ![]u8 {
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        return repository.defaultsPayload(manager.allocator, database);
    }

    pub fn updateDefaultsPayload(manager: *Manager, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidMessagingDefaults;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidMessagingDefaults;
        const model_id = stringField(parsed.value.object, "modelId") orelse return error.MessagingModelRequired;
        const route_id = stringField(parsed.value.object, "modelRouteId") orelse return error.MessagingModelRequired;
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        try repository.setDefaults(database, model_id, route_id);
        return repository.defaultsPayload(manager.allocator, database);
    }

    pub fn approvePayload(manager: *Manager, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidPairingPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidPairingPayload;
        const pairing_id = stringField(parsed.value.object, "pairingId") orelse return error.PairingIdRequired;
        const code = stringField(parsed.value.object, "code") orelse return error.PairingCodeRequired;
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        try repository.approve(database, pairing_id, code);
        return repository.accessPayload(manager.allocator, database);
    }

    pub fn revokePayload(manager: *Manager, database: *sqlite.Database, provider: []const u8, account_id: []const u8, external_user_id: []const u8) ![]u8 {
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        try repository.revoke(database, provider, account_id, external_user_id);
        return repository.accessPayload(manager.allocator, database);
    }

    pub fn discordInteractionPayload(manager: *Manager, database: *sqlite.Database, account_id: []const u8, timestamp: []const u8, signature: []const u8, document: []const u8) ![]u8 {
        var bot = try manager.configuration(account_id, "discord");
        defer bot.deinit();
        try verifyDiscord(manager.allocator, timestamp, signature, document, bot.public_key orelse return error.DiscordPublicKeyRequired);
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidDiscordInteraction;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidDiscordInteraction;
        const interaction_type = integerField(parsed.value.object, "type") orelse return error.InvalidDiscordInteraction;
        if (interaction_type == 1) return manager.allocator.dupe(u8, "{\"type\":1}");
        if (interaction_type != 2 or parsed.value.object.get("guild_id") != null) return discordResponse(manager.allocator, "Direct-message Chat commands only.");
        const data = objectField(parsed.value.object, "data") orelse return error.InvalidDiscordInteraction;
        if (!std.mem.eql(u8, stringField(data, "name") orelse "", "chat")) return discordResponse(manager.allocator, "Use the /chat command.");
        const prompt = discordPrompt(data) orelse return discordResponse(manager.allocator, "Add a prompt to /chat.");
        const user = objectField(parsed.value.object, "user") orelse return error.InvalidDiscordInteraction;
        const external_user_id = stringField(user, "id") orelse return error.InvalidDiscordInteraction;
        const label = stringField(user, "global_name") orelse stringField(user, "username");
        const channel_id = stringField(parsed.value.object, "channel_id") orelse return error.InvalidDiscordInteraction;
        const interaction_id = stringField(parsed.value.object, "id") orelse return error.InvalidDiscordInteraction;
        const decision = try manager.authorizeOrQueue(database, "discord", account_id, external_user_id, label, channel_id, interaction_id, prompt);
        defer manager.allocator.free(decision);
        return discordResponse(manager.allocator, decision);
    }

    fn pollTelegram(manager: *Manager, mode: config.Mode, client: *http.Client, database: *sqlite.Database, harness: *harness_runtime.Manager, account_id: []const u8) !void {
        var bot = try manager.configuration(account_id, "telegram");
        defer bot.deinit();
        try manager.registerTelegramCommands(client, account_id, bot.token);
        const offset = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk try repository.cursor(manager.allocator, database, "telegram", account_id);
        };
        defer if (offset) |value| manager.allocator.free(value);
        const path = try std.fmt.allocPrint(manager.allocator, "/getUpdates?timeout=1&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D&offset={s}", .{offset orelse "0"});
        defer manager.allocator.free(path);
        const response = try telegramRequest(manager.allocator, client, bot.token, path, .GET, null);
        defer manager.allocator.free(response);
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, response, .{}) catch return error.InvalidTelegramResponse;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidTelegramResponse;
        const result = parsed.value.object.get("result") orelse return error.InvalidTelegramResponse;
        if (result != .array) return error.InvalidTelegramResponse;
        var next_offset: ?i64 = null;
        for (result.array.items) |update| {
            if (update != .object) continue;
            const update_id = integerField(update.object, "update_id") orelse continue;
            next_offset = @max(next_offset orelse 0, update_id + 1);
            if (update.object.get("callback_query")) |callback| {
                if (callback == .object) manager.handleTelegramCallback(client, database, bot.token, account_id, callback.object) catch |failure| std.log.warn("Telegram callback failed for account {s}: {t}", .{ account_id, failure });
                continue;
            }
            const message = update.object.get("message") orelse continue;
            if (message != .object) continue;
            const chat = objectField(message.object, "chat") orelse continue;
            if (!std.mem.eql(u8, stringField(chat, "type") orelse "", "private")) continue;
            const from = objectField(message.object, "from") orelse continue;
            if (booleanField(from, "is_bot") orelse false) continue;
            const prompt = stringField(message.object, "text") orelse continue;
            const user_id = integerField(from, "id") orelse continue;
            const chat_id = integerField(chat, "id") orelse continue;
            const message_id = integerField(message.object, "message_id") orelse continue;
            var user_buffer: [32]u8 = undefined;
            var chat_buffer: [32]u8 = undefined;
            var message_buffer: [32]u8 = undefined;
            const user_text = try std.fmt.bufPrint(&user_buffer, "{d}", .{user_id});
            const chat_text = try std.fmt.bufPrint(&chat_buffer, "{d}", .{chat_id});
            const message_text = try std.fmt.bufPrint(&message_buffer, "{d}", .{message_id});
            const label = stringField(from, "username") orelse stringField(from, "first_name");
            if (try manager.authorizationDecision(database, "telegram", account_id, user_text, label)) |decision| {
                defer manager.allocator.free(decision);
                try manager.sendTelegram(client, bot.token, chat_text, decision);
                continue;
            }
            if (telegramCommand(prompt)) |command| {
                try manager.handleTelegramCommand(mode, client, database, harness, bot.token, account_id, user_text, chat_text, command);
                continue;
            }
            const decision = try manager.enqueueAuthorized(database, "telegram", account_id, user_text, chat_text, message_text, prompt);
            defer manager.allocator.free(decision);
            if (decision.len > 0) try manager.sendTelegram(client, bot.token, chat_text, decision);
        }
        if (next_offset) |value| {
            var buffer: [32]u8 = undefined;
            const text = try std.fmt.bufPrint(&buffer, "{d}", .{value});
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            try repository.saveCursor(database, "telegram", account_id, text);
        }
    }

    fn authorizeOrQueue(manager: *Manager, database: *sqlite.Database, provider: []const u8, account_id: []const u8, external_user_id: []const u8, label: ?[]const u8, conversation_id: []const u8, external_message_id: []const u8, prompt: []const u8) ![]u8 {
        if (prompt.len > 64 * 1024) return manager.allocator.dupe(u8, "That message is too large.");
        if (try manager.authorizationDecision(database, provider, account_id, external_user_id, label)) |decision| return decision;
        return manager.enqueueAuthorized(database, provider, account_id, external_user_id, conversation_id, external_message_id, prompt);
    }

    fn authorizationDecision(manager: *Manager, database: *sqlite.Database, provider: []const u8, account_id: []const u8, external_user_id: []const u8, label: ?[]const u8) !?[]u8 {
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        if (!try repository.allowed(database, provider, account_id, external_user_id)) {
            return @as(?[]u8, switch (try repository.requestPairing(database, manager.io, provider, account_id, external_user_id, label)) {
                .existing => try manager.allocator.dupe(u8, "Pairing is waiting for local approval in Local Studio."),
                .limited => try manager.allocator.dupe(u8, "Too many pairing attempts. Try again in an hour."),
                .code => |code| try std.fmt.allocPrint(manager.allocator, "Pairing code: {s}\nEnter this code in Local Studio within one hour.", .{code[0..]}),
            });
        }
        return null;
    }

    fn enqueueAuthorized(manager: *Manager, database: *sqlite.Database, provider: []const u8, account_id: []const u8, external_user_id: []const u8, conversation_id: []const u8, external_message_id: []const u8, prompt: []const u8) ![]u8 {
        if (prompt.len > 64 * 1024) return manager.allocator.dupe(u8, "That message is too large.");
        try database.lock(manager.io);
        defer database.unlock(manager.io);
        if (!try repository.rateAllowed(database, provider, account_id, external_user_id)) return manager.allocator.dupe(u8, "Rate limit reached. Try again in a minute.");
        var conversation = try repository.ensureConversation(manager.allocator, database, manager.io, provider, account_id, conversation_id, external_user_id);
        defer conversation.deinit();
        try repository.enqueue(database, manager.io, provider, account_id, external_user_id, conversation_id, external_message_id, conversation.session_id, prompt);
        return manager.allocator.dupe(u8, if (std.mem.eql(u8, provider, "discord")) "Working…" else "");
    }

    fn registerTelegramCommands(manager: *Manager, client: *http.Client, account_id: []const u8, token: []const u8) !void {
        if (manager.registered_accounts.contains(account_id)) return;
        const payload = "{\"commands\":[{\"command\":\"new\",\"description\":\"Start a new chat\"},{\"command\":\"model\",\"description\":\"Choose the model\"},{\"command\":\"provider\",\"description\":\"Choose the provider\"},{\"command\":\"effort\",\"description\":\"Choose reasoning effort\"},{\"command\":\"context\",\"description\":\"Choose the context route\"},{\"command\":\"cancel\",\"description\":\"Stop the active response\"},{\"command\":\"help\",\"description\":\"Show available commands\"}]}";
        const response = try telegramRequest(manager.allocator, client, token, "/setMyCommands", .POST, payload);
        manager.allocator.free(response);
        const key = try manager.allocator.dupe(u8, account_id);
        errdefer manager.allocator.free(key);
        try manager.registered_accounts.put(manager.allocator, key, {});
    }

    fn handleTelegramCommand(manager: *Manager, mode: config.Mode, client: *http.Client, database: *sqlite.Database, harness: *harness_runtime.Manager, token: []const u8, account_id: []const u8, external_user_id: []const u8, conversation_id: []const u8, command: TelegramCommand) !void {
        if (std.mem.eql(u8, command.name, "new")) {
            var current = blk: {
                try database.lock(manager.io);
                defer database.unlock(manager.io);
                break :blk try repository.ensureConversation(manager.allocator, database, manager.io, "telegram", account_id, conversation_id, external_user_id);
            };
            defer current.deinit();
            var abort_document: Io.Writer.Allocating = .init(manager.allocator);
            defer abort_document.deinit();
            try abort_document.writer.writeAll("{\"sessionId\":");
            try std.json.Stringify.value(current.session_id, .{}, &abort_document.writer);
            try abort_document.writer.writeByte('}');
            const aborted = coordinator.controlPayload(manager.allocator, manager.io, mode, client, database, harness, "abort", abort_document.writer.buffered()) catch null;
            if (aborted) |value| manager.allocator.free(value);
            const next = blk: {
                try database.lock(manager.io);
                defer database.unlock(manager.io);
                break :blk try repository.resetConversation(manager.allocator, database, manager.io, "telegram", account_id, conversation_id, external_user_id);
            };
            manager.allocator.free(next);
            session_change.notify();
            workbench_change.notify();
            return manager.sendTelegram(client, token, conversation_id, "New chat started.");
        }
        if (std.mem.eql(u8, command.name, "cancel")) {
            var active = blk: {
                try database.lock(manager.io);
                defer database.unlock(manager.io);
                break :blk try repository.conversation(manager.allocator, database, "telegram", account_id, conversation_id);
            };
            defer if (active) |*value| value.deinit();
            const selected = if (active) |*value| value else return manager.sendTelegram(client, token, conversation_id, "Nothing is running.");
            var document: Io.Writer.Allocating = .init(manager.allocator);
            defer document.deinit();
            try document.writer.writeAll("{\"sessionId\":");
            try std.json.Stringify.value(selected.session_id, .{}, &document.writer);
            try document.writer.writeByte('}');
            const response = coordinator.controlPayload(manager.allocator, manager.io, mode, client, database, harness, "abort", document.writer.buffered()) catch return manager.sendTelegram(client, token, conversation_id, "Nothing is running.");
            manager.allocator.free(response);
            return manager.sendTelegram(client, token, conversation_id, "Stopped.");
        }
        if (std.mem.eql(u8, command.name, "model")) return manager.sendModelMenu(client, token, conversation_id, 0);
        if (std.mem.eql(u8, command.name, "provider")) return manager.sendRouteMenu(client, database, token, account_id, conversation_id, .provider);
        if (std.mem.eql(u8, command.name, "context")) return manager.sendRouteMenu(client, database, token, account_id, conversation_id, .context);
        if (std.mem.eql(u8, command.name, "effort")) return manager.sendEffortMenu(client, database, token, account_id, conversation_id);
        return manager.sendTelegram(client, token, conversation_id, "Commands:\n/new — start a new chat\n/model — choose a model\n/provider — choose a provider\n/effort — choose reasoning effort\n/context — choose a context route\n/cancel — stop the active response\n/help — show this list");
    }

    fn handleTelegramCallback(manager: *Manager, client: *http.Client, database: *sqlite.Database, token: []const u8, account_id: []const u8, callback: std.json.ObjectMap) !void {
        const callback_id = stringField(callback, "id") orelse return error.InvalidTelegramResponse;
        const data = stringField(callback, "data") orelse return manager.answerTelegramCallback(client, token, callback_id, "This option is no longer available.");
        const from = objectField(callback, "from") orelse return error.InvalidTelegramResponse;
        const message = objectField(callback, "message") orelse return error.InvalidTelegramResponse;
        const chat = objectField(message, "chat") orelse return error.InvalidTelegramResponse;
        if (!std.mem.eql(u8, stringField(chat, "type") orelse "", "private")) return manager.answerTelegramCallback(client, token, callback_id, "Private chats only.");
        const user_id = integerField(from, "id") orelse return error.InvalidTelegramResponse;
        const chat_id = integerField(chat, "id") orelse return error.InvalidTelegramResponse;
        var user_buffer: [32]u8 = undefined;
        var chat_buffer: [32]u8 = undefined;
        const user_text = try std.fmt.bufPrint(&user_buffer, "{d}", .{user_id});
        const chat_text = try std.fmt.bufPrint(&chat_buffer, "{d}", .{chat_id});
        const permitted = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk try repository.allowed(database, "telegram", account_id, user_text);
        };
        if (!permitted) return manager.answerTelegramCallback(client, token, callback_id, "Connect this Telegram account in Local Studio first.");
        var parts = std.mem.splitScalar(u8, data, ':');
        if (!std.mem.eql(u8, parts.next() orelse "", "ls")) return manager.answerTelegramCallback(client, token, callback_id, "This option is no longer available.");
        const kind = parts.next() orelse return manager.answerTelegramCallback(client, token, callback_id, "This option is no longer available.");
        const value = parts.next() orelse return manager.answerTelegramCallback(client, token, callback_id, "This option is no longer available.");
        if (std.mem.eql(u8, kind, "model-page")) {
            const page = std.fmt.parseInt(usize, value, 10) catch 0;
            try manager.answerTelegramCallback(client, token, callback_id, "");
            return manager.sendModelMenu(client, token, chat_text, page);
        }
        const catalog_document = try agent_models.payload(manager.allocator, manager.io, manager.configuration_state, client);
        defer manager.allocator.free(catalog_document);
        var catalog = std.json.parseFromSlice(std.json.Value, manager.allocator, catalog_document, .{}) catch return error.InvalidModelCatalog;
        defer catalog.deinit();
        const models = arrayField(catalog.value, "models") orelse return error.InvalidModelCatalog;
        var conversation = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk try repository.ensureConversation(manager.allocator, database, manager.io, "telegram", account_id, chat_text, user_text);
        };
        defer conversation.deinit();
        var confirmation: []const u8 = "Updated.";
        if (std.mem.eql(u8, kind, "model")) {
            const index = std.fmt.parseInt(usize, value, 10) catch return manager.answerTelegramCallback(client, token, callback_id, "This model is no longer available.");
            if (index >= models.len or models[index] != .object) return manager.answerTelegramCallback(client, token, callback_id, "This model is no longer available.");
            const model_id = stringField(models[index].object, "id") orelse return error.InvalidModelCatalog;
            const route_id = stringField(models[index].object, "defaultRouteId") orelse firstReadyRouteId(models[index].object) orelse return manager.answerTelegramCallback(client, token, callback_id, "That model has no available provider.");
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            try repository.setConversationSelection(database, "telegram", account_id, chat_text, model_id, route_id, null);
            confirmation = stringField(models[index].object, "name") orelse model_id;
        } else if (std.mem.eql(u8, kind, "effort")) {
            if (!validEffort(value)) return manager.answerTelegramCallback(client, token, callback_id, "Unsupported effort level.");
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            try repository.setConversationSelection(database, "telegram", account_id, chat_text, null, null, value);
            confirmation = value;
        } else if (std.mem.eql(u8, kind, "provider") or std.mem.eql(u8, kind, "context")) {
            var defaults = blk: {
                try database.lock(manager.io);
                defer database.unlock(manager.io);
                break :blk try repository.defaults(manager.allocator, database);
            };
            defer defaults.deinit();
            const model = findModel(models, conversation.model_id orelse defaults.model_id) orelse return manager.answerTelegramCallback(client, token, callback_id, "Choose a model first.");
            const routes = objectArrayField(model.*, "routes") orelse return error.InvalidModelCatalog;
            const index = std.fmt.parseInt(usize, value, 10) catch return manager.answerTelegramCallback(client, token, callback_id, "This route is no longer available.");
            if (index >= routes.len or routes[index] != .object) return manager.answerTelegramCallback(client, token, callback_id, "This route is no longer available.");
            const route_id = stringField(routes[index].object, "id") orelse return error.InvalidModelCatalog;
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            try repository.setConversationSelection(database, "telegram", account_id, chat_text, null, route_id, null);
            confirmation = if (std.mem.eql(u8, kind, "provider")) stringField(routes[index].object, "label") orelse route_id else contextLabel(routes[index].object);
        } else return manager.answerTelegramCallback(client, token, callback_id, "This option is no longer available.");
        return manager.answerTelegramCallback(client, token, callback_id, confirmation);
    }

    fn sendModelMenu(manager: *Manager, client: *http.Client, token: []const u8, conversation_id: []const u8, requested_page: usize) !void {
        const document = try agent_models.payload(manager.allocator, manager.io, manager.configuration_state, client);
        defer manager.allocator.free(document);
        var catalog = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidModelCatalog;
        defer catalog.deinit();
        const models = arrayField(catalog.value, "models") orelse return error.InvalidModelCatalog;
        const page_size: usize = 8;
        const pages = @max(@as(usize, 1), (models.len + page_size - 1) / page_size);
        const page = @min(requested_page, pages - 1);
        const start = page * page_size;
        const end = @min(start + page_size, models.len);
        var keyboard: Io.Writer.Allocating = .init(manager.allocator);
        defer keyboard.deinit();
        try keyboard.writer.writeByte('[');
        var wrote = false;
        for (models[start..end], start..) |model, index| {
            if (model != .object) continue;
            if (!(booleanField(model.object, "available") orelse false)) continue;
            if (wrote) try keyboard.writer.writeByte(',');
            try keyboard.writer.writeAll("[{\"text\":");
            try std.json.Stringify.value(stringField(model.object, "name") orelse stringField(model.object, "id") orelse "Model", .{}, &keyboard.writer);
            try keyboard.writer.writeAll(",\"callback_data\":");
            const callback = try std.fmt.allocPrint(manager.allocator, "ls:model:{d}", .{index});
            defer manager.allocator.free(callback);
            try std.json.Stringify.value(callback, .{}, &keyboard.writer);
            try keyboard.writer.writeAll("}]");
            wrote = true;
        }
        if (pages > 1) {
            if (wrote) try keyboard.writer.writeByte(',');
            try keyboard.writer.writeByte('[');
            var navigation = false;
            if (page > 0) {
                const callback = try std.fmt.allocPrint(manager.allocator, "ls:model-page:{d}", .{page - 1});
                defer manager.allocator.free(callback);
                try keyboard.writer.writeAll("{\"text\":\"‹ Previous\",\"callback_data\":");
                try std.json.Stringify.value(callback, .{}, &keyboard.writer);
                try keyboard.writer.writeByte('}');
                navigation = true;
            }
            if (page + 1 < pages) {
                if (navigation) try keyboard.writer.writeByte(',');
                const callback = try std.fmt.allocPrint(manager.allocator, "ls:model-page:{d}", .{page + 1});
                defer manager.allocator.free(callback);
                try keyboard.writer.writeAll("{\"text\":\"Next ›\",\"callback_data\":");
                try std.json.Stringify.value(callback, .{}, &keyboard.writer);
                try keyboard.writer.writeByte('}');
            }
            try keyboard.writer.writeByte(']');
        }
        try keyboard.writer.writeByte(']');
        const title = try std.fmt.allocPrint(manager.allocator, "Choose a model · {d}/{d}", .{ page + 1, pages });
        defer manager.allocator.free(title);
        return manager.sendTelegramKeyboard(client, token, conversation_id, title, keyboard.writer.buffered());
    }

    fn sendRouteMenu(manager: *Manager, client: *http.Client, database: *sqlite.Database, token: []const u8, account_id: []const u8, conversation_id: []const u8, kind: RouteMenuKind) !void {
        var defaults = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk try repository.defaults(manager.allocator, database);
        };
        defer defaults.deinit();
        var conversation = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk try repository.conversation(manager.allocator, database, "telegram", account_id, conversation_id);
        };
        defer if (conversation) |*value| value.deinit();
        const document = try agent_models.payload(manager.allocator, manager.io, manager.configuration_state, client);
        defer manager.allocator.free(document);
        var catalog = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidModelCatalog;
        defer catalog.deinit();
        const models = arrayField(catalog.value, "models") orelse return error.InvalidModelCatalog;
        const selected_model_id = if (conversation) |*value| value.model_id orelse defaults.model_id else defaults.model_id;
        const model = findModel(models, selected_model_id) orelse return manager.sendTelegram(client, token, conversation_id, "The current model is not available. Choose another model first.");
        const routes = objectArrayField(model.*, "routes") orelse return error.InvalidModelCatalog;
        var keyboard: Io.Writer.Allocating = .init(manager.allocator);
        defer keyboard.deinit();
        try keyboard.writer.writeByte('[');
        var wrote = false;
        for (routes, 0..) |route, index| {
            if (route != .object or !std.mem.eql(u8, stringField(route.object, "status") orelse "", "ready")) continue;
            if (wrote) try keyboard.writer.writeByte(',');
            try keyboard.writer.writeAll("[{\"text\":");
            const label = if (kind == .provider) stringField(route.object, "label") orelse stringField(route.object, "providerId") orelse "Provider" else contextLabel(route.object);
            try std.json.Stringify.value(label, .{}, &keyboard.writer);
            try keyboard.writer.writeAll(",\"callback_data\":");
            const callback = try std.fmt.allocPrint(manager.allocator, "ls:{s}:{d}", .{ @tagName(kind), index });
            defer manager.allocator.free(callback);
            try std.json.Stringify.value(callback, .{}, &keyboard.writer);
            try keyboard.writer.writeAll("}]");
            wrote = true;
        }
        try keyboard.writer.writeByte(']');
        if (!wrote) return manager.sendTelegram(client, token, conversation_id, "No available choices for the current model.");
        return manager.sendTelegramKeyboard(client, token, conversation_id, if (kind == .provider) "Choose a provider" else "Choose a context route", keyboard.writer.buffered());
    }

    fn sendEffortMenu(manager: *Manager, client: *http.Client, database: *sqlite.Database, token: []const u8, account_id: []const u8, conversation_id: []const u8) !void {
        _ = database;
        _ = account_id;
        const keyboard = "[[{\"text\":\"Off\",\"callback_data\":\"ls:effort:off\"},{\"text\":\"Auto\",\"callback_data\":\"ls:effort:auto\"}],[{\"text\":\"Low\",\"callback_data\":\"ls:effort:low\"},{\"text\":\"Medium\",\"callback_data\":\"ls:effort:medium\"}],[{\"text\":\"High\",\"callback_data\":\"ls:effort:high\"},{\"text\":\"Extra high\",\"callback_data\":\"ls:effort:xhigh\"}],[{\"text\":\"Maximum\",\"callback_data\":\"ls:effort:max\"}]]";
        return manager.sendTelegramKeyboard(client, token, conversation_id, "Choose reasoning effort", keyboard);
    }

    fn sendTelegramKeyboard(manager: *Manager, client: *http.Client, token: []const u8, chat_id: []const u8, message: []const u8, keyboard: []const u8) !void {
        var body: Io.Writer.Allocating = .init(manager.allocator);
        defer body.deinit();
        try body.writer.writeAll("{\"chat_id\":");
        try std.json.Stringify.value(chat_id, .{}, &body.writer);
        try body.writer.writeAll(",\"text\":");
        try std.json.Stringify.value(message, .{}, &body.writer);
        try body.writer.writeAll(",\"reply_markup\":{\"inline_keyboard\":");
        try body.writer.writeAll(keyboard);
        try body.writer.writeAll("}}");
        const response = try telegramRequest(manager.allocator, client, token, "/sendMessage", .POST, body.writer.buffered());
        manager.allocator.free(response);
    }

    fn answerTelegramCallback(manager: *Manager, client: *http.Client, token: []const u8, callback_id: []const u8, message: []const u8) !void {
        var body: Io.Writer.Allocating = .init(manager.allocator);
        defer body.deinit();
        try body.writer.writeAll("{\"callback_query_id\":");
        try std.json.Stringify.value(callback_id, .{}, &body.writer);
        if (message.len > 0) {
            try body.writer.writeAll(",\"text\":");
            try std.json.Stringify.value(message[0..@min(message.len, 200)], .{}, &body.writer);
        }
        try body.writer.writeByte('}');
        const response = try telegramRequest(manager.allocator, client, token, "/answerCallbackQuery", .POST, body.writer.buffered());
        manager.allocator.free(response);
    }

    fn dispatch(manager: *Manager, mode: config.Mode, client: *http.Client, database: *sqlite.Database, harness: *harness_runtime.Manager, message: *const repository.Message) !void {
        var selection = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk try repository.conversation(manager.allocator, database, message.provider, message.account_id, message.conversation_id);
        };
        defer if (selection) |*value| value.deinit();
        var defaults = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk try repository.defaults(manager.allocator, database);
        };
        defer defaults.deinit();
        if (defaults.model_id.len == 0 or defaults.route_id.len == 0) return error.MessagingModelRequired;
        const active = if (selection) |*value| value else return error.InvalidMessagingConversation;
        const model_id = active.model_id orelse defaults.model_id;
        const route_id = active.route_id orelse defaults.route_id;
        var turn: Io.Writer.Allocating = .init(manager.allocator);
        defer turn.deinit();
        try turn.writer.writeAll("{\"sessionId\":");
        try std.json.Stringify.value(message.session_id, .{}, &turn.writer);
        try turn.writer.writeAll(",\"kind\":\"chat\",\"modelId\":");
        try std.json.Stringify.value(model_id, .{}, &turn.writer);
        try turn.writer.writeAll(",\"modelRouteId\":");
        try std.json.Stringify.value(route_id, .{}, &turn.writer);
        if (active.effort) |effort| {
            try turn.writer.writeAll(",\"thinkingLevel\":");
            try std.json.Stringify.value(effort, .{}, &turn.writer);
        }
        try turn.writer.writeAll(",\"message\":");
        try std.json.Stringify.value(message.prompt, .{}, &turn.writer);
        try turn.writer.writeAll(",\"toolAccess\":\"read\",\"browserToolEnabled\":true,\"messagingSurface\":\"telegram\",\"mode\":\"prompt\"}");
        const accepted = try coordinator.turnPayload(manager.allocator, manager.io, mode, client, database, harness, turn.writer.buffered());
        const cursor = run_completion.acceptedEventCursor(manager.allocator, accepted);
        manager.allocator.free(accepted);
        var pulse: TypingPulse = .{ .manager = manager, .client = client, .account_id = message.account_id, .conversation_id = message.conversation_id };
        const heartbeat: ?run_completion.Heartbeat = if (std.mem.eql(u8, message.provider, "telegram")) .{ .context = &pulse, .send = sendTypingPulse } else null;
        var result = try run_completion.waitWithHeartbeat(manager.allocator, manager.io, mode, client, database, harness, message.session_id, cursor, 4096, heartbeat);
        defer result.deinit();
        if (result.failure) |failure| return manager.sendReply(client, message.provider, message.account_id, message.conversation_id, failure);
        const response = std.mem.trim(u8, result.summary, " \t\r\n");
        if (response.len > 0) try manager.sendReply(client, message.provider, message.account_id, message.conversation_id, response) else if (!result.outbound_action) try manager.sendReply(client, message.provider, message.account_id, message.conversation_id, "Chat completed without a response.");
    }

    fn sendReply(manager: *Manager, client: *http.Client, provider: []const u8, account_id: []const u8, conversation_id: []const u8, message: []const u8) !void {
        var bot = try manager.configuration(account_id, provider);
        defer bot.deinit();
        if (std.mem.eql(u8, provider, "telegram")) return manager.sendTelegram(client, bot.token, conversation_id, message);
        const path = try std.fmt.allocPrint(manager.allocator, "/channels/{s}/messages", .{conversation_id});
        defer manager.allocator.free(path);
        var body: Io.Writer.Allocating = .init(manager.allocator);
        defer body.deinit();
        try body.writer.writeAll("{\"content\":");
        try std.json.Stringify.value(message[0..@min(message.len, 2000)], .{}, &body.writer);
        try body.writer.writeAll(",\"allowed_mentions\":{\"parse\":[]}}");
        const authorization = try std.fmt.allocPrint(manager.allocator, "Bot {s}", .{bot.token});
        defer manager.allocator.free(authorization);
        const response = try request(manager.allocator, client, "https://discord.com/api/v10", path, .POST, body.writer.buffered(), &.{.{ .name = "Authorization", .value = authorization }});
        manager.allocator.free(response);
    }

    fn sendTelegram(manager: *Manager, client: *http.Client, token: []const u8, chat_id: []const u8, message: []const u8) !void {
        var body: Io.Writer.Allocating = .init(manager.allocator);
        defer body.deinit();
        try body.writer.writeAll("{\"chat_id\":");
        try std.json.Stringify.value(chat_id, .{}, &body.writer);
        try body.writer.writeAll(",\"text\":");
        try std.json.Stringify.value(message[0..@min(message.len, 4096)], .{}, &body.writer);
        try body.writer.writeByte('}');
        const response = try telegramRequest(manager.allocator, client, token, "/sendMessage", .POST, body.writer.buffered());
        manager.allocator.free(response);
    }

    pub fn reactionPayload(manager: *Manager, client: *http.Client, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidMessagingReaction;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidMessagingReaction;
        const session_id = stringField(parsed.value.object, "sessionId") orelse return error.InvalidMessagingReaction;
        const emoji = stringField(parsed.value.object, "emoji") orelse return error.InvalidMessagingReaction;
        if (!validReaction(emoji)) return error.InvalidMessagingReaction;
        var target = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk (try repository.telegramTarget(manager.allocator, database, session_id)) orelse return error.MessagingConversationNotFound;
        };
        defer target.deinit();
        const external_message_id = blk: {
            try database.lock(manager.io);
            defer database.unlock(manager.io);
            break :blk (try repository.latestExternalMessageId(manager.allocator, database, session_id)) orelse return error.MessagingMessageNotFound;
        };
        defer manager.allocator.free(external_message_id);
        var bot = try manager.configuration(target.account_id, "telegram");
        defer bot.deinit();
        try manager.sendTelegramReaction(client, bot.token, target.conversation_id, external_message_id, emoji);
        return manager.allocator.dupe(u8, "{\"ok\":true,\"outboundAction\":\"telegram_reaction\"}");
    }

    fn sendTelegramReaction(manager: *Manager, client: *http.Client, token: []const u8, chat_id: []const u8, message_id: []const u8, emoji: []const u8) !void {
        const chat_number = std.fmt.parseInt(i64, chat_id, 10) catch return error.InvalidMessagingReaction;
        const message_number = std.fmt.parseInt(i64, message_id, 10) catch return error.InvalidMessagingReaction;
        var body: Io.Writer.Allocating = .init(manager.allocator);
        defer body.deinit();
        try body.writer.print("{{\"chat_id\":{d},\"message_id\":{d},\"reaction\":[{{\"type\":\"emoji\",\"emoji\":", .{ chat_number, message_number });
        try std.json.Stringify.value(emoji, .{}, &body.writer);
        try body.writer.writeAll("}]}");
        const response = try telegramRequest(manager.allocator, client, token, "/setMessageReaction", .POST, body.writer.buffered());
        manager.allocator.free(response);
    }

    fn sendTelegramTyping(manager: *Manager, client: *http.Client, account_id: []const u8, chat_id: []const u8) !void {
        var bot = try manager.configuration(account_id, "telegram");
        defer bot.deinit();
        var body: Io.Writer.Allocating = .init(manager.allocator);
        defer body.deinit();
        try body.writer.writeAll("{\"chat_id\":");
        try std.json.Stringify.value(chat_id, .{}, &body.writer);
        try body.writer.writeAll(",\"action\":\"typing\"}");
        const response = try telegramRequest(manager.allocator, client, bot.token, "/sendChatAction", .POST, body.writer.buffered());
        manager.allocator.free(response);
    }

    fn botAccounts(manager: *Manager, provider: []const u8) !BotAccountList {
        var store = try account_repository.load(manager.allocator, manager.io, manager.data_dir);
        defer store.deinit();
        var result = BotAccountList{ .allocator = manager.allocator };
        errdefer result.deinit();
        for (store.accounts.items) |account| {
            if (!std.mem.eql(u8, account.provider, provider)) continue;
            try result.accounts.append(manager.allocator, .{ .allocator = manager.allocator, .id = try manager.allocator.dupe(u8, account.id) });
        }
        return result;
    }

    fn configuration(manager: *Manager, account_id: []const u8, provider: []const u8) !BotConfiguration {
        var store = try account_repository.load(manager.allocator, manager.io, manager.data_dir);
        defer store.deinit();
        const account = store.find(account_id) orelse return error.MessagingAccountNotFound;
        if (!std.mem.eql(u8, account.provider, provider)) return error.MessagingAccountNotFound;
        const secret = try account_repository.resolveSecret(manager.allocator, manager.io, manager.environment, manager.data_dir, &store, account.secret_ref, account.secret_provider);
        defer manager.allocator.free(secret);
        var parsed_secret = std.json.parseFromSlice(std.json.Value, manager.allocator, secret, .{}) catch return error.InvalidMessagingCredential;
        defer parsed_secret.deinit();
        var parsed_configuration = std.json.parseFromSlice(std.json.Value, manager.allocator, account.configuration_json, .{}) catch return error.InvalidMessagingConfiguration;
        defer parsed_configuration.deinit();
        if (parsed_secret.value != .object or parsed_configuration.value != .object) return error.InvalidMessagingConfiguration;
        const token = stringField(parsed_secret.value.object, "token") orelse return error.InvalidMessagingCredential;
        return .{
            .allocator = manager.allocator,
            .token = try manager.allocator.dupe(u8, token),
            .public_key = if (stringField(parsed_configuration.value.object, "publicKey")) |value| try manager.allocator.dupe(u8, value) else null,
        };
    }
};

fn telegramRequest(allocator: std.mem.Allocator, client: *http.Client, token: []const u8, path: []const u8, method: http.Method, payload: ?[]const u8) ![]u8 {
    const endpoint = try std.fmt.allocPrint(allocator, "https://api.telegram.org/bot{s}", .{token});
    defer allocator.free(endpoint);
    return request(allocator, client, endpoint, path, method, payload, &.{});
}

fn request(allocator: std.mem.Allocator, client: *http.Client, endpoint: []const u8, path: []const u8, method: http.Method, payload: ?[]const u8, extra: []const http.Header) ![]u8 {
    const url = try std.fmt.allocPrint(allocator, "{s}{s}", .{ endpoint, path });
    defer allocator.free(url);
    var headers: [2]http.Header = undefined;
    var count: usize = 0;
    for (extra) |header| {
        headers[count] = header;
        count += 1;
    }
    headers[count] = .{ .name = "Content-Type", .value = "application/json" };
    count += 1;
    const storage = try allocator.alloc(u8, max_response_bytes);
    errdefer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = method,
        .payload = payload,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = headers[0..count],
        .response_writer = &output,
    });
    if (response.status.class() != .success) {
        allocator.free(storage);
        return error.MessagingRequestRejected;
    }
    const result = try allocator.dupe(u8, output.buffered());
    allocator.free(storage);
    return result;
}

fn verifyDiscord(allocator: std.mem.Allocator, timestamp: []const u8, signature_hex: []const u8, document: []const u8, public_key_hex: []const u8) !void {
    if (signature_hex.len != 128 or public_key_hex.len != 64 or timestamp.len == 0 or timestamp.len > 64) return error.InvalidDiscordSignature;
    var signature_bytes: [64]u8 = undefined;
    var public_key_bytes: [32]u8 = undefined;
    _ = std.fmt.hexToBytes(&signature_bytes, signature_hex) catch return error.InvalidDiscordSignature;
    _ = std.fmt.hexToBytes(&public_key_bytes, public_key_hex) catch return error.InvalidDiscordSignature;
    const message = try std.mem.concat(allocator, u8, &.{ timestamp, document });
    defer allocator.free(message);
    const public_key = std.crypto.sign.Ed25519.PublicKey.fromBytes(public_key_bytes) catch return error.InvalidDiscordSignature;
    const signature = std.crypto.sign.Ed25519.Signature.fromBytes(signature_bytes);
    signature.verify(message, public_key) catch return error.InvalidDiscordSignature;
}

fn discordResponse(allocator: std.mem.Allocator, content: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"type\":4,\"data\":{\"content\":");
    try std.json.Stringify.value(content[0..@min(content.len, 2000)], .{}, &output.writer);
    try output.writer.writeAll(",\"allowed_mentions\":{\"parse\":[]}}}");
    return output.toOwnedSlice();
}

fn discordPrompt(data: std.json.ObjectMap) ?[]const u8 {
    const options = data.get("options") orelse return null;
    if (options != .array) return null;
    for (options.array.items) |option| {
        if (option != .object or !std.mem.eql(u8, stringField(option.object, "name") orelse "", "prompt")) continue;
        return stringField(option.object, "value");
    }
    return null;
}

fn lockedFinish(io: Io, database: *sqlite.Database, message_id: []const u8, failure: ?[]const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    try repository.finish(database, message_id, failure);
}

fn sendTypingPulse(raw: *anyopaque) !void {
    const pulse: *TypingPulse = @ptrCast(@alignCast(raw));
    try pulse.manager.sendTelegramTyping(pulse.client, pulse.account_id, pulse.conversation_id);
}

fn telegramCommand(message: []const u8) ?TelegramCommand {
    const trimmed = std.mem.trim(u8, message, " \t\r\n");
    if (trimmed.len < 2 or trimmed[0] != '/') return null;
    const token_end = std.mem.indexOfAny(u8, trimmed, " \t\r\n") orelse trimmed.len;
    const token = trimmed[1..token_end];
    const name_end = std.mem.indexOfScalar(u8, token, '@') orelse token.len;
    const name = token[0..name_end];
    return if (name.len > 0) .{ .name = name } else null;
}

fn arrayField(value: std.json.Value, name: []const u8) ?[]std.json.Value {
    if (value != .object) return null;
    return objectArrayField(value.object, name);
}

fn objectArrayField(object: std.json.ObjectMap, name: []const u8) ?[]std.json.Value {
    const field = object.get(name) orelse return null;
    return if (field == .array) field.array.items else null;
}

fn findModel(models: []std.json.Value, requested: ?[]const u8) ?*const std.json.ObjectMap {
    if (requested) |model_id| for (models) |*model| {
        if (model.* != .object) continue;
        if (std.mem.eql(u8, stringField(model.object, "id") orelse "", model_id)) return &model.object;
    };
    for (models) |*model| {
        if (model.* != .object) continue;
        if (booleanField(model.object, "available") orelse false) return &model.object;
    }
    return null;
}

fn firstReadyRouteId(model: std.json.ObjectMap) ?[]const u8 {
    const routes_value = model.get("routes") orelse return null;
    if (routes_value != .array) return null;
    for (routes_value.array.items) |route| {
        if (route != .object or !std.mem.eql(u8, stringField(route.object, "status") orelse "", "ready")) continue;
        if (stringField(route.object, "id")) |value| return value;
    }
    return null;
}

fn contextLabel(route: std.json.ObjectMap) []const u8 {
    const value = integerField(route, "contextWindow") orelse 0;
    if (value >= 1_000_000) return "1M context";
    if (value >= 512_000) return "512K context";
    if (value >= 256_000) return "256K context";
    if (value >= 128_000) return "128K context";
    if (value >= 64_000) return "64K context";
    if (value >= 32_000) return "32K context";
    return "Default context";
}

fn validEffort(value: []const u8) bool {
    for ([_][]const u8{ "off", "auto", "low", "medium", "high", "xhigh", "max" }) |allowed| if (std.mem.eql(u8, value, allowed)) return true;
    return false;
}

fn validReaction(value: []const u8) bool {
    for ([_][]const u8{ "👍", "👎", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "❤‍🔥", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈", "😇", "😨", "🤝", "✍", "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡" }) |allowed| if (std.mem.eql(u8, value, allowed)) return true;
    return false;
}

fn objectField(object: std.json.ObjectMap, name: []const u8) ?std.json.ObjectMap {
    const value = object.get(name) orelse return null;
    return if (value == .object) value.object else null;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0 or trimmed.len > 1024 * 1024) null else trimmed;
}

fn integerField(object: std.json.ObjectMap, name: []const u8) ?i64 {
    const value = object.get(name) orelse return null;
    return if (value == .integer) value.integer else null;
}

fn booleanField(object: std.json.ObjectMap, name: []const u8) ?bool {
    const value = object.get(name) orelse return null;
    return if (value == .bool) value.bool else null;
}
