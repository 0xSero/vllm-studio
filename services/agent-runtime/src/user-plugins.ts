import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Schema } from "effect";
import { expandHome } from "./pi-runtime-helpers";
import { isValidPluginId, type PluginRow } from "./plugin-contract";

export { PLUGIN_TEMPLATE, isValidPluginId, type PluginRow } from "./plugin-contract";

const DISABLED_SUFFIX = ".off";
const EXTENSION_SUFFIXES = [".ts", ".js"] as const;
const MAX_SOURCE_BYTES = 256 * 1024;
const PiManifestSchema = Schema.Struct({ pi: Schema.Unknown });

export function resolvePiAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim();
  return configured ? expandHome(configured) : path.join(homedir(), ".pi", "agent");
}

export function resolveUserPluginsDir(): string {
  return path.join(resolvePiAgentDir(), "extensions");
}

const isExtensionFile = (name: string): boolean =>
  EXTENSION_SUFFIXES.some((suffix) => name.endsWith(suffix));
const isDisabledFile = (name: string): boolean =>
  name.endsWith(DISABLED_SUFFIX) && isExtensionFile(name.slice(0, -DISABLED_SUFFIX.length));

function pluginIdForFile(name: string): string {
  const base = isDisabledFile(name) ? name.slice(0, -DISABLED_SUFFIX.length) : name;
  return base.replace(/\.(?:ts|js)$/, "");
}

async function describe(directory: string, file: string, readOnly: boolean): Promise<PluginRow> {
  const target = path.join(directory, file);
  const info = await stat(target).catch(() => null);
  return {
    id: pluginIdForFile(file),
    file,
    path: target,
    enabled: !isDisabledFile(file),
    bytes: info?.size ?? 0,
    updated_at: (info?.mtime ?? new Date(0)).toISOString(),
    read_only: readOnly,
  };
}

function directoryLoads(target: string): boolean {
  const manifest = path.join(target, "package.json");
  if (existsSync(manifest)) {
    try {
      Schema.decodeUnknownSync(PiManifestSchema)(JSON.parse(readFileSync(manifest, "utf8")));
      return true;
    } catch {}
  }
  return EXTENSION_SUFFIXES.some((suffix) => existsSync(path.join(target, `index${suffix}`)));
}

export async function listUserPlugins(): Promise<PluginRow[]> {
  const directory = resolveUserPluginsDir();
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const rows = await Promise.all(
    entries.flatMap((entry) => {
      const editable =
        (entry.isFile() || entry.isSymbolicLink()) &&
        (isExtensionFile(entry.name) || isDisabledFile(entry.name));
      const bundled = entry.isDirectory() && directoryLoads(path.join(directory, entry.name));
      return editable || bundled ? [describe(directory, entry.name, bundled)] : [];
    }),
  );
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

async function findPlugin(id: string): Promise<PluginRow | null> {
  return (await listUserPlugins()).find((plugin) => plugin.id === id) ?? null;
}

function requireEditable(plugin: PluginRow | null, id: string): PluginRow {
  if (!plugin) throw new Error(`Unknown plugin "${id}"`);
  if (plugin.read_only) throw new Error(`Plugin "${id}" is a directory, not a single file`);
  return plugin;
}

export async function readUserPlugin(id: string): Promise<{ plugin: PluginRow; source: string }> {
  const plugin = requireEditable(await findPlugin(id), id);
  return { plugin, source: await readFile(plugin.path, "utf8") };
}

export async function writeUserPlugin(id: string, source: string): Promise<PluginRow> {
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    throw new Error(`Plugin source exceeds ${MAX_SOURCE_BYTES / 1024} KB`);
  }
  const existing = await findPlugin(id);
  if (existing?.read_only) requireEditable(existing, id);
  if (!existing && !isValidPluginId(id)) {
    throw new Error("A plugin name may use lowercase letters, digits, and hyphens");
  }
  const directory = resolveUserPluginsDir();
  await mkdir(directory, { recursive: true });
  await chmod(directory, 0o700).catch(() => undefined);
  const file = existing?.file ?? `${id}.ts`;
  const target = path.join(directory, file);
  await writeFile(target, source, "utf8");
  await chmod(target, 0o600).catch(() => undefined);
  return describe(directory, file, false);
}

export async function setUserPluginEnabled(id: string, enabled: boolean): Promise<PluginRow> {
  const plugin = requireEditable(await findPlugin(id), id);
  if (plugin.enabled === enabled) return plugin;
  const directory = resolveUserPluginsDir();
  const file = enabled
    ? plugin.file.slice(0, -DISABLED_SUFFIX.length)
    : `${plugin.file}${DISABLED_SUFFIX}`;
  await rename(plugin.path, path.join(directory, file));
  return describe(directory, file, false);
}

export async function removeUserPlugin(id: string): Promise<void> {
  await unlink(requireEditable(await findPlugin(id), id).path);
}

export function userPluginsRevisionSync(): string {
  const directory = resolveUserPluginsDir();
  try {
    return readdirSync(directory)
      .filter(isExtensionFile)
      .sort()
      .map((name) => {
        const info = statSync(path.join(directory, name));
        return `${name}:${info.mtimeMs}:${info.size}`;
      })
      .join("|");
  } catch {
    return "none";
  }
}
