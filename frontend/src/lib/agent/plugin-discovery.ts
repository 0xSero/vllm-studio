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
};

export function defaultPluginRoots(): string[] {
  return [path.join(homedir(), ".codex", "plugins")];
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
  return [...new Map(rows.map((row) => [row.path, row])).values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled));
}
