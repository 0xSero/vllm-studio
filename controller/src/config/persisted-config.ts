import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  FoundryProjectConnectionSchema,
  ProviderAuthenticationSchema,
  type ProviderAuthentication,
} from "@local-studio/contracts/enterprise-auth";
import {
  KubernetesConnectionConfigSchema,
  type KubernetesConnectionConfig,
} from "@local-studio/contracts/environment-commissioning";
import { Schema } from "effect";
import { normalizeAdmittedProviderBaseUrl } from "../services/provider-boundary";
import { normalizeProviderAuthentication } from "../services/provider-authentication";
import {
  ProviderSecretStore,
  newProviderApiKeyReference,
  newProviderSubscriptionKeyReference,
  providerApiKeyReference,
  providerSecretReferenceMatches,
  providerSubscriptionKeyReference,
  type ProviderSecretMutation,
} from "../services/provider-secret-store";

export const ProviderConfigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  base_url: Schema.String,
  enabled: Schema.Boolean,
  authentication: ProviderAuthenticationSchema,
  subscription_key: Schema.optional(
    Schema.Struct({ header: Schema.String, secret_ref: Schema.String }),
  ),
  foundry: Schema.optional(FoundryProjectConnectionSchema),
  path_style: Schema.optional(Schema.Literals(["openai", "azure"])),
  api_version: Schema.optional(Schema.String),
});
export type ProviderConfig = typeof ProviderConfigSchema.Type;

export interface PersistedConfig {
  models_dir?: string;
  providers?: ProviderConfig[];
  selected_runtime_target_ids?: Partial<Record<"vllm" | "sglang" | "llamacpp" | "mlx", string>>;
  kubernetes_connection?: KubernetesConnectionConfig;
}

export const getPersistedConfigPath = (dataDirectory: string): string => {
  return resolve(dataDirectory, "studio-settings.json");
};

const validProviderId = (value: string): boolean =>
  /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value) && value !== "openai";

const syncDirectory = (path: string): void => {
  try {
    const handle = openSync(path, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  } catch (source) {
    const code = (source as NodeJS.ErrnoException).code;
    if (
      process.platform === "win32" &&
      ["EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(code ?? "")
    ) {
      return;
    }
    throw source;
  }
};

const decodeProviders = (
  value: unknown,
): { providers: ProviderConfig[]; changed: boolean; secretMutations: ProviderSecretMutation[] } => {
  if (!Array.isArray(value)) {
    return { providers: [], changed: value !== undefined, secretMutations: [] };
  }
  const providers: ProviderConfig[] = [];
  const ids = new Set<string>();
  const secretMutations: ProviderSecretMutation[] = [];
  let changed = false;
  for (const candidate of value) {
    try {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        changed = true;
        continue;
      }
      const record = candidate as Record<string, unknown>;
      const id = typeof record["id"] === "string" ? record["id"].trim().toLowerCase() : "";
      const name = typeof record["name"] === "string" ? record["name"].trim() : "";
      const baseUrl =
        typeof record["base_url"] === "string"
          ? normalizeAdmittedProviderBaseUrl(record["base_url"])
          : "";
      if (!validProviderId(id) || !name || !baseUrl || ids.has(id)) {
        changed = true;
        continue;
      }
      const legacyKey = typeof record["api_key"] === "string" ? record["api_key"].trim() : "";
      let authentication: ProviderAuthentication;
      if (record["authentication"] === undefined) {
        authentication = legacyKey ? { type: "api_key" } : { type: "none" };
        changed = true;
      } else {
        authentication = Schema.decodeUnknownSync(ProviderAuthenticationSchema)(
          record["authentication"],
        );
      }
      if (authentication.type === "api_key") {
        const existingReference = providerSecretReferenceMatches(
          id,
          authentication.secret_ref,
          "api-key",
        )
          ? authentication.secret_ref
          : providerApiKeyReference(id);
        if (authentication.secret_ref !== existingReference) changed = true;
        if (legacyKey) {
          const migratedReference = newProviderApiKeyReference(id);
          secretMutations.push({ ref: migratedReference, value: legacyKey });
          authentication = { type: "api_key", secret_ref: migratedReference };
        } else {
          authentication = { type: "api_key", secret_ref: existingReference };
        }
      } else if (legacyKey) {
        changed = true;
      }
      authentication = normalizeProviderAuthentication(id, authentication);
      if ("api_key" in record) changed = true;
      let subscriptionKey: { header: string; secret_ref: string } | undefined;
      const rawSubscriptionKey = record["subscription_key"];
      if (rawSubscriptionKey && typeof rawSubscriptionKey === "object" && !Array.isArray(rawSubscriptionKey)) {
        const subRecord = rawSubscriptionKey as Record<string, unknown>;
        const header = typeof subRecord["header"] === "string" ? subRecord["header"].trim() : "";
        const legacySubscriptionValue = typeof subRecord["value"] === "string" ? subRecord["value"].trim() : "";
        const existingReference = providerSecretReferenceMatches(
          id,
          subRecord["secret_ref"] as string | undefined,
          "subscription-key",
        )
          ? (subRecord["secret_ref"] as string)
          : providerSubscriptionKeyReference(id);
        if (header && legacySubscriptionValue) {
          const migratedReference = newProviderSubscriptionKeyReference(id);
          secretMutations.push({ ref: migratedReference, value: legacySubscriptionValue });
          subscriptionKey = { header, secret_ref: migratedReference };
          changed = true;
        } else if (header && existingReference !== providerSubscriptionKeyReference(id)) {
          subscriptionKey = { header, secret_ref: existingReference };
        } else if (header || legacySubscriptionValue) {
          changed = true;
        }
      }
      const provider = Schema.decodeUnknownSync(ProviderConfigSchema)({
        id,
        name,
        base_url: baseUrl,
        enabled: record["enabled"] !== false,
        authentication,
        ...(subscriptionKey ? { subscription_key: subscriptionKey } : {}),
        ...(record["foundry"] === undefined
          ? {}
          : {
              foundry: Schema.decodeUnknownSync(FoundryProjectConnectionSchema)(record["foundry"]),
            }),
        ...(typeof record["path_style"] === "string" ? { path_style: record["path_style"] } : {}),
        ...(typeof record["api_version"] === "string" ? { api_version: record["api_version"] } : {}),
      });
      providers.push(provider);
      ids.add(id);
      if (record["id"] !== id || record["name"] !== name || record["base_url"] !== baseUrl) {
        changed = true;
      }
    } catch {
      changed = true;
    }
  }
  return { providers, changed, secretMutations };
};

const writePersistedConfig = (
  path: string,
  dataDirectory: string,
  config: PersistedConfig,
): void => {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    const temporaryHandle = openSync(temporaryPath, "r");
    try {
      fsyncSync(temporaryHandle);
    } finally {
      closeSync(temporaryHandle);
    }
    renameSync(temporaryPath, path);
    syncDirectory(dirname(path));
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
  try {
    chmodSync(dataDirectory, 0o700);
    chmodSync(path, 0o600);
  } catch {}
};

const activeProviderSecretReferences = (
  providers: readonly ProviderConfig[],
): ReadonlySet<string> =>
  new Set(
    providers.flatMap((provider) => {
      const references: string[] = [];
      if (provider.authentication.type === "api_key" && provider.authentication.secret_ref) {
        references.push(provider.authentication.secret_ref);
      }
      if (provider.subscription_key?.secret_ref) {
        references.push(provider.subscription_key.secret_ref);
      }
      for (const authentication of [provider.authentication, provider.foundry?.authentication]) {
        if (
          (authentication?.type === "oidc_user" || authentication?.type === "apim_gateway") &&
          authentication.token_exchange?.client_secret_ref
        ) {
          references.push(authentication.token_exchange.client_secret_ref);
        }
        if (authentication?.type === "apim_client" && authentication.client_secret_ref) {
          references.push(authentication.client_secret_ref);
        }
      }
      return references;
    }),
  );

export const loadPersistedConfig = (
  dataDirectory: string,
  secretStore = new ProviderSecretStore(dataDirectory, false),
  reconcileSecrets = true,
): PersistedConfig => {
  const path = getPersistedConfigPath(dataDirectory);
  if (!existsSync(path)) return {};
  let parsed: PersistedConfig;
  try {
    const content = readFileSync(path, "utf-8");
    parsed = JSON.parse(content) as PersistedConfig;
    if (!parsed || typeof parsed !== "object") return {};
  } catch {
    return {};
  }
  const decodedProviders = decodeProviders((parsed as { providers?: unknown }).providers);
  if ((parsed as { providers?: unknown }).providers !== undefined) {
    parsed.providers = decodedProviders.providers;
  }
  if (parsed.kubernetes_connection) {
    try {
      parsed.kubernetes_connection = Schema.decodeUnknownSync(KubernetesConnectionConfigSchema)(
        parsed.kubernetes_connection,
      );
    } catch {
      delete parsed.kubernetes_connection;
    }
  }
  const persistMigration = (): void => {
    if (decodedProviders.changed) writePersistedConfig(path, dataDirectory, parsed);
  };
  if (decodedProviders.secretMutations.length > 0) {
    secretStore.mutateSync(decodedProviders.secretMutations, persistMigration);
  } else {
    persistMigration();
  }
  if (reconcileSecrets) {
    secretStore.reconcileSync(activeProviderSecretReferences(decodedProviders.providers));
  }
  return parsed;
};

type PersistedConfigUpdates = {
  [K in keyof PersistedConfig]?: PersistedConfig[K] | null;
};

export const savePersistedConfig = (
  dataDirectory: string,
  updates: PersistedConfigUpdates,
  secretStore = new ProviderSecretStore(dataDirectory, false),
): PersistedConfig => {
  const path = getPersistedConfigPath(dataDirectory);
  const current = loadPersistedConfig(dataDirectory, secretStore, false);
  const next: PersistedConfig = { ...current };
  const writable = next as Record<
    keyof PersistedConfig,
    PersistedConfig[keyof PersistedConfig] | undefined
  >;
  (Object.keys(updates) as Array<keyof PersistedConfig>).forEach((key) => {
    const value = updates[key];
    if (value === null) {
      delete next[key];
      return;
    }
    if (value !== undefined) {
      writable[key] = value;
    }
  });
  writePersistedConfig(path, dataDirectory, next);
  secretStore.reconcileSync(activeProviderSecretReferences(next.providers ?? []));
  return next;
};
