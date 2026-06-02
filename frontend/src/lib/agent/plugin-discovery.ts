import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { defaultPluginRoots } from "./plugins/internal";
import { discoverPluginsSync } from "./plugins/registry";
import type { PluginRow } from "./plugins/types";

// PluginRow now lives in plugins/types.ts; re-export it so existing importers
// (plugin-response.ts, etc.) keep resolving it from this module.
export type { PluginRow } from "./plugins/types";
// defaultPluginRoots moved into plugins/internal.ts with the rest of the shared
// dir-walk helpers; re-export so external callers and our own default param work.
export { defaultPluginRoots } from "./plugins/internal";

/**
 * Disk-only plugin discovery. Thin wrapper over the module's
 * `discoverPluginsSync` so this keeps its long-standing synchronous signature
 * and return shape for every existing caller. The hybrid (disk + live Codex
 * app-server overlay) path is `discoverPluginsAsync` in plugins/registry.ts,
 * which the plugins route now awaits. The blunt `openai-` source filter is gone:
 * visibility is data-driven via plugins/policy.ts (default shows everything).
 *
 * When no explicit `roots` are given we run every asset source (so the bundled
 * Codex.app plugins are included and the sync result matches the async disk
 * rows). Explicit `roots` (e.g. loadPluginInstructions' single resolved dir)
 * take the targeted dir-walk so single-plugin resolution keeps working.
 */
export function discoverPlugins(
  roots?: string[],
  options: { configPath?: string; maxDepth?: number } = {},
): PluginRow[] {
  return discoverPluginsSync(roots, options);
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readSkillMarkdowns(dir: string, maxChars: number): string | undefined {
  const chunks: string[] = [];
  const visit = (current: string, depth: number) => {
    if (depth > 4 || chunks.join("\n\n").length >= maxChars) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(current).sort();
    } catch {
      return;
    }
    if (entries.includes("SKILL.md")) {
      const raw = readFileSync(path.join(current, "SKILL.md"), "utf8").trim();
      if (raw) chunks.push(raw);
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const candidate = path.join(current, entry);
      try {
        if (statSync(candidate).isDirectory()) visit(candidate, depth + 1);
      } catch {
        // ignore unreadable plugin skill folders
      }
    }
  };
  visit(dir, 0);
  const joined = chunks.join("\n\n---\n\n").slice(0, maxChars).trim();
  return joined || undefined;
}

export function loadPluginInstructions(
  pluginPath: string,
  roots: string[] = defaultPluginRoots(),
  maxChars = 8000,
): PluginRow | null {
  const resolved = path.resolve(pluginPath);
  if (!roots.some((root) => path.resolve(root) === resolved || isInside(resolved, root))) {
    return null;
  }
  const plugin = discoverPlugins([resolved], { maxDepth: 1 })[0];
  if (!plugin) return null;
  const skillsDir = plugin.skillPath;
  const instructions =
    skillsDir && existsSync(skillsDir) ? readSkillMarkdowns(skillsDir, maxChars) : undefined;
  return instructions ? { ...plugin, instructions } : plugin;
}
