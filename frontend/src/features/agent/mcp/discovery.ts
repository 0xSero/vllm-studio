// MCP server discovery → PluginRow.
//
// Exposes only user-stored MCP servers (manual/marketplace) in the `PluginRow`
// shape the rest of the app already consumes (composer catalogue, settings UI,
// runtime ref). There is no filesystem scavenging of bundled desktop-control or
// browser-control experiments here.

import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { listStoredServers, serverConfigPath } from "@/features/agent/mcp/store";
import type { McpServerDef } from "@/features/agent/mcp/types";

/**
 * Row shape returned to clients. Mirrors the legacy PluginRow surface the
 * composer/settings already read (`name`, `mcpConfigPath`, `skillPath`,
 * `enabled`, …) so no consumer needs to change.
 */
export type PluginRow = {
  id: string;
  name: string;
  displayName?: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  ready: boolean;
  description?: string;
  shortDescription?: string;
  source?: string;
  category?: string;
  tags?: string[];
  capabilities?: string[];
  skillPath?: string;
  mcpConfigPath?: string;
};

/** Check whether a command binary is available on the system PATH. */
function isCommandAvailable(command: string): boolean {
  try {
    // `command -v` works on both macOS and Linux
    execFileSync("command", ["-v", command], { stdio: "ignore", shell: true, timeout: 3_000 });
    return true;
  } catch {
    // Try direct path check for absolute/relative paths
    if (command.includes("/") || command.includes("\\") || command.includes(".")) {
      try {
        return existsSync(command);
      } catch {
        return false;
      }
    }
    return false;
  }
}

function storedRow(def: McpServerDef, source: string, enabled: boolean): PluginRow {
  const configReady = existsSync(serverConfigPath(def.id));
  const commandReady = isCommandAvailable(def.command);
  return {
    id: def.id,
    name: def.name,
    ...(def.displayName ? { displayName: def.displayName } : {}),
    path: def.cwd ?? "",
    installed: true,
    enabled,
    ready: enabled && configReady && commandReady,
    ...(def.description ? { description: def.description } : {}),
    ...(def.shortDescription ? { shortDescription: def.shortDescription } : {}),
    source,
    ...(def.category ? { category: def.category } : {}),
    ...(def.tags?.length ? { tags: def.tags } : {}),
    mcpConfigPath: serverConfigPath(def.id),
    ...(def.skillPath ? { skillPath: def.skillPath } : {}),
  };
}

/** All installed MCP servers as PluginRows. */
export function discoverMcpServers(): PluginRow[] {
  return listStoredServers().map((entry) => storedRow(entry.def, entry.source, entry.enabled));
}
