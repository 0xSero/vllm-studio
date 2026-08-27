import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Option, Schema } from "effect";

export type ObsidianVault = {
  path: string;
  name: string;
  open: boolean;
  lastOpened: string | null;
};

const VaultRecordSchema = Schema.Struct({
  path: Schema.String,
  ts: Schema.optional(Schema.Unknown),
  open: Schema.optional(Schema.Unknown),
});
type VaultRecord = typeof VaultRecordSchema.Type;
const isTimestamp = Schema.is(Schema.Number);
const ObsidianConfigSchema = Schema.Struct({
  vaults: Schema.Record(Schema.String, Schema.Unknown),
});

function configCandidates(): string[] {
  const override = process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG?.trim();
  if (override) return [override];
  const home = homedir();
  if (process.platform === "darwin") {
    return [path.join(home, "Library", "Application Support", "obsidian", "obsidian.json")];
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return [path.join(appData, "obsidian", "obsidian.json")];
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [
    path.join(configHome, "obsidian", "obsidian.json"),
    path.join(home, ".var", "app", "md.obsidian.Obsidian", "config", "obsidian", "obsidian.json"),
  ];
}

export function obsidianConfigPathSync(): string | null {
  return configCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

function toVault(record: VaultRecord): ObsidianVault | null {
  const vaultPath = record.path.trim();
  if (!vaultPath) return null;
  try {
    if (!statSync(vaultPath).isDirectory()) return null;
  } catch {
    return null;
  }
  const ts =
    record.ts !== undefined && isTimestamp(record.ts) && Number.isFinite(record.ts)
      ? record.ts
      : null;
  return {
    path: vaultPath,
    name: path.basename(vaultPath),
    open: record.open === true,
    lastOpened: ts === null ? null : new Date(ts).toISOString(),
  };
}

export function listObsidianVaultsSync(): ObsidianVault[] {
  const configPath = obsidianConfigPathSync();
  if (!configPath) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return [];
  }
  const config = Schema.decodeUnknownOption(ObsidianConfigSchema)(parsed);
  if (Option.isNone(config)) return [];
  return Object.values(config.value.vaults)
    .filter(Schema.is(VaultRecordSchema))
    .map(toVault)
    .filter((vault): vault is ObsidianVault => vault !== null)
    .sort((a, b) => {
      if (a.open !== b.open) return a.open ? -1 : 1;
      return (b.lastOpened ?? "").localeCompare(a.lastOpened ?? "");
    });
}

export function hasObsidianVaultSync(): boolean {
  return listObsidianVaultsSync().length > 0;
}
