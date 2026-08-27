import { performance } from "node:perf_hooks";
import { Effect, Option, Schema } from "effect";
import { HttpStatus, notFound } from "../../core/errors";
import { effectHandler } from "../../http/effect-handler";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import type { Recipe } from "../models/types";
import { buildInferenceUrl } from "../../http/local-fetch";
import {
  DEFAULT_CHAT_PROVIDER,
  parseProviderModel,
  resolveProviderConfig,
} from "../../services/provider-routing";
import {
  normalizeChatMessageContentParts,
  normalizeToolRequest,
  isProxyObject,
  type ProxyObject,
} from "./content-normalizer";
import {
  normalizeReasoningAndContentInMessage,
  normalizeToolCallsInMessage,
  exposeReasoningAsContentWhenEmpty,
} from "./reasoning";
import { recordNonStreamingInferenceUsage } from "./inference-accounting";
import {
  attachSessionUsage,
  createNonRunningModelWarner,
  ensureStreamingUsageIncluded,
  extractSessionId,
  findRecipeByModel,
  type OpenAIUsage,
} from "./chat-request";
import { buildChatCompletionsStreamResponse } from "./chat-completions-stream";

interface FailureResult<Error> {
  ok: false;
  error: Error;
}
interface SuccessResult<Value> {
  ok: true;
  value: Value;
}

export interface ModelNotRunningError {
  error: { message: string; type: "model_not_running"; code: "model_not_running" };
  detail: string;
}

export const modelNotRunningError = (
  activeModel: string | null,
  requestedModel: string | null | undefined,
): ModelNotRunningError => {
  const message = activeModel
    ? `Model ${activeModel} is running; ${requestedModel} is not. Launch it from the frontend before sending requests.`
    : `No model is running. Launch ${requestedModel} from the frontend before sending requests.`;
  return {
    error: { message, type: "model_not_running", code: "model_not_running" },
    detail: message,
  };
};

const stripDeepSeekControlTokens = (text: string): string =>
  text.replaceAll("<｜begin▁of▁sentence｜>", "").replaceAll("<｜end▁of▁sentence｜>", "");

const isDeepSeekV4ControllerRecipe = (recipe: Recipe | null): boolean => {
  if (!recipe) return false;
  return `${recipe.id} ${recipe.name} ${recipe.served_model_name ?? ""}`
    .toLowerCase()
    .includes("deepseek-v4");
};

/**
 * DeepSeek's hosted API has a different reasoning protocol from our local
 * DeepSeek V4 vLLM endpoint. A stale desktop client may send its hosted-only
 * `thinking` field and inject blank `reasoning_content` fields when replaying
 * tool turns. Remove only that incompatible transport residue at the
 * controller boundary, while preserving actual reasoning and reasoning_effort.
 */
export const sanitizeDeepSeekV4ControllerRequest = (
  body: ProxyObject,
  recipe: Recipe | null,
): boolean => {
  if (!isDeepSeekV4ControllerRecipe(recipe)) return false;

  let changed = false;
  if ("thinking" in body) {
    delete body["thinking"];
    changed = true;
  }

  const messages = body["messages"];
  if (!Array.isArray(messages)) return changed;
  for (const message of messages) {
    if (!isProxyObject(message)) continue;
    const record = message;
    if (
      Schema.is(Schema.String)(record["reasoning_content"]) &&
      record["reasoning_content"].trim().length === 0
    ) {
      delete record["reasoning_content"];
      changed = true;
    }
    if (Schema.is(Schema.String)(record["content"])) {
      const cleaned = stripDeepSeekControlTokens(record["content"]);
      if (cleaned !== record["content"]) {
        record["content"] = cleaned;
        changed = true;
      }
    }
  }
  return changed;
};

export const registerOpenAIRoutes = defineRoutes((app, context) => {
  const warnNonRunningModel = createNonRunningModelWarner(context.logger);

  const ChatRequestSchema = Schema.Record(Schema.String, Schema.Unknown);
  interface ParsedChatBody {
    parsed: ProxyObject;
    requestedModel: string | null;
    matchedRecipe: Recipe | null;
    isStreaming: boolean;
    bodyChanged: boolean;
    sessionId: string | null;
  }

  const parseChatBody = (
    bodyBuffer: ArrayBuffer,
    getHeader: (name: string) => string | undefined,
  ): Effect.Effect<ParsedChatBody, unknown> =>
    Effect.gen(function* () {
      const parsed = yield* Effect.try({
        try: (): ProxyObject => {
          const decoded = JSON.parse(new TextDecoder().decode(bodyBuffer));
          Schema.decodeUnknownSync(ChatRequestSchema)(decoded);
          return decoded;
        },
        catch: () => new HttpStatus({ status: 400, detail: "Invalid JSON body" }),
      });
      const sessionId = extractSessionId(parsed, getHeader);
      let requestedModel: string | null = null;
      let matchedRecipe: Recipe | null = null;
      let bodyChanged = false;
      normalizeToolRequest(parsed);
      if (normalizeChatMessageContentParts(parsed)) {
        bodyChanged = true;
      }
      if (Schema.is(Schema.String)(parsed["model"])) {
        requestedModel = parsed["model"];
        matchedRecipe = yield* findRecipeByModel(requestedModel, context);
        if (matchedRecipe) {
          const canonical = matchedRecipe.served_model_name ?? matchedRecipe.id;
          if (canonical && canonical !== requestedModel) {
            parsed["model"] = canonical;
            requestedModel = canonical;
            bodyChanged = true;
          }
        }
      }
      if (sanitizeDeepSeekV4ControllerRequest(parsed, matchedRecipe)) {
        bodyChanged = true;
      }
      if (parsed["functions"] || parsed["tools"] !== undefined) {
        bodyChanged = true;
      }
      const isStreaming = Boolean(parsed["stream"]);
      if (ensureStreamingUsageIncluded(parsed)) {
        bodyChanged = true;
      }
      return { parsed, requestedModel, matchedRecipe, isStreaming, bodyChanged, sessionId };
    });

  interface RequestHeaders {
    [name: string]: string;
  }
  interface ChatUpstream {
    upstreamUrl: string;
    headers: RequestHeaders;
    requestProvider: string;
    providerRouting: ReturnType<typeof resolveProviderConfig>;
    rewroteModel: boolean;
  }

  const resolveChatUpstream = (
    requestedModel: string | null,
    parsed: ProxyObject,
  ): ChatUpstream => {
    const providerModel = requestedModel
      ? parseProviderModel(requestedModel)
      : { provider: DEFAULT_CHAT_PROVIDER, modelId: "" };
    const requestProvider = providerModel.provider;
    const providerRouting =
      requestProvider !== DEFAULT_CHAT_PROVIDER
        ? resolveProviderConfig(requestProvider, {
            providers: context.config.providers,
          })
        : null;
    let rewroteModel = false;
    if (providerRouting && requestedModel) {
      parsed["model"] = providerModel.modelId;
      rewroteModel = true;
    }
    const upstreamUrl =
      providerRouting && requestedModel
        ? `${providerRouting.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`
        : buildInferenceUrl(context, "/v1/chat/completions");
    const inferenceKey = process.env["INFERENCE_API_KEY"] ?? "";
    const headers: RequestHeaders = { "Content-Type": "application/json" };
    if (providerRouting) headers["Authorization"] = `Bearer ${providerRouting.apiKey}`;
    else if (inferenceKey) headers["Authorization"] = `Bearer ${inferenceKey}`;
    return { upstreamUrl, headers, requestProvider, providerRouting, rewroteModel };
  };

  const gateOnRunningModel = (
    matchedRecipe: Recipe,
    requestedModel: string | null,
    sourceHeader: string | null,
  ): Effect.Effect<ModelNotRunningError | null, unknown> =>
    context.bridge.findInferenceProcess().pipe(
      Effect.map((current) => {
        const matches =
          current && isRecipeRunning(matchedRecipe, current, { allowEitherPathContains: true });
        if (matches) return null;
        const activeModel = current?.served_model_name ?? current?.model_path ?? null;
        warnNonRunningModel({
          requestedModel,
          requestedRecipeId: matchedRecipe.id,
          activeModel,
          source: sourceHeader,
        });
        return modelNotRunningError(activeModel, requestedModel);
      }),
    );

  const OpenAIUsageSchema = Schema.Struct({
    prompt_tokens: Schema.optional(Schema.Number),
    completion_tokens: Schema.optional(Schema.Number),
    reasoning_tokens: Schema.optional(Schema.Number),
    completion_tokens_details: Schema.optional(
      Schema.Struct({ reasoning_tokens: Schema.optional(Schema.Number) }),
    ),
  });

  const normalizeCompletionChoices = (
    result: ProxyObject,
    recordedModel: string,
    sourceHeader: string | null,
  ): void => {
    const choices = result["choices"];
    if (!Array.isArray(choices)) return;
    for (const choice of choices) {
      if (!isProxyObject(choice)) continue;
      const choiceRecord = choice;
      const message = choiceRecord["message"];
      if (!isProxyObject(message)) continue;
      if (normalizeToolCallsInMessage(message)) choiceRecord["finish_reason"] = "tool_calls";
      normalizeReasoningAndContentInMessage(message);
      if (exposeReasoningAsContentWhenEmpty(message, recordedModel)) {
        context.logger.warn(
          "Exposed Trinity reasoning as content because visible content was empty",
          {
            model: recordedModel,
            source: sourceHeader,
          },
        );
      }
    }
  };

  const getSourceHeader = (getHeader: (name: string) => string | undefined): string | null =>
    getHeader("x-vllm-source") ?? getHeader("x-source") ?? getHeader("user-agent") ?? null;

  const handleNonStreaming = (
    upstreamUrl: string,
    headers: RequestHeaders,
    body: ArrayBuffer,
    clientSignal: AbortSignal,
    recordedModel: string,
    sourceHeader: string | null,
    sessionId: string | null,
    recordedProvider: string,
    requestStart: number,
  ): Effect.Effect<Response, unknown> =>
    Effect.gen(function* () {
      const fetched = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(upstreamUrl, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.any([clientSignal, signal]),
          }),
        catch: (source) => source,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false, error }) satisfies FailureResult<typeof error>,
          onSuccess: (value) => ({ ok: true, value }) satisfies SuccessResult<typeof value>,
        }),
      );
      if (!fetched.ok) {
        return clientSignal.aborted
          ? new Response(null, { status: 499 })
          : yield* Effect.fail(fetched.error);
      }
      const response = fetched.value;
      const decoded = yield* Effect.tryPromise({
        try: async () => {
          const value: ProxyObject = JSON.parse(await response.text());
          Schema.decodeUnknownSync(ChatRequestSchema)(value);
          return value;
        },
        catch: (source) => source,
      }).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false, error }) satisfies FailureResult<typeof error>,
          onSuccess: (value) => ({ ok: true, value }) satisfies SuccessResult<typeof value>,
        }),
      );
      if (!decoded.ok) {
        if (clientSignal.aborted) return new Response(null, { status: 499 });
        return new Response(null, { status: response.status });
      }
      const result = { ...decoded.value };

      const decodedUsage = Schema.decodeUnknownOption(OpenAIUsageSchema)(result["usage"]).pipe(
        Option.getOrUndefined,
      );
      let usage: OpenAIUsage | undefined;
      if (decodedUsage) {
        usage = {};
        if (decodedUsage.prompt_tokens !== undefined)
          usage.prompt_tokens = decodedUsage.prompt_tokens;
        if (decodedUsage.completion_tokens !== undefined)
          usage.completion_tokens = decodedUsage.completion_tokens;
        if (decodedUsage.reasoning_tokens !== undefined)
          usage.reasoning_tokens = decodedUsage.reasoning_tokens;
        if (decodedUsage.completion_tokens_details?.reasoning_tokens !== undefined) {
          usage.completion_tokens_details = {
            reasoning_tokens: decodedUsage.completion_tokens_details.reasoning_tokens,
          };
        }
      }
      yield* recordNonStreamingInferenceUsage(
        { logger: context.logger, stores: context.stores },
        {
          usage,
          record: {
            model: recordedModel,
            source: sourceHeader,
            session_id: sessionId,
            provider: recordedProvider,
            duration_ms: Math.round(performance.now() - requestStart),
            status: response.status,
          },
        },
      );

      attachSessionUsage(result, sessionId, usage);
      normalizeCompletionChoices(result, recordedModel, sourceHeader);

      return Response.json(result, { status: response.status });
    });

  return mergeRoutes(
    app.post(
      "/v1/chat/completions",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const bodyRead = yield* Effect.tryPromise({
            try: () => ctx.req.arrayBuffer(),
            catch: () => new HttpStatus({ status: 400, detail: "Invalid request body" }),
          }).pipe(
            Effect.match({
              onFailure: (error) => ({ ok: false, error }) satisfies FailureResult<typeof error>,
              onSuccess: (value) => ({ ok: true, value }) satisfies SuccessResult<typeof value>,
            }),
          );
          if (!bodyRead.ok) {
            return ctx.req.raw.signal.aborted
              ? new Response(null, { status: 499 })
              : yield* Effect.fail(bodyRead.error);
          }
          const bodyBuffer = bodyRead.value;
          const { parsed, requestedModel, matchedRecipe, isStreaming, bodyChanged, sessionId } =
            yield* parseChatBody(bodyBuffer, (name) => ctx.req.header(name));
          const { upstreamUrl, headers, requestProvider, providerRouting, rewroteModel } =
            resolveChatUpstream(requestedModel, parsed);
          const sourceHeader = getSourceHeader((name) => ctx.req.header(name));

          if (
            !matchedRecipe &&
            requestProvider === DEFAULT_CHAT_PROVIDER &&
            requestedModel &&
            context.config.strict_openai_models
          ) {
            return yield* Effect.fail(notFound(`Model not managed: ${requestedModel}`));
          }

          if (matchedRecipe) {
            const rejection = yield* gateOnRunningModel(
              matchedRecipe,
              requestedModel,
              sourceHeader,
            );
            if (rejection) return ctx.json(rejection, { status: 503 });
          }

          const finalBody =
            bodyChanged || rewroteModel
              ? new TextEncoder().encode(JSON.stringify(parsed)).buffer
              : bodyBuffer;

          const clientSignal = ctx.req.raw.signal;
          const requestStart = performance.now();
          const recordedModel =
            matchedRecipe?.served_model_name ?? matchedRecipe?.id ?? requestedModel ?? "unknown";
          const recordedProvider = providerRouting ? requestProvider : "local";

          if (!isStreaming) {
            return yield* handleNonStreaming(
              upstreamUrl,
              headers,
              finalBody,
              clientSignal,
              recordedModel,
              sourceHeader,
              sessionId,
              recordedProvider,
              requestStart,
            );
          }

          return buildChatCompletionsStreamResponse({
            upstreamUrl,
            headers,
            body: finalBody,
            clientSignal,
            matchedRecipe,
            sourceHeader,
            sessionId,
            recordedModel,
            recordedProvider,
            requestStart,
            requestProvider,
            providerRouting,
            context,
          });
        }),
      ),
    ),
  );
});
