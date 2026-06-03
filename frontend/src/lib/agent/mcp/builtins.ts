// First-party bundled MCP servers. These ship inside the desktop app under
// `desktop/resources/` and are always launchable here (no Codex-signed runtime
// constraints):
//   - computer-use → our macOS Computer Use MCP server (computer-use/.mcp.json)
//   - chrome       → our Brave/CDP browser control (brave-bridge + skill)
//
// They own their bundled `.mcp.json` on disk, so the runtime loads them directly
// via the server's own config path — no materialization needed.

import { existsSync } from "node:fs";
import path from "node:path";
import type { McpServerDef } from "./types";

export const BUILTIN_SOURCE = "builtin";

function resourcesDir(): string | null {
  const candidates = [
    process.env.VLLM_STUDIO_BUILTIN_PLUGINS_DIR,
    process.resourcesPath ? path.join(process.resourcesPath, "desktop", "resources") : null,
    path.resolve(process.cwd(), "frontend", "desktop", "resources"),
    path.resolve(process.cwd(), "desktop", "resources"),
    path.resolve(process.cwd(), "..", "frontend", "desktop", "resources"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function computerUseDef(dir: string): (McpServerDef & { mcpConfigPath: string }) | null {
  const root = path.join(dir, "computer-use");
  const mcp = path.join(root, ".mcp.json");
  if (!existsSync(mcp)) return null;
  const skill = path.join(root, "skills", "computer-use");
  return {
    id: "builtin:computer-use",
    name: "computer-use",
    displayName: "Computer Use",
    description: "Control macOS apps via a first-party Computer Use MCP server (no OpenAI helper).",
    shortDescription: "Control macOS apps",
    category: "Productivity",
    transport: "stdio",
    command: "node",
    args: ["server.mjs"],
    cwd: root,
    mcpConfigPath: mcp,
    ...(existsSync(skill) ? { skillPath: skill } : {}),
  };
}

function chromeDef(dir: string): (McpServerDef & { mcpConfigPath?: string }) | null {
  const root = path.join(dir, "brave-bridge");
  if (!existsSync(root)) return null;
  const mcp = path.join(root, ".mcp.json");
  const skill = path.join(root, "skills", "chrome");
  return {
    id: "builtin:chrome",
    name: "chrome",
    displayName: "Chrome",
    description:
      "Drive your real, logged-in Brave/Chromium via the bundled extension + CDP bridge.",
    shortDescription: "Control your logged-in browser",
    category: "Engineering",
    transport: "stdio",
    command: "node",
    args: ["server.mjs"],
    cwd: root,
    ...(existsSync(mcp) ? { mcpConfigPath: mcp } : {}),
    ...(existsSync(skill) ? { skillPath: skill } : {}),
  };
}

/**
 * Bundled MCP server defs that resolve on disk. Each carries an `mcpConfigPath`
 * pointing at its own bundled `.mcp.json` (the runtime loads it directly).
 */
export function builtinServerDefs(): Array<McpServerDef & { mcpConfigPath?: string }> {
  const dir = resourcesDir();
  if (!dir) return [];
  return [computerUseDef(dir), chromeDef(dir)].filter(
    (def): def is McpServerDef & { mcpConfigPath?: string } => def !== null,
  );
}
