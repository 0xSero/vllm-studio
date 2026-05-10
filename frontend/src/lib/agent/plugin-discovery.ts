import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type PluginRow = {
  id: string;
  name: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  description?: string;
  source?: string;
  skillPath?: string;
  mcpConfigPath?: string;
  appPath?: string;
};

export function defaultPluginRoots(): string[] {
  const home = homedir();
  return uniquePaths([
    ...codexMarketplaceRoots(path.join(home, ".codex", "config.toml")),
    path.join(home, ".codex", "plugins"),
  ]);
}

function uniquePaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(path.resolve(value))) return false;
    seen.add(path.resolve(value));
    return true;
  });
}

function codexMarketplaceRoots(configPath: string): string[] {
  try {
    const raw = readFileSync(configPath, "utf8");
    const roots = [...raw.matchAll(/^\s*source\s*=\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);
    return roots.flatMap((root) => [root, path.join(root, "plugins")]);
  } catch {
    return [];
  }
}

function hasPluginMarker(dir: string): boolean {
  return (
    existsSync(path.join(dir, ".codex-plugin.toml")) ||
    existsSync(path.join(dir, ".codex-plugin", "plugin.json")) ||
    existsSync(path.join(dir, "plugin.toml")) ||
    existsSync(path.join(dir, "skills"))
  );
}

type PluginManifest = { name?: string; description?: string };

function pluginNameFromPath(dir: string): string {
  const manifest = pluginManifest(dir);
  if (manifest.name) return manifest.name;
  const base = path.basename(dir);
  const parent = path.basename(path.dirname(dir));
  // Cached Codex plugins usually live at `<plugin>/<version-or-hash>/skills`.
  // In that shape the parent is the useful human/plugin name, not the hash.
  if (/^\d/.test(base) || /^[a-f0-9]{12,}$/i.test(base) || /^\d+\.\d+/.test(base)) {
    return parent;
  }
  return base;
}

function pluginManifest(dir: string): PluginManifest {
  try {
    const raw = readFileSync(path.join(dir, ".codex-plugin", "plugin.json"), "utf8");
    const json = JSON.parse(raw) as { description?: unknown; name?: unknown };
    return {
      name: typeof json.name === "string" && json.name.trim() ? json.name.trim() : undefined,
      description:
        typeof json.description === "string" && json.description.trim()
          ? json.description.trim()
          : undefined,
    };
  } catch {
    return {};
  }
}

function pluginResourcePaths(
  dir: string,
): Pick<PluginRow, "appPath" | "mcpConfigPath" | "skillPath"> {
  const skills = path.join(dir, "skills");
  const mcp = path.join(dir, ".mcp.json");
  const computerUseApp = path.join(dir, "Codex Computer Use.app");
  return {
    ...(existsSync(skills) ? { skillPath: skills } : {}),
    ...(existsSync(mcp) ? { mcpConfigPath: mcp } : {}),
    ...(existsSync(computerUseApp) ? { appPath: computerUseApp } : {}),
  };
}

function knownLocalPluginRows(): PluginRow[] {
  const home = homedir();
  const rows: PluginRow[] = [];
  const computerUseApp = path.join(home, ".codex", "computer-use", "Codex Computer Use.app");
  if (existsSync(computerUseApp)) {
    rows.push({
      id: "builtin:computer-use",
      name: "computer-use",
      path: computerUseApp,
      installed: true,
      enabled: true,
      source: "openai-bundled",
      appPath: computerUseApp,
      description: "Local Codex Computer Use helper app.",
    });
  }
  return rows;
}

export function discoverPlugins(
  roots: string[] = defaultPluginRoots(),
  options: { maxDepth?: number } = {},
): PluginRow[] {
  const maxDepth = options.maxDepth ?? 8;
  const rows: PluginRow[] = [];
  const seen = new Set<string>();

  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth || seen.has(dir)) return;
    seen.add(dir);
    let stat;
    try {
      stat = statSync(dir);
    } catch {
      return;
    }
    if (!stat.isDirectory()) return;

    if (hasPluginMarker(dir)) {
      const manifest = pluginManifest(dir);
      rows.push({
        id: dir,
        name: manifest.name ?? pluginNameFromPath(dir),
        path: dir,
        installed: true,
        enabled: true,
        ...(manifest.description ? { description: manifest.description } : {}),
        ...pluginResourcePaths(dir),
      });
      return;
    }

    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") && depth > 0) continue;
      visit(path.join(dir, entry), depth + 1);
    }
  };

  for (const root of roots) visit(root, 0);
  const includesDefaultRoot = roots.some(
    (root) => path.resolve(root) === path.resolve(path.join(homedir(), ".codex", "plugins")),
  );
  if (includesDefaultRoot) {
    for (const row of knownLocalPluginRows()) {
      if (!rows.some((candidate) => candidate.name === row.name)) rows.push(row);
    }
  }
  return [...new Map(rows.map((row) => [row.name.toLowerCase(), row])).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled));
}
