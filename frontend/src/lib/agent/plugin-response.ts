import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PluginRow } from "./plugin-discovery";

export type PluginRuntimeCheck = {
  skillConfigured: boolean;
  mcpConfigured: boolean;
  appConfigured: boolean;
  mcpExecutableExists?: boolean;
  runtimeCheckRequired?: boolean;
  note?: string;
};

export type PluginsResponse = {
  plugins: PluginRow[];
  validation: {
    browserUseAvailable: boolean;
    browserUse: PluginRow | null;
    browserUseRuntime: PluginRuntimeCheck | null;
    computerUseAvailable: boolean;
    computerUse: PluginRow | null;
    computerUseRuntime: PluginRuntimeCheck | null;
  };
};

export function buildPluginsResponse(
  allPlugins: PluginRow[],
  options: { includeDisabled?: boolean } = {},
): PluginsResponse {
  const plugins = options.includeDisabled ? allPlugins : allPlugins.filter((row) => row.enabled);
  const computerUse =
    plugins.find((row) => row.enabled && pluginMatches(row, "computer-use")) ?? null;
  const browserUse =
    plugins.find((row) => row.enabled && pluginMatches(row, "browser-use")) ?? null;
  return {
    plugins,
    validation: {
      browserUseAvailable: Boolean(browserUse),
      browserUse,
      browserUseRuntime: browserUse ? pluginRuntimeCheck(browserUse) : null,
      computerUseAvailable: Boolean(computerUse),
      computerUse,
      computerUseRuntime: computerUse ? pluginRuntimeCheck(computerUse) : null,
    },
  };
}

function pluginRuntimeCheck(plugin: PluginRow): PluginRuntimeCheck {
  const mcpExecutable = plugin.mcpConfigPath
    ? firstMcpExecutableExists(plugin.mcpConfigPath)
    : undefined;
  return {
    skillConfigured: Boolean(plugin.skillPath && existsSync(plugin.skillPath)),
    mcpConfigured: Boolean(plugin.mcpConfigPath && existsSync(plugin.mcpConfigPath)),
    appConfigured: Boolean(plugin.appPath && existsSync(plugin.appPath)),
    ...(mcpExecutable === undefined ? {} : { mcpExecutableExists: mcpExecutable }),
    ...(pluginMatches(plugin, "computer-use") && plugin.mcpConfigPath
      ? {
          runtimeCheckRequired: true,
          note: "Computer-use is wired through MCP; verify helper launch from an active session with mcp_plugin_status before desktop control.",
        }
      : {}),
  };
}

function pluginMatches(plugin: PluginRow, needle: string): boolean {
  return [plugin.id, plugin.name, plugin.displayName, plugin.path]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

function firstMcpExecutableExists(configPath: string): boolean | undefined {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcpServers?: Record<string, { command?: unknown; cwd?: unknown }>;
    };
    const server = Object.values(parsed.mcpServers ?? {}).find(
      (entry) => typeof entry.command === "string" && entry.command.trim(),
    );
    if (!server || typeof server.command !== "string") return undefined;
    const cwd = typeof server.cwd === "string" ? server.cwd : ".";
    const base = path.resolve(path.dirname(configPath), cwd);
    const command = server.command.startsWith(".")
      ? path.resolve(base, server.command)
      : server.command;
    return path.isAbsolute(command) ? existsSync(command) : true;
  } catch {
    return false;
  }
}
