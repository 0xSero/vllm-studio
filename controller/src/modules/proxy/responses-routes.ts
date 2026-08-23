import { performance } from "node:perf_hooks";
import { Effect, Schema } from "effect";
import { badRequest, conflict, serviceUnavailable } from "../../core/errors";
import { defineRoutes, effectRoute } from "../../http/route-registrar";
import { parseProviderModel } from "../../services/provider-routing";
import {
  recordNonStreamingInferenceUsage,
  recordStreamingInferenceUsage,
} from "./inference-accounting";
import { extractSessionId, findRecipeByModel, resolveUpstreamForModel } from "./chat-request";

const ResponsesBodySchema = Schema.Record(Schema.String, Schema.Unknown);

type ResponsesUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
};

const usageFromResponse = (response: Record<string, unknown>): ResponsesUsage | undefined => {
  const raw = response["usage"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const usage = raw as Record<string, unknown>;
  const inputDetails = usage["input_tokens_details"];
  const outputDetails = usage["output_tokens_details"];
  return {
    prompt_tokens: typeof usage["input_tokens"] === "number" ? usage["input_tokens"] : 0,
    completion_tokens: typeof usage["output_tokens"] === "number" ? usage["output_tokens"] : 0,
    cache_read_tokens:
      inputDetails && typeof inputDetails === "object" && !Array.isArray(inputDetails)
        ? Number((inputDetails as Record<string, unknown>)["cached_tokens"] ?? 0)
        : 0,
    reasoning_tokens:
      outputDetails && typeof outputDetails === "object" && !Array.isArray(outputDetails)
        ? Number((outputDetails as Record<string, unknown>)["reasoning_tokens"] ?? 0)
        : 0,
  };
};

export const registerResponsesRoutes = defineRoutes((app, context) =>
  effectRoute(app.post, "/v1/responses", (ctx) =>
    Effect.gen(function* () {
      const requestStart = performance.now();
      const payload = yield* Effect.tryPromise({
        try: () => ctx.req.json(),
        catch: () => badRequest("Invalid Responses request body"),
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ResponsesBodySchema)),
        Effect.mapError(() => badRequest("Invalid Responses request body")),
      );
      const requestedModel = typeof payload["model"] === "string" ? payload["model"] : "";
      if (!requestedModel.trim()) {
        return yield* Effect.fail(badRequest("Responses request requires a model"));
      }
      const parsed = parseProviderModel(requestedModel);
      const source = ctx.req.header("x-source") ?? ctx.req.header("user-agent") ?? "responses-api";
      const sessionId = extractSessionId(payload, (name) => ctx.req.header(name));
      const streamed = payload["stream"] === true;

      if (context.headProviders.has(parsed.provider) && context.config.controller_mode !== "head") {
        return yield* Effect.fail(
          conflict("Cloud provider models are available through a Head controller"),
        );
      }

      if (context.headProviders.supports(parsed.provider, "openai-responses")) {
        const result = yield* Effect.tryPromise({
          try: () =>
            context.headProviders.responses(
              parsed.provider,
              parsed.modelId,
              payload,
              ctx.req.raw.signal,
            ),
          catch: () => serviceUnavailable(`${parsed.provider} request failed`),
        });
        if (streamed) {
          yield* Effect.forkDetach(
            Effect.tryPromise({
              try: () => result.completion,
              catch: (source) => source,
            }).pipe(
              Effect.flatMap((completion) => {
                if (!completion) return Effect.void;
                const usage = usageFromResponse(completion.response);
                if (!usage) return Effect.void;
                return recordStreamingInferenceUsage(
                  { logger: context.logger, stores: context.stores },
                  {
                    usage,
                    record: {
                      model: parsed.modelId,
                      provider: parsed.provider,
                      source,
                      session_id: sessionId,
                      duration_ms: Math.round(performance.now() - requestStart),
                      status: completion.status,
                    },
                  },
                );
              }),
              Effect.catch((error) =>
                Effect.sync(() =>
                  context.logger.warn("Failed to record subscription response usage", {
                    error: String(error),
                  }),
                ),
              ),
            ),
          );
          return result.response;
        }
        const completion = yield* Effect.tryPromise({
          try: () => result.completion,
          catch: () => null,
        });
        const usage = completion ? usageFromResponse(completion.response) : undefined;
        yield* recordNonStreamingInferenceUsage(
          { logger: context.logger, stores: context.stores },
          {
            usage,
            record: {
              model: parsed.modelId,
              provider: parsed.provider,
              source,
              session_id: sessionId,
              duration_ms: Math.round(performance.now() - requestStart),
              status: completion?.status ?? result.response.status,
            },
          },
        );
        return result.response;
      }

      if (context.headProviders.has(parsed.provider)) {
        return yield* Effect.fail(
          badRequest(`${parsed.provider} models use the Chat Completions API`),
        );
      }

      const upstreamPayload = { ...payload };
      const { upstreamUrl, auth, providerRouted } = resolveUpstreamForModel(
        requestedModel,
        upstreamPayload,
        "/v1/responses",
        context,
      );
      if (!providerRouted) {
        const recipe = yield* findRecipeByModel(requestedModel, context);
        if (recipe?.served_model_name) upstreamPayload["model"] = recipe.served_model_name;
      }
      return yield* Effect.tryPromise({
        try: () =>
          fetch(upstreamUrl, {
            method: "POST",
            headers: {
              ...auth,
              "Content-Type": "application/json",
              Accept: streamed ? "text/event-stream" : "application/json",
            },
            body: JSON.stringify(upstreamPayload),
            signal: ctx.req.raw.signal,
          }),
        catch: () => serviceUnavailable("Responses upstream request failed"),
      });
    }),
  ),
);
