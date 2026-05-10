import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { defaultCodexConfigPath, pluginConfigKey } from "./plugin-config";

export type PluginRow = {
  id: string;
  name: string;
  displayName?: string;
  version?: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  description?: string;
  shortDescription?: string;
  source?: string;
  category?: string;
  capabilities?: string[];
  defaultPrompts?: string[];
  brandColor?: string;
  iconPath?: string;
  skillPath?: string;
  mcpConfigPath?: string;
  appConfigPath?: string;
  appPath?: string;
};

export function defaultPluginRoots(): string[] {
  const home = homedir();
  const config = readCodexConfig(path.join(home, ".codex", "config.toml"));
  return uniquePaths([
    ...config.marketplaces.flatMap((marketplace) => [
      marketplace.source,
      path.join(marketplace.source, "plugins"),
    ]),
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

type CodexConfig = {
  marketplaces: Array<{ name: string; source: string }>;
  pluginEnabled: Map<string, boolean>;
};

function readCodexConfig(configPath: string): CodexConfig {
  const config: CodexConfig = { marketplaces: [], pluginEnabled: new Map() };
  try {
    const raw = readFileSync(configPath, "utf8");
    let section: { kind: "marketplace" | "plugin"; key: string } | null = null;
    for (const line of raw.split(/\r?\n/)) {
      const marketplace = /^\[marketplaces\.([^\]]+)\]\s*$/.exec(line);
      if (marketplace) {
        section = { kind: "marketplace", key: marketplace[1].replaceAll('"', "") };
        continue;
      }
      const plugin = /^\[plugins\."([^"]+)"\]\s*$/.exec(line);
      if (plugin) {
        section = { kind: "plugin", key: plugin[1] };
        config.pluginEnabled.set(plugin[1], true);
        continue;
      }
      const source = /^\s*source\s*=\s*"([^"]+)"\s*$/.exec(line)?.[1];
      if (section?.kind === "marketplace" && source) {
        config.marketplaces.push({ name: section.key, source });
      }
      const enabled = /^\s*enabled\s*=\s*(true|false)\s*$/.exec(line)?.[1];
      if (section?.kind === "plugin" && enabled) {
        config.pluginEnabled.set(section.key, enabled === "true");
      }
    }
  } catch {
    // Missing Codex config is fine; we still scan ~/.codex/plugins.
  }
  return config;
}

function hasPluginMarker(dir: string): boolean {
  return (
    existsSync(path.join(dir, ".codex-plugin.toml")) ||
    existsSync(path.join(dir, ".codex-plugin", "plugin.json")) ||
    existsSync(path.join(dir, "plugin.toml")) ||
    existsSync(path.join(dir, "skills"))
  );
}

type PluginManifest = {
  name?: string;
  version?: string;
  description?: string;
  displayName?: string;
  shortDescription?: string;
  category?: string;
  capabilities?: string[];
  defaultPrompts?: string[];
  brandColor?: string;
  iconPath?: string;
  skillsPath?: string;
  mcpServersPath?: string;
  appsPath?: string;
};

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
    const json = JSON.parse(raw) as {
      description?: unknown;
      name?: unknown;
      version?: unknown;
      interface?: {
        displayName?: unknown;
        shortDescription?: unknown;
        category?: unknown;
        capabilities?: unknown;
        defaultPrompt?: unknown;
        brandColor?: unknown;
        composerIcon?: unknown;
        logo?: unknown;
      };
      skills?: unknown;
      mcpServers?: unknown;
      apps?: unknown;
    };
    const iface = json.interface;
    const icon = stringField(iface?.composerIcon) ?? stringField(iface?.logo);
    return {
      name: stringField(json.name),
      version: stringField(json.version),
      description: stringField(json.description),
      displayName: stringField(iface?.displayName),
      shortDescription: stringField(iface?.shortDescription),
      category: stringField(iface?.category),
      capabilities: stringArray(iface?.capabilities),
      defaultPrompts: stringArray(iface?.defaultPrompt),
      brandColor: stringField(iface?.brandColor),
      iconPath: icon ? path.resolve(dir, icon) : undefined,
      skillsPath: resolveManifestPath(dir, json.skills),
      mcpServersPath: resolveManifestPath(dir, json.mcpServers),
      appsPath: resolveManifestPath(dir, json.apps),
    };
  } catch {
    return {};
  }
}

function resolveManifestPath(dir: string, value: unknown): string | undefined {
  const raw = stringField(value);
  return raw ? path.resolve(dir, raw) : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((entry): entry is string => typeof entry === "string" && !!entry);
  return values.length ? values : undefined;
}

function marketplaceFromPath(dir: string): string | undefined {
  const parts = dir.split(path.sep);
  const cacheIdx = parts.lastIndexOf("cache");
  if (cacheIdx !== -1 && parts[cacheIdx + 1]) return parts[cacheIdx + 1];
  const pluginsIdx = parts.lastIndexOf("plugins");
  if (pluginsIdx > 0 && parts[pluginsIdx - 1]?.startsWith("openai-")) return parts[pluginsIdx - 1];
  return undefined;
}

function pluginResourcePaths(
  dir: string,
  manifest: PluginManifest,
): Pick<PluginRow, "appConfigPath" | "appPath" | "mcpConfigPath" | "skillPath"> {
  const skills = manifest.skillsPath ?? path.join(dir, "skills");
  const mcp = manifest.mcpServersPath ?? path.join(dir, ".mcp.json");
  const apps = manifest.appsPath ?? path.join(dir, ".app.json");
  const computerUseApp = path.join(dir, "Codex Computer Use.app");
  return {
    ...(existsSync(skills) ? { skillPath: skills } : {}),
    ...(existsSync(mcp) ? { mcpConfigPath: mcp } : {}),
    ...(existsSync(apps) ? { appConfigPath: apps } : {}),
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
      displayName: "Computer Use",
      path: computerUseApp,
      installed: true,
      enabled: true,
      source: "openai-bundled",
      category: "Productivity",
      capabilities: ["Interactive", "Read", "Write"],
      appPath: computerUseApp,
      description: "Local Codex Computer Use helper app.",
    });
  }
  return rows;
}

export function discoverPlugins(
  roots: string[] = defaultPluginRoots(),
  options: { configPath?: string; maxDepth?: number } = {},
): PluginRow[] {
  const maxDepth = options.maxDepth ?? 8;
  const codexConfig = readCodexConfig(
    options.configPath ?? defaultCodexConfigPath(),
  );
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
      const name = manifest.name ?? pluginNameFromPath(dir);
      const source = marketplaceFromPath(dir);
      const enabled =
        (source ? codexConfig.pluginEnabled.get(pluginConfigKey(name, source)) : undefined) ??
        true;
      rows.push({
        id: dir,
        name,
        ...(manifest.displayName ? { displayName: manifest.displayName } : {}),
        ...(manifest.version ? { version: manifest.version } : {}),
        path: dir,
        installed: true,
        enabled,
        ...(source ? { source } : {}),
        ...(manifest.description ? { description: manifest.description } : {}),
        ...(manifest.shortDescription ? { shortDescription: manifest.shortDescription } : {}),
        ...(manifest.category ? { category: manifest.category } : {}),
        ...(manifest.capabilities ? { capabilities: manifest.capabilities } : {}),
        ...(manifest.defaultPrompts ? { defaultPrompts: manifest.defaultPrompts } : {}),
        ...(manifest.brandColor ? { brandColor: manifest.brandColor } : {}),
        ...(manifest.iconPath && existsSync(manifest.iconPath)
          ? { iconPath: manifest.iconPath }
          : {}),
        ...pluginResourcePaths(dir, manifest),
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
