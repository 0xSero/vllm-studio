import type { ProviderConfig } from "../config/persisted-config";
import { Effect, Schema } from "effect";
import {
  normalizeOpenAIBaseUrl,
  providerModelsEndpoint,
} from "../../../shared/agent/openai-endpoint";
import {
  resolveProviderHeaders,
  type ProviderAuthenticationContext,
} from "./provider-authentication";
import { assertProviderOutboundUrl } from "./provider-boundary";

export const DEFAULT_CHAT_PROVIDER = "openai";

export const isReservedProviderId = (providerId: string): boolean =>
  providerId.trim().toLowerCase() === DEFAULT_CHAT_PROVIDER;

export interface ParsedProviderModel {
  provider: string;
  modelId: string;
}

export interface ProviderRouteConfig {
  baseUrl: string;
  provider: ProviderConfig;
}

export interface ControllerProviderRoutingConfig {
  providers?: ProviderConfig[];
}

type ProviderFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => ReturnType<typeof fetch>;

const ProviderModelsSchema = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String) }))),
});

export type ProviderModelRoute =
  | { kind: "local"; provider: typeof DEFAULT_CHAT_PROVIDER; modelId: string }
  | { kind: "remote"; provider: string; modelId: string; config: ProviderRouteConfig }
  | { kind: "unavailable"; provider: string; modelId: string };

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
  if (!match) return null;
  if (match.authentication.type === "api_key" && !match.authentication.secret_ref) return null;
  return { baseUrl: normalizeOpenAIBaseUrl(match.base_url), provider: match };
};

export const providerIsDiscoverable = (provider: ProviderConfig): boolean => {
  return provider.enabled;
};

export const discoverProviderModels = (
  provider: ProviderConfig,
  fetcher: ProviderFetch = fetch,
  authenticationContext: ProviderAuthenticationContext = {},
): Effect.Effect<{ provider: string; models: Array<{ id: string }> }, unknown> =>
  Effect.gen(function* () {
    const headers = yield* resolveProviderHeaders(provider, authenticationContext);
    const baseUrl =
      fetcher === fetch
        ? yield* assertProviderOutboundUrl(provider.base_url)
        : normalizeOpenAIBaseUrl(provider.base_url);
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetcher(providerModelsEndpoint(baseUrl, provider.path_style, provider.api_version), {
          headers,
          signal: authenticationContext.signal
            ? AbortSignal.any([authenticationContext.signal, signal, AbortSignal.timeout(10_000)])
            : AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
          redirect: "error",
        }),
      catch: (source) => source,
    });
    if (!response.ok) return yield* Effect.fail(response.status);
    const payload = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (source) => source,
    });
    const decoded = yield* Schema.decodeUnknownEffect(ProviderModelsSchema)(payload);
    return {
      provider: provider.id,
      models: (decoded.data ?? []).flatMap((model) => {
        const id = model.id?.trim();
        return id ? [{ id }] : [];
      }),
    };
  });

export const resolveProviderConfig = (
  provider: string,
  config: ControllerProviderRoutingConfig = {},
): ProviderRouteConfig | null => {
  return resolveConfiguredProviderConfig(provider, config.providers);
};

export const resolveProviderModelRoute = (
  rawModel: string,
  config: ControllerProviderRoutingConfig = {},
  localModelMatched = false,
): ProviderModelRoute => {
  const parsed = parseProviderModel(rawModel);
  if (localModelMatched || parsed.provider === DEFAULT_CHAT_PROVIDER) {
    return { kind: "local", provider: DEFAULT_CHAT_PROVIDER, modelId: parsed.modelId };
  }
  const provider = resolveProviderConfig(parsed.provider, config);
  return provider
    ? { kind: "remote", provider: parsed.provider, modelId: parsed.modelId, config: provider }
    : { kind: "unavailable", provider: parsed.provider, modelId: parsed.modelId };
};
