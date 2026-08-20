import { Effect } from "effect";
import { HttpStatus } from "../../core/errors";
import { buildInferenceUrl } from "../../http/local-fetch";
import { buildSseHeaders } from "../../http/sse";
import { defineRoutes, documentRoute, mergeRoutes } from "../../http/route-registrar";
import { effectHandler } from "../../http/effect-handler";
import {
  DEFAULT_CHAT_PROVIDER,
  parseProviderModel,
  resolveProviderConfig,
} from "../../services/provider-routing";
import { findRecipeByModel } from "./chat-request";

/**
 * Pass-through for the OpenAI Responses API and the Anthropic Messages API.
 *
 * The engines this controller launches already speak these dialects — vLLM and
 * SGLang serve /v1/responses and /v1/messages beside /v1/chat/completions — so
 * the controller's job here is routing and auth, not translation. The body is
 * forwarded verbatim except for the model field, which is resolved the same
 * two ways as chat: a "provider/model" id routes to that configured provider
 * with its key, and anything else is canonicalized against the recipe store so
 * aliases reach the engine under its served model name. Streams pass through
 * byte-for-byte; each dialect frames its own protocol and heartbeats.
 */
const PASSTHROUGH_PATHS = ["/v1/responses", "/v1/messages"] as const;
type PassthroughPath = (typeof PASSTHROUGH_PATHS)[number];

/** Client protocol headers each dialect expects the upstream to see. */
const FORWARDED_HEADERS = ["anthropic-version", "anthropic-beta", "openai-beta"] as const;

export const registerPassthroughRoutes = defineRoutes((app, context) => {
  const resolveUpstream = (
    path: PassthroughPath,
    requestedModel: string | null,
    parsed: Record<string, unknown>,
  ): Effect.Effect<{ upstreamUrl: string; auth: Record<string, string> }, unknown> => {
    const providerModel = requestedModel
      ? parseProviderModel(requestedModel)
      : { provider: DEFAULT_CHAT_PROVIDER, modelId: "" };
    if (providerModel.provider !== DEFAULT_CHAT_PROVIDER) {
      const providerRouting = resolveProviderConfig(providerModel.provider, {
        providers: context.config.providers,
      });
      if (providerRouting) {
        parsed["model"] = providerModel.modelId;
        return Effect.succeed({
          upstreamUrl: `${providerRouting.baseUrl.replace(/\/+$/, "")}${path}`,
          auth: {
            Authorization: `Bearer ${providerRouting.apiKey}`,
            // The Anthropic dialect authenticates with x-api-key; sending both
            // lets one configured key reach either kind of upstream.
            "x-api-key": providerRouting.apiKey,
          },
        });
      }
    }
    const inferenceKey = process.env["INFERENCE_API_KEY"] ?? "";
    const auth: Record<string, string> = inferenceKey
      ? { Authorization: `Bearer ${inferenceKey}` }
      : {};
    if (!requestedModel) {
      return Effect.succeed({ upstreamUrl: buildInferenceUrl(context, path), auth });
    }
    return findRecipeByModel(requestedModel, context).pipe(
      Effect.map((recipe) => {
        if (recipe?.served_model_name) parsed["model"] = recipe.served_model_name;
        return { upstreamUrl: buildInferenceUrl(context, path), auth };
      }),
    );
  };

  const forward = (path: PassthroughPath) =>
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const parsed = yield* Effect.tryPromise({
          try: () => ctx.req.json<Record<string, unknown>>(),
          catch: () => new HttpStatus({ status: 400, detail: "Invalid JSON request body" }),
        });
        const requestedModel = typeof parsed["model"] === "string" ? parsed["model"] : null;
        const { upstreamUrl, auth } = yield* resolveUpstream(path, requestedModel, parsed);

        const headers: Record<string, string> = { "Content-Type": "application/json", ...auth };
        for (const name of FORWARDED_HEADERS) {
          const value = ctx.req.header(name);
          if (value) headers[name] = value;
        }

        const clientSignal = ctx.req.raw.signal;
        const fetched = yield* Effect.tryPromise({
          try: (signal) =>
            fetch(upstreamUrl, {
              method: "POST",
              headers,
              body: JSON.stringify(parsed),
              signal: AbortSignal.any([clientSignal, signal]),
            }),
          catch: () =>
            new HttpStatus({
              status: 503,
              detail: `The inference engine did not answer ${path}. It may still be starting, or this engine may not serve this API.`,
            }),
        });
        if (clientSignal.aborted) return new Response(null, { status: 499 });

        const contentType = fetched.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream") && fetched.body) {
          return new Response(fetched.body, {
            status: fetched.status,
            headers: buildSseHeaders(),
          });
        }
        const body = yield* Effect.tryPromise({
          try: () => fetched.arrayBuffer(),
          catch: () => new HttpStatus({ status: 502, detail: "Upstream response unreadable" }),
        });
        return new Response(body, {
          status: fetched.status,
          headers: { "Content-Type": contentType || "application/json" },
        });
      }),
    );

  return mergeRoutes(
    app.post("/v1/responses", documentRoute, forward("/v1/responses")),
    app.post("/v1/messages", documentRoute, forward("/v1/messages")),
  );
});
