import { Effect } from "effect";
import type { Context } from "hono";
import { HttpStatus } from "../../core/errors";
import { buildSseHeaders } from "../../http/sse";
import { defineRoutes, effectRoute, mergeRoutes } from "../../http/route-registrar";
import type { ControllerEffect, ControllerEnvironment } from "../../http/effect-handler";
import { findRecipeByModel, resolveUpstreamForModel } from "./chat-request";

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
type PassthroughPath = "/v1/messages";

/** Client protocol headers each dialect expects the upstream to see. */
const FORWARDED_HEADERS = ["anthropic-version", "anthropic-beta", "openai-beta"] as const;

export const registerPassthroughRoutes = defineRoutes((app, context) => {
  const resolveUpstream = (
    path: PassthroughPath,
    requestedModel: string | null,
    parsed: Record<string, unknown>,
  ): Effect.Effect<{ upstreamUrl: string; auth: Record<string, string> }, unknown> => {
    const { upstreamUrl, auth, providerRouted } = resolveUpstreamForModel(
      requestedModel,
      parsed,
      path,
      context,
      { includeXApiKey: true },
    );
    if (providerRouted || !requestedModel) {
      return Effect.succeed({ upstreamUrl, auth });
    }
    return findRecipeByModel(requestedModel, context).pipe(
      Effect.map((recipe) => {
        if (recipe?.served_model_name) parsed["model"] = recipe.served_model_name;
        return { upstreamUrl, auth };
      }),
    );
  };

  const forward =
    (path: PassthroughPath) =>
    (ctx: Context<ControllerEnvironment>): ControllerEffect<Response, unknown> =>
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
      });

  return mergeRoutes(effectRoute(app.post, "/v1/messages", forward("/v1/messages")));
});
