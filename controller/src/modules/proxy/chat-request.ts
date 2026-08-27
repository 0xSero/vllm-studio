import type { Logger } from "../../core/logger";
import type { ProxyPayload } from "./usage-observer";
import { isProxyObject, stringFromProxyValue } from "./usage-observer";
import type { AppContext } from "../../app-context";
import { Effect } from "effect";
import type { Recipe } from "../models/types";
import { buildInferenceUrl } from "../../http/local-fetch";
import {
  DEFAULT_CHAT_PROVIDER,
  parseProviderModel,
  resolveConfiguredProviderConfig,
  type ProviderRouteConfig,
} from "../../services/provider-routing";
const PROXY_SESSION_HEADER_NAMES = [
  "x-vllm-session-id",
  "x-session-id",
  "x-chat-session-id",
  "openai-conversation-id",
];

const NON_RUNNING_MODEL_WARN_INTERVAL_MS = 10 * 60_000;

interface WarningLogDetails {
  [key: string]: string | number | null | undefined;
  requested_model: string | null;
  requested_recipe_id: string;
  active_model: string | null;
  source: string | null;
  suppressed_requests?: number;
}

export interface UpstreamAuth {
  [key: string]: string;
  Authorization: string;
}

interface NonRunningModelWarningState {
  lastWarnAt: number;
  suppressed: number;
}

export interface NonRunningModelWarnDetails {
  requestedModel: string | null;
  requestedRecipeId: string;
  activeModel: string | null;
  source: string | null;
}

export const createNonRunningModelWarner = (
  logger: Pick<Logger, "warn">,
): ((details: NonRunningModelWarnDetails) => void) => {
  const warnings = new Map<string, NonRunningModelWarningState>();
  return (details) => {
    const key = [
      details.requestedRecipeId,
      details.requestedModel ?? "",
      details.activeModel ?? "",
      details.source ?? "",
    ].join("\u0000");
    const now = Date.now();
    const state = warnings.get(key) ?? { lastWarnAt: 0, suppressed: 0 };
    if (now - state.lastWarnAt < NON_RUNNING_MODEL_WARN_INTERVAL_MS) {
      state.suppressed += 1;
      warnings.set(key, state);
      return;
    }

    const suppressed = state.suppressed;
    warnings.set(key, { lastWarnAt: now, suppressed: 0 });
    const logDetails: WarningLogDetails = {
      requested_model: details.requestedModel,
      requested_recipe_id: details.requestedRecipeId,
      active_model: details.activeModel,
      source: details.source,
    };
    if (suppressed > 0) logDetails.suppressed_requests = suppressed;
    logger.warn("Rejected chat request for non-running model", logDetails);
  };
};

export const extractSessionId = (
  parsedBody: ProxyPayload,
  header: (name: string) => string | undefined,
): string | null => {
  const fromHeader = PROXY_SESSION_HEADER_NAMES.map((name) => header(name)).find(Boolean);
  if (fromHeader?.trim()) return fromHeader.trim();

  const direct = stringFromProxyValue(
    parsedBody.session_id ?? parsedBody.sessionId ?? parsedBody.chat_id,
  );
  if (direct?.trim()) return direct.trim();

  const metadata = parsedBody.metadata;
  const fromMetadata = stringFromProxyValue(
    metadata?.session_id ?? metadata?.sessionId ?? metadata?.chat_id,
  );
  if (fromMetadata?.trim()) return fromMetadata.trim();

  return null;
};

export const findRecipeByModel = (
  modelName: string,
  context: Pick<AppContext, "stores">,
): Effect.Effect<Recipe | null, unknown> =>
  context.stores.recipeStore.list().pipe(
    Effect.map((recipes) => {
      const lower = modelName.toLowerCase();
      return (
        recipes.find((recipe) => {
          const served = (recipe.served_model_name ?? "").toLowerCase();
          const name = (recipe.name ?? "").toLowerCase();
          return served === lower || recipe.id.toLowerCase() === lower || (name && name === lower);
        }) ?? null
      );
    }),
  );

export interface UpstreamResolution {
  upstreamUrl: string;
  auth: Partial<UpstreamAuth>;
  requestProvider: string;
  providerRouting: ProviderRouteConfig | null;
  rewroteModel: boolean;
}

/**
 * Resolve where a requested model's traffic goes and how it authenticates.
 * A "provider/model" id routes to that configured provider with its key, and
 * anything else reaches the local inference engine with INFERENCE_API_KEY
 * when one is set. When provider-routed, the request body's model field is
 * rewritten to the provider-local id.
 */
export const resolveUpstreamForModel = (
  requestedModel: string | null,
  parsed: ProxyPayload,
  path: string,
  context: AppContext,
  options: { includeXApiKey?: boolean } = {},
): UpstreamResolution => {
  const providerModel = requestedModel
    ? parseProviderModel(requestedModel)
    : { provider: DEFAULT_CHAT_PROVIDER, modelId: "" };
  const requestProvider = providerModel.provider;
  const providerRouting =
    requestProvider !== DEFAULT_CHAT_PROVIDER
      ? resolveConfiguredProviderConfig(requestProvider, context.config.providers)
      : null;
  if (providerRouting) {
    parsed["model"] = providerModel.modelId;
    const auth: UpstreamAuth = {
      Authorization: `Bearer ${providerRouting.apiKey}`,
    };
    if (options.includeXApiKey) auth["x-api-key"] = providerRouting.apiKey;
    return {
      upstreamUrl: `${providerRouting.baseUrl.replace(/\/+$/, "")}${path}`,
      auth,
      requestProvider,
      providerRouting,
      rewroteModel: true,
    };
  }
  const inferenceKey = process.env["INFERENCE_API_KEY"] ?? "";
  return {
    upstreamUrl: buildInferenceUrl(context, path),
    auth: inferenceKey ? { Authorization: `Bearer ${inferenceKey}` } : {},
    requestProvider,
    providerRouting: null,
    rewroteModel: false,
  };
};

export const ensureStreamingUsageIncluded = (payload: ProxyPayload): boolean => {
  if (!payload.stream) return false;
  const existingStreamOptions = isProxyObject(payload.stream_options) ? payload.stream_options : {};
  if (existingStreamOptions["include_usage"] === true) return false;
  payload.stream_options = {
    ...existingStreamOptions,
    include_usage: true,
  };
  return true;
};
