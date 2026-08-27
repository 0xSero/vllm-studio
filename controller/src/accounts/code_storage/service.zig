const std = @import("std");
const repository = @import("../store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const agent_connectors = @import("../../agent/connectors/service.zig");
const code_storage_auth = @import("auth.zig");
const harness_nodes = @import("../../agent/harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");
const agent_projects = @import("../../agent/projects/service.zig");
const project_repository = @import("../../agent/projects/store.zig");
const project_workspace = @import("../../agent/projects/workspace.zig");
const code_storage_git = @import("../../agent/mcp/code_storage.zig");
const agent_execution = @import("../../agent/execution/store.zig");

const Io = std.Io;
const http = std.http;

pub const State = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []u8,
    environment: *const std.process.Environ.Map,
    mutex: Io.Mutex = .init,

    pub fn init(allocator: std.mem.Allocator, io: Io, data_dir: []const u8, environment: *const std.process.Environ.Map) !State {
        return .{ .allocator = allocator, .io = io, .data_dir = try allocator.dupe(u8, data_dir), .environment = environment };
    }

    pub fn deinit(state: *State) void {
        state.allocator.free(state.data_dir);
        state.* = undefined;
    }

    pub fn accountPayload(state: *State) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        return writeAccounts(state.allocator, &store);
    }

    pub fn repositoriesPayload(state: *State, client: *http.Client) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"repositories\":[");
        var count: usize = 0;
        for (store.accounts.items) |account| {
            if (!std.mem.eql(u8, account.provider, "code-storage")) continue;
            const private_key = try repository.resolveSecret(state.allocator, state.io, state.environment, state.data_dir, &store, account.secret_ref, account.secret_provider);
            defer state.allocator.free(private_key);
            const document = try code_storage_git.repositories(state.allocator, state.io, client, account.subject, account.id, private_key);
            defer state.allocator.free(document);
            var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidCodeStorageRepositoryResponse;
            defer parsed.deinit();
            if (parsed.value != .object) return error.InvalidCodeStorageRepositoryResponse;
            const values = parsed.value.object.get("repos") orelse return error.InvalidCodeStorageRepositoryResponse;
            if (values != .array) return error.InvalidCodeStorageRepositoryResponse;
            for (values.array.items) |value| {
                if (value != .object) continue;
                const source_url = stringField(value.object, "url") orelse continue;
                const repository_name = repositoryName(source_url) orelse continue;
                const name = stringField(value.object, "repo_name") orelse repository_name;
                if (count > 0) try output.writer.writeByte(',');
                try output.writer.writeAll("{\"accountId\":");
                try std.json.Stringify.value(account.id, .{}, &output.writer);
                try output.writer.writeAll(",\"accountLabel\":");
                try std.json.Stringify.value(account.label, .{}, &output.writer);
                try output.writer.writeAll(",\"organization\":");
                try std.json.Stringify.value(account.subject, .{}, &output.writer);
                try output.writer.writeAll(",\"name\":");
                try std.json.Stringify.value(name, .{}, &output.writer);
                try output.writer.writeAll(",\"repository\":");
                try std.json.Stringify.value(repository_name, .{}, &output.writer);
                try output.writer.writeAll(",\"url\":");
                const url = try std.fmt.allocPrint(state.allocator, "https://{s}.code.storage/{s}.git", .{ account.subject, repository_name });
                defer state.allocator.free(url);
                try std.json.Stringify.value(url, .{}, &output.writer);
                try output.writer.writeAll(",\"defaultBranch\":");
                try std.json.Stringify.value(stringField(value.object, "default_branch") orelse "main", .{}, &output.writer);
                try output.writer.writeByte('}');
                count += 1;
            }
        }
        try output.writer.print("],\"accounts\":{d}", .{countCodeStorageAccounts(&store)});
        for (store.accounts.items) |account| if (std.mem.eql(u8, account.provider, "code-storage")) {
            try output.writer.writeAll(",\"defaultAccountId\":");
            try std.json.Stringify.value(account.id, .{}, &output.writer);
            break;
        };
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn createProjectPayload(state: *State, client: *http.Client, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidProjectPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidProjectPayload;
        const account_id = stringField(parsed.value.object, "accountId") orelse return error.CodeStorageAccountRequired;
        const name = stringField(parsed.value.object, "repository") orelse return error.CodeStorageRepositoryRequired;
        try state.mutex.lock(state.io);
        var accounts = repository.load(state.allocator, state.io, state.data_dir) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        };
        const private_key = repository.resolveSecret(state.allocator, state.io, state.environment, state.data_dir, &accounts, account.secret_ref, account.secret_provider) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        const organization = try state.allocator.dupe(u8, account.subject);
        state.mutex.unlock(state.io);
        defer state.allocator.free(private_key);
        defer state.allocator.free(organization);
        try code_storage_git.createRepository(state.allocator, state.io, client, organization, account_id, private_key, name);
        var payload: Io.Writer.Allocating = .init(state.allocator);
        defer payload.deinit();
        try payload.writer.writeAll("{\"accountId\":");
        try std.json.Stringify.value(account_id, .{}, &payload.writer);
        try payload.writer.writeAll(",\"repository\":");
        try std.json.Stringify.value(name, .{}, &payload.writer);
        try payload.writer.writeAll(",\"defaultBranch\":\"main\"}");
        return state.addProjectPayload(database, payload.writer.buffered());
    }

    pub fn importProjectPayload(state: *State, client: *http.Client, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidProjectPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidProjectPayload;
        const account_id = stringField(parsed.value.object, "accountId") orelse return error.CodeStorageAccountRequired;
        const repository_name = stringField(parsed.value.object, "repository") orelse return error.CodeStorageRepositoryRequired;
        const workspace = stringField(parsed.value.object, "path") orelse return error.ProjectPathRequired;
        const default_branch = stringField(parsed.value.object, "defaultBranch") orelse "main";
        try code_storage_auth.validateRepository(repository_name);
        const resolved = try agent_projects.resolveAllowedPath(state.allocator, state.io, state.environment, workspace);
        defer state.allocator.free(resolved);
        try code_storage_git.validateMirrorSource(state.allocator, state.io, state.environment, resolved);
        var existing_id: ?[]u8 = null;
        defer if (existing_id) |value| state.allocator.free(value);
        {
            try database.lock(state.io);
            defer database.unlock(state.io);
            if (try project_repository.getByPath(state.allocator, database, resolved)) |existing_value| {
                var existing = existing_value;
                defer existing.deinit();
                if (existing.account_id != null) return importedProjectJson(state.allocator, &existing);
                existing_id = try state.allocator.dupe(u8, existing.id);
            }
            if (try project_repository.getByRepository(state.allocator, database, account_id, repository_name)) |repository_value| {
                var existing_repository = repository_value;
                defer existing_repository.deinit();
                if (existing_id == null or !std.mem.eql(u8, existing_id.?, existing_repository.id)) return error.CodeStorageRepositoryAlreadyAdded;
            }
        }
        try state.mutex.lock(state.io);
        var accounts = repository.load(state.allocator, state.io, state.data_dir) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        };
        if (!std.mem.eql(u8, account.provider, "code-storage")) {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        }
        const private_key = repository.resolveSecret(state.allocator, state.io, state.environment, state.data_dir, &accounts, account.secret_ref, account.secret_provider) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        const organization = state.allocator.dupe(u8, account.subject) catch |failure| {
            state.allocator.free(private_key);
            state.mutex.unlock(state.io);
            return failure;
        };
        const owned_account_id = state.allocator.dupe(u8, account.id) catch |failure| {
            state.allocator.free(private_key);
            state.allocator.free(organization);
            state.mutex.unlock(state.io);
            return failure;
        };
        state.mutex.unlock(state.io);
        defer state.allocator.free(private_key);
        defer state.allocator.free(organization);
        defer state.allocator.free(owned_account_id);
        try code_storage_git.createRepository(state.allocator, state.io, client, organization, owned_account_id, private_key, repository_name);
        var result = try code_storage_git.mirrorRepository(state.allocator, state.io, state.environment, organization, owned_account_id, private_key, repository_name, resolved, "project-import");
        defer result.deinit();
        var project_id: []u8 = undefined;
        var generated_id: ?[]u8 = null;
        defer if (generated_id) |value| state.allocator.free(value);
        if (existing_id) |value| {
            project_id = value;
        } else {
            var random: [12]u8 = undefined;
            state.io.random(&random);
            const encoded = std.fmt.bytesToHex(random, .lower);
            generated_id = try std.fmt.allocPrint(state.allocator, "proj-{s}", .{encoded[0..]});
            project_id = generated_id.?;
        }
        var timestamp_buffer: [24]u8 = undefined;
        const added_at = formatTimestamp(state.io, &timestamp_buffer);
        try database.lock(state.io);
        defer database.unlock(state.io);
        if (existing_id != null) {
            try project_repository.linkRepository(database, project_id, owned_account_id, organization, repository_name, result.repository_url, default_branch);
        } else {
            try project_repository.saveRepository(database, project_id, std.fs.path.basename(resolved), resolved, owned_account_id, organization, repository_name, result.repository_url, default_branch, added_at);
        }
        var project = (try project_repository.getById(state.allocator, database, project_id)).?;
        defer project.deinit();
        return importedProjectJson(state.allocator, &project);
    }

    pub fn addProjectPayload(state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidProjectPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidProjectPayload;
        const account_id = stringField(parsed.value.object, "accountId") orelse return error.CodeStorageAccountRequired;
        const repository_name = stringField(parsed.value.object, "repository") orelse return error.CodeStorageRepositoryRequired;
        const default_branch = stringField(parsed.value.object, "defaultBranch") orelse "main";
        try state.mutex.lock(state.io);
        var accounts = repository.load(state.allocator, state.io, state.data_dir) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        };
        if (!std.mem.eql(u8, account.provider, "code-storage")) {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        }
        const organization = try state.allocator.dupe(u8, account.subject);
        state.mutex.unlock(state.io);
        defer state.allocator.free(organization);
        var random: [12]u8 = undefined;
        state.io.random(&random);
        const encoded = std.fmt.bytesToHex(random, .lower);
        const id = try std.fmt.allocPrint(state.allocator, "proj-{s}", .{encoded[0..]});
        defer state.allocator.free(id);
        const path = try agent_projects.managedRepositoryPath(state.allocator, state.environment, id);
        defer state.allocator.free(path);
        const url = stringField(parsed.value.object, "repositoryUrl") orelse generated: {
            break :generated try std.fmt.allocPrint(state.allocator, "https://{s}.code.storage/{s}.git", .{ organization, repository_name });
        };
        const owned_url = if (stringField(parsed.value.object, "repositoryUrl") == null) url else null;
        defer if (owned_url) |value| state.allocator.free(value);
        var timestamp_buffer: [24]u8 = undefined;
        const added_at = formatTimestamp(state.io, &timestamp_buffer);
        try database.lock(state.io);
        defer database.unlock(state.io);
        if (try project_repository.getByRepository(state.allocator, database, account_id, repository_name)) |existing_value| {
            var existing = existing_value;
            defer existing.deinit();
            return projectJson(state.allocator, &existing);
        }
        try project_repository.saveRepository(database, id, repository_name, path, account_id, organization, repository_name, url, default_branch, added_at);
        var project = (try project_repository.getById(state.allocator, database, id)).?;
        defer project.deinit();
        return projectJson(state.allocator, &project);
    }

    pub fn prepareWorkspacePayload(state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidProjectWorkspacePayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidProjectWorkspacePayload;
        const project_id = stringField(parsed.value.object, "projectId") orelse return error.ProjectIdRequired;
        const session_id = stringField(parsed.value.object, "sessionId") orelse return error.SessionIdRequired;
        const base_ref = stringField(parsed.value.object, "ref") orelse "main";
        const branch = stringField(parsed.value.object, "branch");
        try database.lock(state.io);
        var project = (try project_repository.getById(state.allocator, database, project_id)) orelse {
            database.unlock(state.io);
            return error.ProjectNotFound;
        };
        database.unlock(state.io);
        defer project.deinit();
        const account_id = project.account_id orelse return error.CodeStorageAccountRequired;
        const repository_name = project.repository orelse return error.CodeStorageRepositoryRequired;
        try state.mutex.lock(state.io);
        var accounts = repository.load(state.allocator, state.io, state.data_dir) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        };
        const private_key = repository.resolveSecret(state.allocator, state.io, state.environment, state.data_dir, &accounts, account.secret_ref, account.secret_provider) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        const organization = try state.allocator.dupe(u8, account.subject);
        state.mutex.unlock(state.io);
        defer state.allocator.free(private_key);
        defer state.allocator.free(organization);
        const token = try code_storage_auth.mint(state.allocator, state.io, organization, account_id, private_key, repository_name, &.{ "git:read", "git:write" });
        defer state.allocator.free(token);
        const remote = try std.fmt.allocPrint(state.allocator, "https://t:{s}@{s}.code.storage/{s}.git", .{ token, organization, repository_name });
        defer state.allocator.free(remote);
        const path = try project_workspace.prepare(state.allocator, state.io, state.environment, &project, session_id, remote, base_ref, branch);
        defer state.allocator.free(path);
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"path\":");
        try std.json.Stringify.value(path, .{}, &output.writer);
        try output.writer.writeAll(",\"ref\":");
        try std.json.Stringify.value(base_ref, .{}, &output.writer);
        try output.writer.writeAll(",\"detached\":");
        try output.writer.writeAll(if (branch == null) "true" else "false");
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn cloudCheckoutPayload(state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidProjectWorkspacePayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidProjectWorkspacePayload;
        const project_id = stringField(parsed.value.object, "projectId") orelse return error.ProjectIdRequired;
        try database.lock(state.io);
        var project = (try project_repository.getById(state.allocator, database, project_id)) orelse {
            database.unlock(state.io);
            return error.ProjectNotFound;
        };
        database.unlock(state.io);
        defer project.deinit();
        const account_id = project.account_id orelse return error.CodeStorageAccountRequired;
        const repository_name = project.repository orelse return error.CodeStorageRepositoryRequired;
        const repository_url = project.repository_url orelse return error.CodeStorageRepositoryRequired;
        try state.mutex.lock(state.io);
        var accounts = repository.load(state.allocator, state.io, state.data_dir) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        };
        const private_key = repository.resolveSecret(state.allocator, state.io, state.environment, state.data_dir, &accounts, account.secret_ref, account.secret_provider) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        state.mutex.unlock(state.io);
        defer state.allocator.free(private_key);
        const token = try code_storage_auth.mint(state.allocator, state.io, account.subject, account_id, private_key, repository_name, &.{ "git:read", "git:write" });
        defer state.allocator.free(token);
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"url\":");
        try std.json.Stringify.value(repository_url, .{}, &output.writer);
        try output.writer.writeAll(",\"username\":\"t\",\"password\":");
        try std.json.Stringify.value(token, .{}, &output.writer);
        try output.writer.writeAll(",\"ref\":");
        try std.json.Stringify.value(project.default_branch, .{}, &output.writer);
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }

    pub fn archiveWorkspace(state: *State, database: *sqlite.Database, project_id: []const u8, session_id: []const u8) !void {
        try database.lock(state.io);
        var project = (try project_repository.getById(state.allocator, database, project_id)) orelse {
            database.unlock(state.io);
            return;
        };
        database.unlock(state.io);
        defer project.deinit();
        if (project.repository == null) return;
        try project_workspace.archive(state.allocator, state.io, state.environment, &project, session_id);
    }

    pub fn archiveWorkspacePayload(state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidProjectWorkspacePayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidProjectWorkspacePayload;
        const project_id = stringField(parsed.value.object, "projectId") orelse return error.ProjectIdRequired;
        const session_id = stringField(parsed.value.object, "sessionId") orelse return error.SessionIdRequired;
        try state.archiveWorkspace(database, project_id, session_id);
        return state.allocator.dupe(u8, "{\"ok\":true}");
    }

    pub fn projectRefsPayload(state: *State, database: *sqlite.Database, project_id: []const u8) ![]u8 {
        try database.lock(state.io);
        var project = (try project_repository.getById(state.allocator, database, project_id)) orelse {
            database.unlock(state.io);
            return error.ProjectNotFound;
        };
        database.unlock(state.io);
        defer project.deinit();
        const account_id = project.account_id orelse return error.CodeStorageAccountRequired;
        const repository_name = project.repository orelse return error.CodeStorageRepositoryRequired;
        try state.mutex.lock(state.io);
        var accounts = repository.load(state.allocator, state.io, state.data_dir) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        defer accounts.deinit();
        const account = accounts.find(account_id) orelse {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        };
        const private_key = repository.resolveSecret(state.allocator, state.io, state.environment, state.data_dir, &accounts, account.secret_ref, account.secret_provider) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        const organization = try state.allocator.dupe(u8, account.subject);
        state.mutex.unlock(state.io);
        defer state.allocator.free(private_key);
        defer state.allocator.free(organization);
        return code_storage_git.references(state.allocator, state.io, state.environment, organization, account_id, private_key, repository_name);
    }

    pub fn credentialStorePayload(state: *State) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        return writeCredentialStore(state.allocator, store.secret_provider);
    }

    pub fn updateCredentialStorePayload(state: *State, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidCredentialStorePayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidCredentialStorePayload;
        const provider = stringField(parsed.value.object, "provider") orelse return error.SecretProviderRequired;
        try validateSecretProvider(provider);
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        try repository.migrateSecretProvider(state.allocator, state.io, state.environment, state.data_dir, &store, provider);
        return writeCredentialStore(state.allocator, store.secret_provider);
    }

    pub fn sandboxAccountsPayload(state: *State) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        return writeSandboxAccounts(state.allocator, &store);
    }

    pub fn messagingAccountsPayload(state: *State) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        return writeMessagingAccounts(state.allocator, &store);
    }

    pub fn connectMessagingPayload(state: *State, client: *http.Client, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidMessagingAccountPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidMessagingAccountPayload;
        const provider = stringField(parsed.value.object, "provider") orelse return error.MessagingProviderRequired;
        if (!isMessagingProvider(provider)) return error.MessagingProviderRequired;
        const token = stringField(parsed.value.object, "token") orelse return error.MessagingCredentialRequired;
        const application_id = if (std.mem.eql(u8, provider, "discord")) stringField(parsed.value.object, "applicationId") orelse return error.DiscordApplicationIdRequired else null;
        const public_key = if (std.mem.eql(u8, provider, "discord")) stringField(parsed.value.object, "publicKey") orelse return error.DiscordPublicKeyRequired else null;
        const subject = application_id orelse "telegram-bot";
        const label = stringField(parsed.value.object, "label") orelse if (std.mem.eql(u8, provider, "telegram")) "Telegram" else subject;
        if (application_id) |value| try registerDiscordCommand(state.allocator, client, value, token);
        var secret: Io.Writer.Allocating = .init(state.allocator);
        defer secret.deinit();
        try secret.writer.writeAll("{\"token\":");
        try std.json.Stringify.value(token, .{}, &secret.writer);
        try secret.writer.writeByte('}');
        var configuration: Io.Writer.Allocating = .init(state.allocator);
        defer configuration.deinit();
        try configuration.writer.writeAll("{\"applicationId\":");
        if (application_id) |value| try std.json.Stringify.value(value, .{}, &configuration.writer) else try configuration.writer.writeAll("null");
        try configuration.writer.writeAll(",\"publicKey\":");
        if (public_key) |value| try std.json.Stringify.value(value, .{}, &configuration.writer) else try configuration.writer.writeAll("null");
        try configuration.writer.writeByte('}');
        const id_buffer = repository.accountId(provider, subject, secret.writer.buffered());
        const secret_ref = try std.fmt.allocPrint(state.allocator, "MESSAGING_CREDENTIAL_{s}", .{id_buffer});
        defer state.allocator.free(secret_ref);
        var timestamp_buffer: [24]u8 = undefined;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        var account = store.find(&id_buffer);
        if (account == null) {
            try store.accounts.append(state.allocator, .{
                .allocator = state.allocator,
                .id = try state.allocator.dupe(u8, &id_buffer),
                .provider = try state.allocator.dupe(u8, provider),
                .subject = try state.allocator.dupe(u8, subject),
                .label = try state.allocator.dupe(u8, label),
                .credential_kind = try state.allocator.dupe(u8, "json"),
                .configuration_json = try state.allocator.dupe(u8, configuration.writer.buffered()),
                .secret_provider = try state.allocator.dupe(u8, store.secret_provider),
                .secret_ref = try state.allocator.dupe(u8, secret_ref),
                .connected_at = try state.allocator.dupe(u8, formatTimestamp(state.io, &timestamp_buffer)),
            });
            account = &store.accounts.items[store.accounts.items.len - 1];
        }
        try repository.setSecret(state.allocator, state.io, state.environment, state.data_dir, &store, account.?.secret_ref, account.?.secret_provider, secret.writer.buffered());
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return writeMessagingAccounts(state.allocator, &store);
    }

    pub fn disconnectMessagingPayload(state: *State, account_id: []const u8) ![]u8 {
        if (!repository.validId(account_id)) return error.MessagingAccountRequired;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        var index: ?usize = null;
        for (store.accounts.items, 0..) |account, account_index| {
            if (std.mem.eql(u8, account.id, account_id) and isMessagingProvider(account.provider)) {
                index = account_index;
                break;
            }
        }
        const account_index = index orelse return error.MessagingAccountNotFound;
        const account = &store.accounts.items[account_index];
        try repository.deleteSecret(state.allocator, state.io, state.environment, state.data_dir, &store, account.secret_ref, account.secret_provider);
        var removed = store.accounts.orderedRemove(account_index);
        removed.deinit();
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return writeMessagingAccounts(state.allocator, &store);
    }

    pub fn connectSandboxPayload(state: *State, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidSandboxAccountPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidSandboxAccountPayload;
        const provider = stringField(parsed.value.object, "provider") orelse return error.SandboxProviderRequired;
        if (!isSandboxProvider(provider)) return error.SandboxProviderRequired;
        const is_daytona = std.mem.eql(u8, provider, "daytona");
        const label = stringField(parsed.value.object, "label") orelse if (is_daytona) "Daytona" else "Vercel";
        const endpoint = if (is_daytona) stringField(parsed.value.object, "endpoint") orelse "https://app.daytona.io/api" else "https://vercel.com/api";
        const team_id = if (is_daytona) null else stringField(parsed.value.object, "teamId") orelse return error.VercelTeamRequired;
        const project_id = if (is_daytona) null else stringField(parsed.value.object, "projectId") orelse return error.VercelProjectRequired;
        const worker_image = if (is_daytona) null else stringField(parsed.value.object, "workerImage") orelse "local-studio-controller:nightly";
        var configuration: Io.Writer.Allocating = .init(state.allocator);
        defer configuration.deinit();
        try writeDefaultSandboxConfiguration(&configuration.writer, provider, team_id, project_id, worker_image);
        var secret: Io.Writer.Allocating = .init(state.allocator);
        defer secret.deinit();
        const credential = stringField(parsed.value.object, if (is_daytona) "apiKey" else "token") orelse return error.SandboxCredentialRequired;
        try secret.writer.writeAll(if (is_daytona) "{\"apiKey\":" else "{\"token\":");
        try std.json.Stringify.value(credential, .{}, &secret.writer);
        try secret.writer.writeByte('}');
        const subject = project_id orelse endpoint;
        const id_buffer = repository.accountId(provider, subject, secret.writer.buffered());
        const secret_ref = try std.fmt.allocPrint(state.allocator, "SANDBOX_CREDENTIAL_{s}", .{id_buffer});
        defer state.allocator.free(secret_ref);
        var timestamp_buffer: [24]u8 = undefined;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        var account = store.find(&id_buffer);
        if (account == null) {
            try store.accounts.append(state.allocator, .{
                .allocator = state.allocator,
                .id = try state.allocator.dupe(u8, &id_buffer),
                .provider = try state.allocator.dupe(u8, provider),
                .subject = try state.allocator.dupe(u8, subject),
                .label = try state.allocator.dupe(u8, label),
                .credential_kind = try state.allocator.dupe(u8, "json"),
                .configuration_json = try state.allocator.dupe(u8, configuration.writer.buffered()),
                .secret_provider = try state.allocator.dupe(u8, store.secret_provider),
                .secret_ref = try state.allocator.dupe(u8, secret_ref),
                .connected_at = try state.allocator.dupe(u8, formatTimestamp(state.io, &timestamp_buffer)),
            });
            account = &store.accounts.items[store.accounts.items.len - 1];
        } else {
            state.allocator.free(account.?.configuration_json);
            account.?.configuration_json = try state.allocator.dupe(u8, configuration.writer.buffered());
        }
        try repository.setSecret(state.allocator, state.io, state.environment, state.data_dir, &store, account.?.secret_ref, account.?.secret_provider, secret.writer.buffered());
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return writeSandboxAccounts(state.allocator, &store);
    }

    pub fn updateSandboxPayload(state: *State, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidSandboxAccountPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidSandboxAccountPayload;
        const account_id = stringField(parsed.value.object, "accountId") orelse return error.SandboxAccountRequired;
        if (!repository.validId(account_id)) return error.SandboxAccountRequired;
        const configuration_value = parsed.value.object.get("configuration") orelse return error.InvalidSandboxProfile;
        if (configuration_value != .object) return error.InvalidSandboxProfile;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        const account = store.find(account_id) orelse return error.SandboxAccountNotFound;
        if (!isSandboxProvider(account.provider)) return error.SandboxAccountNotFound;
        try validateSandboxConfiguration(account.provider, configuration_value.object);
        var configuration: Io.Writer.Allocating = .init(state.allocator);
        defer configuration.deinit();
        try std.json.Stringify.value(configuration_value, .{}, &configuration.writer);
        state.allocator.free(account.configuration_json);
        account.configuration_json = try state.allocator.dupe(u8, configuration.writer.buffered());
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return writeSandboxAccounts(state.allocator, &store);
    }

    pub fn disconnectSandboxPayload(state: *State, account_id: []const u8) ![]u8 {
        if (!repository.validId(account_id)) return error.SandboxAccountRequired;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        var index: ?usize = null;
        for (store.accounts.items, 0..) |account, account_index| {
            if (std.mem.eql(u8, account.id, account_id) and isSandboxProvider(account.provider)) {
                index = account_index;
                break;
            }
        }
        const account_index = index orelse return error.SandboxAccountNotFound;
        const account = &store.accounts.items[account_index];
        try repository.deleteSecret(state.allocator, state.io, state.environment, state.data_dir, &store, account.secret_ref, account.secret_provider);
        var removed = store.accounts.orderedRemove(account_index);
        removed.deinit();
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return writeSandboxAccounts(state.allocator, &store);
    }

    pub fn connectPayload(state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidCodeStorageAccountPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidCodeStorageAccountPayload;
        const organization = stringField(parsed.value.object, "organization") orelse return error.CodeStorageOrganizationRequired;
        const private_key = stringField(parsed.value.object, "privateKey") orelse return error.CodeStoragePrivateKeyRequired;
        const label = stringField(parsed.value.object, "label") orelse organization;
        try code_storage_auth.validateOrganization(organization);
        try code_storage_auth.validatePrivateKey(state.allocator, private_key);
        const id_buffer = repository.accountId("code-storage", organization, private_key);
        const secret_ref = try std.fmt.allocPrint(state.allocator, "CODE_STORAGE_PRIVATE_KEY_{s}", .{id_buffer});
        defer state.allocator.free(secret_ref);
        var timestamp_buffer: [24]u8 = undefined;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        const secret_provider = store.secret_provider;
        try validateSecretProvider(secret_provider);
        var account = store.find(&id_buffer);
        if (account == null) {
            try store.accounts.append(state.allocator, .{
                .allocator = state.allocator,
                .id = try state.allocator.dupe(u8, &id_buffer),
                .provider = try state.allocator.dupe(u8, "code-storage"),
                .subject = try state.allocator.dupe(u8, organization),
                .label = try state.allocator.dupe(u8, label),
                .credential_kind = try state.allocator.dupe(u8, "pkcs8-pem"),
                .configuration_json = try state.allocator.dupe(u8, "{}"),
                .secret_provider = try state.allocator.dupe(u8, secret_provider),
                .secret_ref = try state.allocator.dupe(u8, secret_ref),
                .connected_at = try state.allocator.dupe(u8, formatTimestamp(state.io, &timestamp_buffer)),
            });
            account = &store.accounts.items[store.accounts.items.len - 1];
        } else if (!std.mem.eql(u8, account.?.label, label)) {
            state.allocator.free(account.?.label);
            account.?.label = try state.allocator.dupe(u8, label);
        }
        try repository.setSecret(state.allocator, state.io, state.environment, state.data_dir, &store, account.?.secret_ref, account.?.secret_provider, private_key);
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        try agent_connectors.connectCodeStorageLocal(state.allocator, state.io, database, account.?.id, account.?.subject, account.?.label);
        return writeAccounts(state.allocator, &store);
    }

    pub fn disconnectPayload(state: *State, database: *sqlite.Database, account_id: []const u8) ![]u8 {
        if (!repository.validId(account_id)) return error.CodeStorageAccountRequired;
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        var store = try repository.load(state.allocator, state.io, state.data_dir);
        defer store.deinit();
        var index: ?usize = null;
        for (store.accounts.items, 0..) |account, account_index| if (std.mem.eql(u8, account.id, account_id) and std.mem.eql(u8, account.provider, "code-storage")) {
            index = account_index;
            break;
        };
        const account_index = index orelse return error.CodeStorageAccountNotFound;
        const account = &store.accounts.items[account_index];
        try repository.deleteSecret(state.allocator, state.io, state.environment, state.data_dir, &store, account.secret_ref, account.secret_provider);
        try agent_connectors.disconnectCodeStorageLocal(state.allocator, state.io, database, account.id);
        var removed = store.accounts.orderedRemove(account_index);
        removed.deinit();
        try repository.save(state.allocator, state.io, state.data_dir, &store);
        return writeAccounts(state.allocator, &store);
    }

    pub fn mirrorPayload(state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
        var parsed = std.json.parseFromSlice(std.json.Value, state.allocator, document, .{}) catch return error.InvalidCodeStorageMirrorPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidCodeStorageMirrorPayload;
        const account_id = stringField(parsed.value.object, "accountId") orelse return error.CodeStorageAccountRequired;
        const repository_name = stringField(parsed.value.object, "repository") orelse return error.CodeStorageRepositoryRequired;
        const workspace = stringField(parsed.value.object, "cwd") orelse return error.CodeStoragePathRequired;
        const session_id = stringField(parsed.value.object, "sessionId") orelse "mirror";
        const resolved = try agent_projects.resolveAllowedPath(state.allocator, state.io, state.environment, workspace);
        defer state.allocator.free(resolved);
        try state.mutex.lock(state.io);
        var store = repository.load(state.allocator, state.io, state.data_dir) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        defer store.deinit();
        const account = store.find(account_id) orelse {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        };
        if (!std.mem.eql(u8, account.provider, "code-storage")) {
            state.mutex.unlock(state.io);
            return error.CodeStorageAccountNotFound;
        }
        const private_key = repository.resolveSecret(state.allocator, state.io, state.environment, state.data_dir, &store, account.secret_ref, account.secret_provider) catch |failure| {
            state.mutex.unlock(state.io);
            return failure;
        };
        const organization = state.allocator.dupe(u8, account.subject) catch |failure| {
            state.allocator.free(private_key);
            state.mutex.unlock(state.io);
            return failure;
        };
        const owned_account_id = state.allocator.dupe(u8, account.id) catch |failure| {
            state.allocator.free(private_key);
            state.allocator.free(organization);
            state.mutex.unlock(state.io);
            return failure;
        };
        state.mutex.unlock(state.io);
        defer state.allocator.free(private_key);
        defer state.allocator.free(organization);
        defer state.allocator.free(owned_account_id);
        var result = try code_storage_git.mirrorRepository(state.allocator, state.io, state.environment, organization, owned_account_id, private_key, repository_name, resolved, session_id);
        defer result.deinit();
        var checkpoint_id: ?[36]u8 = null;
        {
            try database.lock(state.io);
            defer database.unlock(state.io);
            if (try agent_execution.hasSession(database, session_id)) checkpoint_id = try agent_execution.saveCheckpoint(database, state.io, session_id, 0, result.repository_url, result.checkpoint_ref, result.checkpoint_sha, "{\"transport\":\"code.storage\"}");
        }
        var output: Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"ok\":true,\"repositoryUrl\":");
        try std.json.Stringify.value(result.repository_url, .{}, &output.writer);
        try output.writer.writeAll(",\"checkpointRef\":");
        try std.json.Stringify.value(result.checkpoint_ref, .{}, &output.writer);
        try output.writer.writeAll(",\"checkpointSha\":");
        try std.json.Stringify.value(result.checkpoint_sha, .{}, &output.writer);
        try output.writer.writeAll(",\"checkpointId\":");
        if (checkpoint_id) |value| try std.json.Stringify.value(value[0..], .{}, &output.writer) else try output.writer.writeAll("null");
        try output.writer.writeByte('}');
        return output.toOwnedSlice();
    }
};

pub fn forward(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, path: []const u8, method: http.Method, document: ?[]const u8) ![]u8 {
    return forwardTo(allocator, io, client, database, path, method, document, null);
}

pub fn forwardTo(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, path: []const u8, method: http.Method, document: ?[]const u8, preferred_node: ?[]const u8) ![]u8 {
    var target = (try harness_nodes.selectCapability(allocator, io, database, "mcp", preferred_node)) orelse return error.ConnectorNodeRequired;
    defer target.deinit();
    return if (method == .GET)
        node_transport.get(allocator, client, &target, path)
    else
        node_transport.send(allocator, client, &target, path, method, document);
}

pub fn validAccountId(value: []const u8) bool {
    return repository.validId(value);
}

fn countCodeStorageAccounts(store: *repository.Store) usize {
    var count: usize = 0;
    for (store.accounts.items) |account| if (std.mem.eql(u8, account.provider, "code-storage")) {
        count += 1;
    };
    return count;
}

fn repositoryName(source_url: []const u8) ?[]const u8 {
    const trimmed = std.mem.trim(u8, source_url, " \t\r\n/");
    if (trimmed.len == 0) return null;
    const separator = std.mem.lastIndexOfScalar(u8, trimmed, '/') orelse return trimmed;
    if (separator + 1 >= trimmed.len) return null;
    return trimmed[separator + 1 ..];
}

fn projectJson(allocator: std.mem.Allocator, project: *const project_repository.Project) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"project\":{\"id\":");
    try std.json.Stringify.value(project.id, .{}, &output.writer);
    try output.writer.writeAll(",\"name\":");
    try std.json.Stringify.value(project.name, .{}, &output.writer);
    try output.writer.writeAll(",\"path\":");
    try std.json.Stringify.value(project.path, .{}, &output.writer);
    try output.writer.writeAll(",\"addedAt\":");
    try std.json.Stringify.value(project.added_at, .{}, &output.writer);
    try output.writer.writeAll(",\"exists\":false,\"hasGit\":false,\"branch\":null,\"accountId\":");
    try std.json.Stringify.value(project.account_id orelse "", .{}, &output.writer);
    try output.writer.writeAll(",\"organization\":");
    try std.json.Stringify.value(project.organization orelse "", .{}, &output.writer);
    try output.writer.writeAll(",\"repository\":");
    try std.json.Stringify.value(project.repository orelse project.name, .{}, &output.writer);
    try output.writer.writeAll(",\"repositoryUrl\":");
    try std.json.Stringify.value(project.repository_url orelse "", .{}, &output.writer);
    try output.writer.writeAll(",\"defaultBranch\":");
    try std.json.Stringify.value(project.default_branch, .{}, &output.writer);
    try output.writer.writeAll("}}");
    return output.toOwnedSlice();
}

fn importedProjectJson(allocator: std.mem.Allocator, project: *const project_repository.Project) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"project\":{\"id\":");
    try std.json.Stringify.value(project.id, .{}, &output.writer);
    try output.writer.writeAll(",\"name\":");
    try std.json.Stringify.value(project.name, .{}, &output.writer);
    try output.writer.writeAll(",\"path\":");
    try std.json.Stringify.value(project.path, .{}, &output.writer);
    try output.writer.writeAll(",\"addedAt\":");
    try std.json.Stringify.value(project.added_at, .{}, &output.writer);
    try output.writer.writeAll(",\"exists\":true,\"hasGit\":true,\"branch\":");
    try std.json.Stringify.value(project.default_branch, .{}, &output.writer);
    try output.writer.writeAll(",\"accountId\":");
    try std.json.Stringify.value(project.account_id orelse "", .{}, &output.writer);
    try output.writer.writeAll(",\"organization\":");
    try std.json.Stringify.value(project.organization orelse "", .{}, &output.writer);
    try output.writer.writeAll(",\"repository\":");
    try std.json.Stringify.value(project.repository orelse project.name, .{}, &output.writer);
    try output.writer.writeAll(",\"repositoryUrl\":");
    try std.json.Stringify.value(project.repository_url orelse "", .{}, &output.writer);
    try output.writer.writeAll(",\"defaultBranch\":");
    try std.json.Stringify.value(project.default_branch, .{}, &output.writer);
    try output.writer.writeAll("}}");
    return output.toOwnedSlice();
}

fn writeAccounts(allocator: std.mem.Allocator, store: *repository.Store) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"accounts\":[");
    var wrote = false;
    for (store.accounts.items) |account| {
        if (!std.mem.eql(u8, account.provider, "code-storage")) continue;
        if (wrote) try output.writer.writeByte(',');
        wrote = true;
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(account.id, .{}, &output.writer);
        try output.writer.writeAll(",\"organization\":");
        try std.json.Stringify.value(account.subject, .{}, &output.writer);
        try output.writer.writeAll(",\"label\":");
        try std.json.Stringify.value(account.label, .{}, &output.writer);
        try output.writer.writeAll(",\"connectedAt\":");
        try std.json.Stringify.value(account.connected_at, .{}, &output.writer);
        try output.writer.writeAll(",\"connectorId\":\"account-code-storage-");
        try output.writer.writeAll(account.id);
        try output.writer.writeAll("\",\"secretProvider\":");
        try std.json.Stringify.value(account.secret_provider, .{}, &output.writer);
        try output.writer.writeByte('}');
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn writeCredentialStore(allocator: std.mem.Allocator, provider: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"provider\":");
    try std.json.Stringify.value(provider, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn writeSandboxAccounts(allocator: std.mem.Allocator, store: *repository.Store) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"accounts\":[");
    var wrote = false;
    for (store.accounts.items) |account| {
        if (!isSandboxProvider(account.provider)) continue;
        if (wrote) try output.writer.writeByte(',');
        wrote = true;
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(account.id, .{}, &output.writer);
        try output.writer.writeAll(",\"provider\":");
        try std.json.Stringify.value(account.provider, .{}, &output.writer);
        try output.writer.writeAll(",\"label\":");
        try std.json.Stringify.value(account.label, .{}, &output.writer);
        try output.writer.writeAll(",\"endpoint\":");
        if (std.mem.eql(u8, account.provider, "daytona")) try std.json.Stringify.value(account.subject, .{}, &output.writer) else try std.json.Stringify.value("https://vercel.com/api", .{}, &output.writer);
        try writeSandboxConfigurationFields(allocator, &output.writer, account.provider, account.configuration_json);
        try output.writer.writeAll(",\"connectedAt\":");
        try std.json.Stringify.value(account.connected_at, .{}, &output.writer);
        try output.writer.writeAll(",\"secretProvider\":");
        try std.json.Stringify.value(account.secret_provider, .{}, &output.writer);
        try output.writer.writeByte('}');
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn writeMessagingAccounts(allocator: std.mem.Allocator, store: *repository.Store) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"accounts\":[");
    var wrote = false;
    for (store.accounts.items) |account| {
        if (!isMessagingProvider(account.provider)) continue;
        if (wrote) try output.writer.writeByte(',');
        wrote = true;
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(account.id, .{}, &output.writer);
        try output.writer.writeAll(",\"provider\":");
        try std.json.Stringify.value(account.provider, .{}, &output.writer);
        try output.writer.writeAll(",\"label\":");
        try std.json.Stringify.value(account.label, .{}, &output.writer);
        try output.writer.writeAll(",\"subject\":");
        try std.json.Stringify.value(account.subject, .{}, &output.writer);
        try output.writer.writeAll(",\"connectedAt\":");
        try std.json.Stringify.value(account.connected_at, .{}, &output.writer);
        try output.writer.writeAll(",\"secretProvider\":");
        try std.json.Stringify.value(account.secret_provider, .{}, &output.writer);
        try output.writer.writeByte('}');
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn isSandboxProvider(provider: []const u8) bool {
    return std.mem.eql(u8, provider, "daytona") or std.mem.eql(u8, provider, "vercel");
}

fn isMessagingProvider(provider: []const u8) bool {
    return std.mem.eql(u8, provider, "telegram") or std.mem.eql(u8, provider, "discord");
}

fn registerDiscordCommand(allocator: std.mem.Allocator, client: *http.Client, application_id: []const u8, token: []const u8) !void {
    const url = try std.fmt.allocPrint(allocator, "https://discord.com/api/v10/applications/{s}/commands", .{application_id});
    defer allocator.free(url);
    const authorization = try std.fmt.allocPrint(allocator, "Bot {s}", .{token});
    defer allocator.free(authorization);
    const storage = try allocator.alloc(u8, 64 * 1024);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = .POST,
        .payload = "{\"name\":\"chat\",\"type\":1,\"description\":\"Send a private Chat request to Local Studio\",\"contexts\":[1,2],\"integration_types\":[0,1],\"options\":[{\"type\":3,\"name\":\"prompt\",\"description\":\"What Chat should do\",\"required\":true}]}",
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = &.{
            .{ .name = "Authorization", .value = authorization },
            .{ .name = "Content-Type", .value = "application/json" },
        },
        .response_writer = &output,
    });
    if (response.status.class() != .success) return error.DiscordCommandRegistrationFailed;
}

fn formatTimestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds, 0)) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{ year_day.year, month_day.month.numeric(), month_day.day_index + 1, day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute() }) catch unreachable;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0 or trimmed.len > 512 * 1024) null else trimmed;
}

fn writeDefaultSandboxConfiguration(writer: *Io.Writer, provider: []const u8, team_id: ?[]const u8, project_id: ?[]const u8, worker_image: ?[]const u8) !void {
    try writer.writeAll("{\"teamId\":");
    if (team_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"projectId\":");
    if (project_id) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"workerImage\":");
    if (worker_image) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"defaultProfile\":\"standard\",\"profiles\":");
    try writer.writeAll(if (std.mem.eql(u8, provider, "vercel")) vercel_default_profiles else daytona_default_profiles);
    try writer.writeByte('}');
}

fn writeSandboxConfigurationFields(allocator: std.mem.Allocator, writer: *Io.Writer, provider: []const u8, document: []const u8) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch {
        return writeDefaultSandboxConfigurationFields(writer, provider);
    };
    defer parsed.deinit();
    if (parsed.value != .object) return writeDefaultSandboxConfigurationFields(writer, provider);
    validateSandboxConfiguration(provider, parsed.value.object) catch return writeDefaultSandboxConfigurationFields(writer, provider);
    const object = parsed.value.object;
    try writer.writeAll(",\"teamId\":");
    try std.json.Stringify.value(object.get("teamId") orelse .null, .{}, writer);
    try writer.writeAll(",\"projectId\":");
    try std.json.Stringify.value(object.get("projectId") orelse .null, .{}, writer);
    try writer.writeAll(",\"workerImage\":");
    try std.json.Stringify.value(object.get("workerImage") orelse .null, .{}, writer);
    try writer.writeAll(",\"defaultProfile\":");
    try std.json.Stringify.value(object.get("defaultProfile").?, .{}, writer);
    try writer.writeAll(",\"profiles\":");
    try std.json.Stringify.value(object.get("profiles").?, .{}, writer);
}

fn writeDefaultSandboxConfigurationFields(writer: *Io.Writer, provider: []const u8) !void {
    try writer.writeAll(",\"teamId\":null,\"projectId\":null,\"workerImage\":null,\"defaultProfile\":\"standard\",\"profiles\":");
    try writer.writeAll(if (std.mem.eql(u8, provider, "vercel")) vercel_default_profiles else daytona_default_profiles);
}

fn validateSandboxConfiguration(provider: []const u8, object: std.json.ObjectMap) !void {
    const is_vercel = std.mem.eql(u8, provider, "vercel");
    if (is_vercel) {
        _ = stringField(object, "teamId") orelse return error.InvalidSandboxProfile;
        _ = stringField(object, "projectId") orelse return error.InvalidSandboxProfile;
        _ = stringField(object, "workerImage") orelse return error.InvalidSandboxProfile;
    }
    const default_profile = stringField(object, "defaultProfile") orelse return error.InvalidSandboxProfile;
    if (!validProfileId(default_profile)) return error.InvalidSandboxProfile;
    const profiles = object.get("profiles") orelse return error.InvalidSandboxProfile;
    if (profiles != .array or profiles.array.items.len != 3) return error.InvalidSandboxProfile;
    var seen: u3 = 0;
    for (profiles.array.items) |profile| {
        if (profile != .object) return error.InvalidSandboxProfile;
        const id = stringField(profile.object, "id") orelse return error.InvalidSandboxProfile;
        const label = stringField(profile.object, "label") orelse return error.InvalidSandboxProfile;
        if (label.len > 32) return error.InvalidSandboxProfile;
        const bit: u3 = if (std.mem.eql(u8, id, "light")) 1 else if (std.mem.eql(u8, id, "standard")) 2 else if (std.mem.eql(u8, id, "large")) 4 else return error.InvalidSandboxProfile;
        if (seen & bit != 0) return error.InvalidSandboxProfile;
        seen |= bit;
        const cpu = positiveInteger(profile.object.get("cpu") orelse return error.InvalidSandboxProfile) orelse return error.InvalidSandboxProfile;
        const memory = positiveInteger(profile.object.get("memoryGiB") orelse return error.InvalidSandboxProfile) orelse return error.InvalidSandboxProfile;
        if (cpu > 32 or memory > 256) return error.InvalidSandboxProfile;
        const storage = profile.object.get("storage") orelse return error.InvalidSandboxProfile;
        if (storage != .object) return error.InvalidSandboxProfile;
        const mode = stringField(storage.object, "mode") orelse return error.InvalidSandboxProfile;
        if (is_vercel) {
            if (!std.mem.eql(u8, mode, "provider-managed") or memory != cpu * 2) return error.InvalidSandboxProfile;
        } else {
            if (!std.mem.eql(u8, mode, "fixed")) return error.InvalidSandboxProfile;
            const gib = positiveInteger(storage.object.get("gib") orelse return error.InvalidSandboxProfile) orelse return error.InvalidSandboxProfile;
            if (gib > 1024) return error.InvalidSandboxProfile;
        }
    }
    if (seen != 7) return error.InvalidSandboxProfile;
}

fn validProfileId(value: []const u8) bool {
    return std.mem.eql(u8, value, "light") or std.mem.eql(u8, value, "standard") or std.mem.eql(u8, value, "large");
}

fn positiveInteger(value: std.json.Value) ?u16 {
    const integer: i64 = switch (value) {
        .integer => |number| number,
        .float => |number| if (@floor(number) == number) @intFromFloat(number) else return null,
        else => return null,
    };
    return if (integer > 0 and integer <= std.math.maxInt(u16)) @intCast(integer) else null;
}

const daytona_default_profiles = "[{\"id\":\"light\",\"label\":\"Light\",\"cpu\":1,\"memoryGiB\":2,\"storage\":{\"mode\":\"fixed\",\"gib\":10}},{\"id\":\"standard\",\"label\":\"Standard\",\"cpu\":2,\"memoryGiB\":4,\"storage\":{\"mode\":\"fixed\",\"gib\":20}},{\"id\":\"large\",\"label\":\"Large\",\"cpu\":4,\"memoryGiB\":8,\"storage\":{\"mode\":\"fixed\",\"gib\":40}}]";
const vercel_default_profiles = "[{\"id\":\"light\",\"label\":\"Light\",\"cpu\":1,\"memoryGiB\":2,\"storage\":{\"mode\":\"provider-managed\"}},{\"id\":\"standard\",\"label\":\"Standard\",\"cpu\":2,\"memoryGiB\":4,\"storage\":{\"mode\":\"provider-managed\"}},{\"id\":\"large\",\"label\":\"Large\",\"cpu\":4,\"memoryGiB\":8,\"storage\":{\"mode\":\"provider-managed\"}}]";

pub fn validateSecretProvider(value: []const u8) !void {
    if (value.len == 0 or value.len > 512 or value[0] == '-') return error.InvalidSecretProvider;
    for (value) |byte| if (byte < 0x21 or byte > 0x7e or byte == '"' or byte == '\'' or byte == '\\') return error.InvalidSecretProvider;
}
