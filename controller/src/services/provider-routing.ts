import { Effect, Schema } from "effect";
import type { ProviderConfig } from "../config/persisted-config";

export const DEFAULT_CHAT_PROVIDER = "openai";

export interface ParsedProviderModel {
  provider: string;
  modelId: string;
}

export interface ProviderRouteConfig {
  baseUrl: string;
  apiKey: string;
}

export interface ControllerProviderRoutingConfig {
  providers?: ProviderConfig[];
}

export const parseProviderModel = (rawModel: string): ParsedProviderModel => {
  const trimmed = rawModel.trim();
  if (!trimmed) {
    return { provider: DEFAULT_CHAT_PROVIDER, modelId: "" };
  }

  const delimiter = trimmed.indexOf("/");
  if (delimiter > 0 && delimiter < trimmed.length - 1) {
    const provider = trimmed.slice(0, delimiter).trim();
    const modelId = trimmed.slice(delimiter + 1).trim();
    if (modelId.length > 0) {
      return { provider: provider || DEFAULT_CHAT_PROVIDER, modelId };
    }
  }

  return { provider: DEFAULT_CHAT_PROVIDER, modelId: trimmed };
};

export const resolveConfiguredProviderConfig = (
  providerId: string,
  providers: ProviderConfig[] = [],
): ProviderRouteConfig | null => {
  const match = providers.find((p) => p.id.toLowerCase() === providerId.toLowerCase() && p.enabled);
  if (!match || !match.api_key) return null;
  return { baseUrl: match.base_url, apiKey: match.api_key };
};

export const resolveProviderConfig = (
  provider: string,
  config: ControllerProviderRoutingConfig = {},
): ProviderRouteConfig | null => {
  return resolveConfiguredProviderConfig(provider, config.providers);
};

export interface DiscoveredProviderModels {
  provider: string;
  models: Array<{ id: string }>;
}

const ProviderModelsSchema = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String) }))),
});

export const discoverProviderModels = (
  provider: ProviderConfig,
): Effect.Effect<DiscoveredProviderModels, unknown> =>
  Effect.gen(function* () {
    const url = `${provider.base_url.replace(/\/+$/, "")}/v1/models`;
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          headers: { Authorization: `Bearer ${provider.api_key}` },
          signal: AbortSignal.timeout(10_000),
        }),
      catch: (source) => source,
    });
    if (!response.ok) return yield* Effect.fail(response.status);
    const payload = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (source) => source,
    });
    const decoded = yield* Schema.decodeUnknownEffect(ProviderModelsSchema)(payload);
    const models = (decoded.data ?? []).flatMap((model) => {
      const id = model.id?.trim();
      return id ? [{ id }] : [];
    });
    return { provider: provider.id, models };
  });

export const enabledProvidersWithApiKey = (providers: ProviderConfig[] = []): ProviderConfig[] =>
  providers.filter((provider) => provider.enabled && provider.api_key);
