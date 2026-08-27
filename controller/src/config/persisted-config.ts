import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Schema } from "effect";

export interface ProviderConfig {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  enabled: boolean;
}

export interface PersistedConfig {
  models_dir?: string;
  providers?: ProviderConfig[];
  ui_preferences?: Record<string, string>;
  selected_runtime_target_ids?: Partial<Record<"vllm" | "sglang" | "llamacpp" | "mlx", string>>;
}

const ProviderConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  base_url: Schema.String,
  api_key: Schema.String,
  enabled: Schema.Boolean,
});

const PersistedConfigSchema = Schema.Struct({
  models_dir: Schema.optionalKey(Schema.String),
  providers: Schema.optionalKey(Schema.mutable(Schema.Array(ProviderConfigSchema))),
  ui_preferences: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  selected_runtime_target_ids: Schema.optionalKey(
    Schema.Struct({
      vllm: Schema.optionalKey(Schema.String),
      sglang: Schema.optionalKey(Schema.String),
      llamacpp: Schema.optionalKey(Schema.String),
      mlx: Schema.optionalKey(Schema.String),
    }),
  ),
});

export const getPersistedConfigPath = (dataDirectory: string): string => {
  return resolve(dataDirectory, "studio-settings.json");
};

export const loadPersistedConfig = (dataDirectory: string): PersistedConfig => {
  const path = getPersistedConfigPath(dataDirectory);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = readFileSync(path, "utf-8");
    const parsed = Schema.decodeUnknownOption(PersistedConfigSchema)(JSON.parse(content));
    return parsed._tag === "Some" ? parsed.value : {};
  } catch {
    return {};
  }
};

type PersistedConfigUpdates = {
  [K in keyof PersistedConfig]?: PersistedConfig[K] | null;
};

export const savePersistedConfig = (
  dataDirectory: string,
  updates: PersistedConfigUpdates,
): PersistedConfig => {
  const path = getPersistedConfigPath(dataDirectory);
  const current = loadPersistedConfig(dataDirectory);
  const next: PersistedConfig = { ...current };
  if (updates.models_dir === null) delete next.models_dir;
  else if (updates.models_dir !== undefined) next.models_dir = updates.models_dir;
  if (updates.providers === null) delete next.providers;
  else if (updates.providers !== undefined) next.providers = updates.providers;
  if (updates.ui_preferences === null) delete next.ui_preferences;
  else if (updates.ui_preferences !== undefined) next.ui_preferences = updates.ui_preferences;
  if (updates.selected_runtime_target_ids === null) delete next.selected_runtime_target_ids;
  else if (updates.selected_runtime_target_ids !== undefined) {
    next.selected_runtime_target_ids = updates.selected_runtime_target_ids;
  }
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  // Write-then-rename so a crash mid-write can't truncate the file — a truncated
  // read is swallowed by loadPersistedConfig, silently resetting models_dir /
  // providers / selected_runtime_target_ids.
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, JSON.stringify(next, null, 2));
  renameSync(temporaryPath, path);
  try {
    chmodSync(dataDirectory, 0o700);
    chmodSync(path, 0o600);
  } catch {
    // Ignore permission hardening failures on unsupported filesystems.
  }
  return next;
};
