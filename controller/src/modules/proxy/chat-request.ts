import type { Logger } from "../../core/logger";
import type { AppContext } from "../../app-context";
import { Effect } from "effect";
import type { Recipe } from "../models/types";
import { Schema } from "effect";
import { isProxyObject, type ProxyObject } from "./content-normalizer";
const PROXY_SESSION_HEADER_NAMES = [
  "x-vllm-session-id",
  "x-session-id",
  "x-chat-session-id",
  "openai-conversation-id",
];

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

const NON_RUNNING_MODEL_WARN_INTERVAL_MS = 10 * 60_000;

interface WarningLogDetails {
  [key: string]: string | number | null;
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
    const warningDetails: WarningLogDetails = {
      requested_model: details.requestedModel,
      requested_recipe_id: details.requestedRecipeId,
      active_model: details.activeModel,
      source: details.source,
    };
    if (suppressed > 0) warningDetails["suppressed_requests"] = suppressed;
    logger.warn("Rejected chat request for non-running model", warningDetails);
  };
};

export const extractSessionId = (
  parsedBody: ProxyObject,
  header: (name: string) => string | undefined,
): string | null => {
  const fromHeader = PROXY_SESSION_HEADER_NAMES.map((name) => header(name)).find(Boolean);
  if (fromHeader?.trim()) return fromHeader.trim();

  const direct = parsedBody["session_id"] ?? parsedBody["sessionId"] ?? parsedBody["chat_id"];
  if (Schema.is(Schema.String)(direct) && direct.trim()) return direct.trim();

  const metadata = parsedBody["metadata"];
  if (isProxyObject(metadata)) {
    const record = metadata;
    const fromMetadata = record["session_id"] ?? record["sessionId"] ?? record["chat_id"];
    if (Schema.is(Schema.String)(fromMetadata) && fromMetadata.trim()) return fromMetadata.trim();
  }

  return null;
};

export const attachSessionUsage = (
  result: ProxyObject,
  sessionId: string | null,
  usage: OpenAIUsage | undefined,
): void => {
  if (!sessionId) return;

  const promptTokens = usage?.["prompt_tokens"] ?? 0;
  const completionTokens = usage?.["completion_tokens"] ?? 0;
  const completionDetails = usage?.completion_tokens_details;
  const reasoningTokens =
    usage?.["reasoning_tokens"] ?? completionDetails?.["reasoning_tokens"] ?? 0;

  result["session_id"] = sessionId;
  result["session_usage"] = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    current_prompt_tokens: promptTokens,
    current_completion_tokens: completionTokens,
    current_reasoning_tokens: reasoningTokens,
  };
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

export const ensureStreamingUsageIncluded = (payload: ProxyObject): boolean => {
  if (!payload["stream"]) return false;
  const rawStreamOptions = payload["stream_options"];
  const existingStreamOptions: ProxyObject = isProxyObject(rawStreamOptions) ? rawStreamOptions : {};
  if (existingStreamOptions["include_usage"] === true) return false;
  payload["stream_options"] = {
    ...existingStreamOptions,
    include_usage: true,
  };
  return true;
};
