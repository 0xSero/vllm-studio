// Bundled plugin source: scans the OpenAI Codex.app bundled plugins shipped on
// macOS (computer-use, chrome, browser, latex). Each plugin owns real disk
// assets (skills, .mcp.json, helper app), so this is an "assets" source. We
// reuse the shared disk→PluginRow builder so metadata parsing matches every
// other source, then pin source:"openai-bundled" and mark computer-use as a
// host-app launch (it needs the bundled SkyComputerUseClient helper binary).

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pluginRowFromDirectory } from "../internal";
import type { DiscoveryCtx, PluginRow, PluginSource } from "../types";

// Hardcoded macOS install location for the Codex.app bundled marketplace. Guard
// with existsSync so non-macOS hosts (or installs without Codex.app) degrade to
// an empty list instead of throwing.
const BUNDLED_PLUGINS_DIR =
  "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins";

const BUNDLED_MARKETPLACE = "openai-bundled";

function listBundledPlugins(ctx: DiscoveryCtx): PluginRow[] {
  if (!existsSync(BUNDLED_PLUGINS_DIR)) return [];
  const rows: PluginRow[] = [];
  for (const entry of readableDirectoryEntries(BUNDLED_PLUGINS_DIR)) {
    if (entry.startsWith(".")) continue;
    const dir = path.join(BUNDLED_PLUGINS_DIR, entry);
    // Bundled plugins always ship a `.codex-plugin/plugin.json` manifest; gate
    // on it so stray files/dirs never become rows.
    if (!existsSync(path.join(dir, ".codex-plugin", "plugin.json"))) continue;
    // The shared builder reads the manifest and resolves skillPath/mcpConfigPath/
    // appPath from disk; ctx is a structural superset of the CodexConfig it wants
    // (pluginEnabled + marketplaces), so enabled resolution stays consistent.
    const row = pluginRowFromDirectory(dir, ctx);
    rows.push({
      ...row,
      source: BUNDLED_MARKETPLACE,
      ...(isHostAppPlugin(dir, row) ? { launch: "host-app" as const } : {}),
    });
  }
  return rows;
}

function readableDirectoryEntries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// computer-use drives a bundled native helper (SkyComputerUseClient inside
// "Codex Computer Use.app"); such plugins are launch-constrained outside the
// Codex host. Detect by name or by the presence of the helper app bundle so the
// flag survives a future rename of the plugin directory.
function isHostAppPlugin(dir: string, row: PluginRow): boolean {
  if (row.name.toLowerCase() === "computer-use") return true;
  return (
    existsSync(path.join(dir, "Codex Computer Use.app")) ||
    existsSync(
      path.join(
        dir,
        "Codex Computer Use.app",
        "Contents",
        "SharedSupport",
        "SkyComputerUseClient.app",
      ),
    )
  );
}

export const bundledSource: PluginSource = {
  id: "bundled",
  kind: "assets",
  list: listBundledPlugins,
};
