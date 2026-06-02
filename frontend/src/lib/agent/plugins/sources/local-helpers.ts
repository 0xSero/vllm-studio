// Local helper plugin source: the bundled computer-use / sybil desktop-control
// helper apps that ship outside the marketplace cache. These live under
// `<dataDir>/computer-use` and `~/.codex/computer-use` and own a real
// "Codex Computer Use.app" plus an optional `.mcp.json` + `skills/`. They are
// `launch: "host-app"` because they need the bundled SkyComputerUseClient
// binary, and tagged `source: "openai-bundled"` so they sort alongside the rest
// of the bundled set (the old blunt openai- filter is gone, so they survive).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DiscoveryCtx, PluginRow, PluginSource } from "../types";

export const localHelpersSource: PluginSource = {
  id: "local-helpers",
  kind: "assets",
  list(ctx: DiscoveryCtx): PluginRow[] {
    const rows: PluginRow[] = [];
    for (const computerUseRoot of localComputerUseRoots(ctx)) {
      const computerUseApp = path.join(computerUseRoot, "Codex Computer Use.app");
      const computerUseMcp = path.join(computerUseRoot, ".mcp.json");
      const computerUseSkills = path.join(computerUseRoot, "skills");
      if (!existsSync(computerUseApp)) continue;
      const isSybil = localComputerUseMcpServerNames(computerUseMcp).includes("sybil");
      rows.push({
        id: `builtin:computer-use:${computerUseRoot}`,
        name: isSybil ? "sybil" : "computer-use",
        displayName: isSybil ? "Sybil" : "Computer Use",
        path: computerUseRoot,
        installed: true,
        enabled: true,
        source: "openai-bundled",
        category: "Productivity",
        capabilities: ["Interactive", "Read", "Write"],
        launch: "host-app",
        appPath: computerUseApp,
        ...(existsSync(computerUseMcp) ? { mcpConfigPath: computerUseMcp } : {}),
        ...(existsSync(computerUseSkills) ? { skillPath: computerUseSkills } : {}),
        description: isSybil
          ? "Local Sybil desktop-control MCP backed by the clean-room Computer Use implementation."
          : "Local Codex Computer Use helper app.",
        shortDescription: isSybil ? "Desktop UI through Sybil" : undefined,
      });
    }
    return rows;
  },
};

function localComputerUseRoots(ctx: DiscoveryCtx): string[] {
  return [
    path.join(ctx.dataDir, "computer-use"),
    path.join(ctx.home, ".codex", "computer-use"),
  ];
}

function localComputerUseMcpServerNames(configPath: string): string[] {
  if (!existsSync(configPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return Object.keys(parsed.mcpServers ?? {}).map((name) => name.toLowerCase());
  } catch {
    return [];
  }
}
