const std = @import("std");

pub const github_package = "@modelcontextprotocol/server-github";
pub const github_version = "2025.4.8";
pub const github_executable = "mcp-server-github";

const EnvironmentField = struct {
    key: []const u8,
    label: []const u8,
    placeholder: ?[]const u8 = null,
    secret: bool,
};

const Entry = struct {
    id: []const u8,
    name: []const u8,
    company: []const u8,
    description: []const u8,
    protocol_era: []const u8,
    transport: []const u8,
    runtime_kind: ?[]const u8 = null,
    package: ?[]const u8 = null,
    version: ?[]const u8 = null,
    executable: ?[]const u8 = null,
    requirements: []const []const u8 = &.{},
    command: ?[]const u8 = null,
    args: []const []const u8 = &.{},
    url: ?[]const u8 = null,
    state: []const u8,
    filesystem_access: bool,
    recommended: bool,
    installable: bool = true,
    required_configuration: []const []const u8 = &.{},
    env_fields: []const EnvironmentField = &.{},
    auth_provider: ?[]const u8 = null,
    unavailable_reason: ?[]const u8 = null,
};

const entries = [_]Entry{
    .{
        .id = "browser",
        .name = "Browser",
        .company = "Local Studio",
        .description = "Session-isolated web navigation and page reading built into Local Studio",
        .protocol_era = "modern",
        .transport = "builtin",
        .state = "stateful",
        .filesystem_access = false,
        .recommended = true,
        .installable = false,
    },
    .{
        .id = "github",
        .name = "GitHub",
        .company = "GitHub",
        .description = "Repositories, issues, pull requests, Actions, and code search",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = github_package,
        .version = github_version,
        .executable = github_executable,
        .state = "remote",
        .filesystem_access = false,
        .recommended = true,
        .required_configuration = &.{"oauth"},
        .auth_provider = "github",
    },
    .{
        .id = "x",
        .name = "X / Twitter",
        .company = "X",
        .description = "Read and publish through an authenticated X account",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = "@enescinar/twitter-mcp",
        .version = "0.2.0",
        .executable = "twitter-server",
        .state = "remote",
        .filesystem_access = false,
        .recommended = false,
        .required_configuration = &.{ "API_KEY", "API_SECRET_KEY", "ACCESS_TOKEN", "ACCESS_TOKEN_SECRET" },
        .env_fields = &.{
            .{ .key = "API_KEY", .label = "X API key", .secret = true },
            .{ .key = "API_SECRET_KEY", .label = "X API secret", .secret = true },
            .{ .key = "ACCESS_TOKEN", .label = "Access token", .secret = true },
            .{ .key = "ACCESS_TOKEN_SECRET", .label = "Access token secret", .secret = true },
        },
    },
    .{
        .id = "computer",
        .name = "Remote computer",
        .company = "Local Studio",
        .description = "Run commands and work with files over SSH on another machine",
        .protocol_era = "legacy",
        .transport = "stdio",
        .command = "{{LOCAL_STUDIO_CONTROLLER}}",
        .args = &.{"mcp-ssh"},
        .state = "stateful",
        .filesystem_access = true,
        .recommended = true,
        .required_configuration = &.{"SSH_HOST"},
        .env_fields = &.{.{ .key = "SSH_HOST", .label = "SSH host", .placeholder = "user@machine", .secret = false }},
    },
    .{
        .id = "notion",
        .name = "Notion",
        .company = "Notion",
        .description = "Workspace search, pages, databases, and content",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = "mcp-remote",
        .version = "0.1.43",
        .executable = "mcp-remote",
        .args = &.{"https://mcp.notion.com/mcp"},
        .state = "remote",
        .filesystem_access = false,
        .recommended = true,
        .required_configuration = &.{"oauth"},
    },
    .{
        .id = "cloudflare",
        .name = "Cloudflare",
        .company = "Cloudflare",
        .description = "Search and execute across the Cloudflare API",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = "mcp-remote",
        .version = "0.1.43",
        .executable = "mcp-remote",
        .args = &.{"https://mcp.cloudflare.com/mcp"},
        .state = "remote",
        .filesystem_access = false,
        .recommended = true,
        .required_configuration = &.{"oauth"},
    },
    .{
        .id = "railway",
        .name = "Railway",
        .company = "Railway",
        .description = "Projects, services, deployments, variables, logs, and infrastructure",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = "mcp-remote",
        .version = "0.1.43",
        .executable = "mcp-remote",
        .args = &.{"https://mcp.railway.com"},
        .state = "remote",
        .filesystem_access = false,
        .recommended = true,
        .required_configuration = &.{"oauth"},
    },
    .{
        .id = "vercel",
        .name = "Vercel",
        .company = "Vercel",
        .description = "Projects, deployments, logs, domains, and documentation",
        .protocol_era = "auto",
        .transport = "http",
        .url = "https://mcp.vercel.com",
        .state = "remote",
        .filesystem_access = false,
        .recommended = true,
        .installable = false,
        .required_configuration = &.{ "oauth", "approved-client" },
        .unavailable_reason = "Remote MCP OAuth requires an approved client",
    },
    .{
        .id = "mcp-docs",
        .name = "MCP Documentation",
        .company = "Model Context Protocol",
        .description = "Search the official Model Context Protocol documentation",
        .protocol_era = "modern",
        .transport = "http",
        .url = "https://modelcontextprotocol.io/mcp",
        .state = "stateless",
        .filesystem_access = false,
        .recommended = true,
    },
    .{
        .id = "code-storage-docs",
        .name = "Code Storage Documentation",
        .company = "The Pierre Computer Company",
        .description = "Search and read the public Code.Storage documentation and submit documentation feedback",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = "mcp-remote",
        .version = "0.1.43",
        .executable = "mcp-remote",
        .args = &.{"https://code.storage/docs/mcp"},
        .state = "stateless",
        .filesystem_access = false,
        .recommended = true,
    },
    .{
        .id = "mcp-fetch",
        .name = "Fetch",
        .company = "Model Context Protocol",
        .description = "Fetch web content and convert it for model consumption",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "python",
        .package = "mcp-server-fetch",
        .version = "2026.7.10",
        .executable = "mcp-server-fetch",
        .requirements = &.{"mcp<2"},
        .state = "stateless",
        .filesystem_access = false,
        .recommended = true,
    },
    .{
        .id = "mcp-time",
        .name = "Time",
        .company = "Model Context Protocol",
        .description = "Timezone lookup and conversion",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "python",
        .package = "mcp-server-time",
        .version = "2026.7.10",
        .executable = "mcp-server-time",
        .requirements = &.{"mcp<2"},
        .state = "stateless",
        .filesystem_access = false,
        .recommended = true,
    },
    .{
        .id = "mcp-sequential-thinking",
        .name = "Sequential Thinking",
        .company = "Model Context Protocol",
        .description = "Structured dynamic problem solving",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = "@modelcontextprotocol/server-sequential-thinking",
        .version = "2026.7.4",
        .executable = "mcp-server-sequential-thinking",
        .state = "stateless",
        .filesystem_access = false,
        .recommended = true,
    },
    .{
        .id = "mcp-memory",
        .name = "Memory",
        .company = "Model Context Protocol",
        .description = "Persistent knowledge graph memory",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = "@modelcontextprotocol/server-memory",
        .version = "2026.7.4",
        .executable = "mcp-server-memory",
        .state = "stateful",
        .filesystem_access = false,
        .recommended = true,
    },
    .{
        .id = "mcp-everything",
        .name = "Everything",
        .company = "Model Context Protocol",
        .description = "Reference server covering MCP protocol features",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = "@modelcontextprotocol/server-everything",
        .version = "2026.7.4",
        .executable = "mcp-server-everything",
        .state = "stateless",
        .filesystem_access = false,
        .recommended = false,
    },
    .{
        .id = "mcp-filesystem",
        .name = "Filesystem",
        .company = "Model Context Protocol",
        .description = "Restricted file operations within explicitly supplied roots",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "node",
        .package = "@modelcontextprotocol/server-filesystem",
        .version = "2026.7.10",
        .executable = "mcp-server-filesystem",
        .state = "stateful",
        .filesystem_access = true,
        .recommended = false,
        .required_configuration = &.{"roots"},
    },
    .{
        .id = "mcp-git",
        .name = "Git",
        .company = "Model Context Protocol",
        .description = "Repository inspection and mutation for one explicit repository",
        .protocol_era = "legacy",
        .transport = "stdio",
        .runtime_kind = "python",
        .package = "mcp-server-git",
        .version = "2026.7.10",
        .executable = "mcp-server-git",
        .requirements = &.{"mcp<2"},
        .args = &.{"--repository"},
        .state = "stateful",
        .filesystem_access = true,
        .recommended = false,
        .required_configuration = &.{"repository"},
    },
};

pub fn write(writer: *std.Io.Writer) !void {
    try writer.writeAll("{\"source\":\"local-studio\",\"profile\":\"curated\",\"entries\":[");
    for (entries, 0..) |entry, index| {
        if (index > 0) try writer.writeByte(',');
        try writeEntry(writer, entry);
    }
    try writer.writeAll("]}");
}

fn writeEntry(writer: *std.Io.Writer, entry: Entry) !void {
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(entry.id, .{}, writer);
    try writer.writeAll(",\"name\":");
    try std.json.Stringify.value(entry.name, .{}, writer);
    try writer.writeAll(",\"company\":");
    try std.json.Stringify.value(entry.company, .{}, writer);
    try writer.writeAll(",\"description\":");
    try std.json.Stringify.value(entry.description, .{}, writer);
    try writer.writeAll(",\"protocolEra\":");
    try std.json.Stringify.value(entry.protocol_era, .{}, writer);
    try writer.writeAll(",\"transport\":");
    try std.json.Stringify.value(entry.transport, .{}, writer);
    if (entry.runtime_kind) |kind| {
        try writer.writeAll(",\"runtime\":{\"kind\":");
        try std.json.Stringify.value(kind, .{}, writer);
        try writer.writeAll(",\"package\":");
        try std.json.Stringify.value(entry.package.?, .{}, writer);
        try writer.writeAll(",\"version\":");
        try std.json.Stringify.value(entry.version.?, .{}, writer);
        try writer.writeAll(",\"executable\":");
        try std.json.Stringify.value(entry.executable.?, .{}, writer);
        if (entry.requirements.len > 0) {
            try writer.writeAll(",\"with\":[");
            for (entry.requirements, 0..) |requirement, index| {
                if (index > 0) try writer.writeByte(',');
                try std.json.Stringify.value(requirement, .{}, writer);
            }
            try writer.writeByte(']');
        }
        try writer.writeByte('}');
    }
    if (entry.command) |command| {
        try writer.writeAll(",\"command\":");
        try std.json.Stringify.value(command, .{}, writer);
    }
    if (entry.args.len > 0) {
        try writer.writeAll(",\"args\":[");
        for (entry.args, 0..) |argument, index| {
            if (index > 0) try writer.writeByte(',');
            try std.json.Stringify.value(argument, .{}, writer);
        }
        try writer.writeByte(']');
    }
    if (entry.url) |url| {
        try writer.writeAll(",\"url\":");
        try std.json.Stringify.value(url, .{}, writer);
    }
    try writer.writeAll(",\"state\":");
    try std.json.Stringify.value(entry.state, .{}, writer);
    try writer.print(",\"filesystemAccess\":{},\"recommended\":{},\"installable\":{}", .{ entry.filesystem_access, entry.recommended, entry.installable });
    try writer.writeAll(",\"requiredConfiguration\":[");
    for (entry.required_configuration, 0..) |field, index| {
        if (index > 0) try writer.writeByte(',');
        try std.json.Stringify.value(field, .{}, writer);
    }
    try writer.writeAll("],\"envFields\":[");
    for (entry.env_fields, 0..) |field, index| {
        if (index > 0) try writer.writeByte(',');
        try writer.writeAll("{\"key\":");
        try std.json.Stringify.value(field.key, .{}, writer);
        try writer.writeAll(",\"label\":");
        try std.json.Stringify.value(field.label, .{}, writer);
        if (field.placeholder) |placeholder| {
            try writer.writeAll(",\"placeholder\":");
            try std.json.Stringify.value(placeholder, .{}, writer);
        }
        try writer.print(",\"secret\":{}}}", .{field.secret});
    }
    try writer.writeByte(']');
    if (entry.auth_provider) |provider| {
        try writer.writeAll(",\"authProvider\":");
        try std.json.Stringify.value(provider, .{}, writer);
    }
    if (entry.unavailable_reason) |reason| {
        try writer.writeAll(",\"unavailableReason\":");
        try std.json.Stringify.value(reason, .{}, writer);
    }
    try writer.writeByte('}');
}
