import { performance } from "node:perf_hooks";
import { Effect, Stream } from "effect";
import type { Context } from "hono";
import { HttpStatus, notFound } from "../../core/errors";
import { buildSseHeaders } from "../../http/sse";
import { defineRoutes, effectRoute, mergeRoutes } from "../../http/route-registrar";
import type { ControllerEffect, ControllerEnvironment } from "../../http/effect-handler";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import type { Recipe } from "../models/types";
import { DEFAULT_CHAT_PROVIDER } from "../../services/provider-routing";
import {
  createNonRunningModelWarner,
  ensureStreamingUsageIncluded,
  extractSessionId,
  findRecipeByModel,
  resolveUpstreamForModel,
} from "./chat-request";
import {
  recordNonStreamingInferenceUsage,
  recordStreamingInferenceUsage,
  type InferenceUsageInput,
} from "./inference-accounting";
import {
  createUsageObserver,
  stringFromProxyValue,
  usageFromPayload,
  type ProxyDialect,
  type ProxyPayload,
} from "./usage-observer";

const KEEPALIVE_INTERVAL_MS = 15_000;

interface UpstreamHeaders {
  [key: string]: string;
  "Content-Type": string;
}

interface InferenceRecord {
  model: string;
  provider: string;
  session_id: string | null;
  source: string | null;
}

type ResolvedRequestModel = { matchedRecipe: Recipe | null; requestedModel: string | null };
type PreparedRequest = {
  clientSignal: AbortSignal;
  headers: UpstreamHeaders;
  isStreaming: boolean;
  parsed: ProxyPayload;
  record: InferenceRecord;
  upstreamUrl: string;
};

interface DialectRoute {
  dialect: ProxyDialect;
  path: "/v1/chat/completions" | "/v1/responses" | "/v1/messages";
}

const DIALECTS: readonly DialectRoute[] = [
  { dialect: "chat", path: "/v1/chat/completions" },
  { dialect: "responses", path: "/v1/responses" },
  { dialect: "messages", path: "/v1/messages" },
];

const FORWARDED_HEADERS = ["anthropic-version", "anthropic-beta", "openai-beta"];

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

const errorFrame = (message: string): Uint8Array =>
  new TextEncoder().encode(
    `data: ${JSON.stringify({ error: { message, type: "upstream_error" } })}\n\n`,
  );

export const registerPassthroughRoutes = defineRoutes((app, context) => {
  const warnNonRunningModel = createNonRunningModelWarner(context.logger);

  const gateOnRunningModel = (
    matchedRecipe: Recipe,
    requestedModel: string | null,
    sourceHeader: string | null,
  ): Effect.Effect<ModelNotRunningError | null, unknown> =>
    context.compute.model.findInferenceProcess().pipe(
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

  const streamedResponse = (input: {
    dialect: ProxyDialect;
    upstream: Response;
    body: ReadableStream<Uint8Array>;
    clientSignal: AbortSignal;
    record: InferenceRecord;
    requestStart: number;
  }): Response => {
    const merged: InferenceUsageInput = {};
    let sawUsage = false;
    let ttftMs: number | null = null;
    const observed = input.body.pipeThrough(
      createUsageObserver(input.dialect, {
        onUsage: (usage) => {
          sawUsage = true;
          Object.assign(merged, usage);
        },
        onFirstFrame: () => {
          ttftMs ??= Math.max(0, Math.round(performance.now() - input.requestStart));
        },
      }),
    );
    const upstream = Stream.fromReadableStream({
      evaluate: () => observed,
      onError: (source) => source,
    }).pipe(
      Stream.catchCause((cause) => {
        if (!input.clientSignal.aborted) {
          context.logger.error("Passthrough stream failed", { error: String(cause) });
        }
        return Stream.empty;
      }),
      Stream.ensuring(
        Effect.suspend(() =>
          sawUsage
            ? recordStreamingInferenceUsage(
                { logger: context.logger, stores: context.stores },
                {
                  usage: merged,
                  record: {
                    ...input.record,
                    ttft_ms: ttftMs,
                    duration_ms: Math.round(performance.now() - input.requestStart),
                    status: input.upstream.status,
                  },
                },
              ).pipe(
                Effect.catch((error) =>
                  Effect.sync(() =>
                    context.logger.warn("Streaming accounting failed", { error: String(error) }),
                  ),
                ),
              )
            : Effect.void,
        ),
      ),
    );
    // Chat clients idle through long generations behind proxies that time out
    // silent connections; SSE comment keepalives are protocol-invisible. The
    // other dialects heartbeat themselves (Messages sends ping events).
    const keepalive = new TextEncoder().encode(": keepalive\n\n");
    const heartbeat = Stream.concat(
      Stream.succeed(keepalive),
      Stream.tick(KEEPALIVE_INTERVAL_MS).pipe(Stream.map(() => keepalive)),
    );
    const stream =
      input.dialect === "chat"
        ? Stream.merge(upstream, heartbeat, { haltStrategy: "left" })
        : upstream;
    return new Response(Stream.toReadableStream(stream), {
      status: input.upstream.status,
      headers: buildSseHeaders(),
    });
  };

  const readRequestBody = (
    ctx: Context<ControllerEnvironment>,
  ): ControllerEffect<ProxyPayload | Response, unknown> =>
    Effect.gen(function* () {
      const clientSignal = ctx.req.raw.signal;
      const bodyRead = yield* Effect.tryPromise({
        try: () => ctx.req.json<ProxyPayload>(),
        catch: () => new HttpStatus({ status: 400, detail: "Invalid JSON request body" }),
      }).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (value) => ({ ok: true as const, value }),
        }),
      );
      if (bodyRead.ok) return bodyRead.value;
      return clientSignal.aborted
        ? new Response(null, { status: 499 })
        : yield* Effect.fail(bodyRead.error);
    });

  const resolveRequestModel = (
    parsed: ProxyPayload,
  ): ControllerEffect<ResolvedRequestModel, unknown> =>
    Effect.gen(function* () {
      let requestedModel = stringFromProxyValue(parsed.model);
      let matchedRecipe: Recipe | null = null;
      if (requestedModel) {
        matchedRecipe = yield* findRecipeByModel(requestedModel, context);
        const canonical = matchedRecipe?.served_model_name ?? matchedRecipe?.id;
        if (canonical && canonical !== requestedModel) {
          parsed.model = canonical;
          requestedModel = canonical;
        }
      }
      return { matchedRecipe, requestedModel };
    });

  const validateRequestedModel = (
    ctx: Context<ControllerEnvironment>,
    matchedRecipe: Recipe | null,
    requestedModel: string | null,
    requestProvider: string,
    sourceHeader: string | null,
  ): ControllerEffect<Response | null, unknown> =>
    Effect.gen(function* () {
      if (
        !matchedRecipe &&
        requestProvider === DEFAULT_CHAT_PROVIDER &&
        requestedModel &&
        context.config.strict_openai_models
      ) {
        return yield* Effect.fail(notFound(`Model not managed: ${requestedModel}`));
      }
      if (!matchedRecipe) return null;
      const rejection = yield* gateOnRunningModel(matchedRecipe, requestedModel, sourceHeader);
      return rejection ? ctx.json(rejection, { status: 503 }) : null;
    });

  const prepareRequest = (
    ctx: Context<ControllerEnvironment>,
    dialect: ProxyDialect,
    path: DialectRoute["path"],
  ): ControllerEffect<PreparedRequest | Response, unknown> =>
    Effect.gen(function* () {
      const body = yield* readRequestBody(ctx);
      if (body instanceof Response) return body;
      const parsed: ProxyPayload = { ...body };
      const clientSignal = ctx.req.raw.signal;
      const sessionId = extractSessionId(parsed, (name) => ctx.req.header(name));
      const sourceHeader =
        ctx.req.header("x-vllm-source") ??
        ctx.req.header("x-source") ??
        ctx.req.header("user-agent") ??
        null;
      const { matchedRecipe, requestedModel } = yield* resolveRequestModel(parsed);
      const { upstreamUrl, auth, requestProvider, providerRouting } = resolveUpstreamForModel(
        requestedModel,
        parsed,
        path,
        context,
        { includeXApiKey: true },
      );
      const rejection = yield* validateRequestedModel(
        ctx,
        matchedRecipe,
        requestedModel,
        requestProvider,
        sourceHeader,
      );
      if (rejection) return rejection;
      if (dialect === "chat") ensureStreamingUsageIncluded(parsed);

      const headers: UpstreamHeaders = { "Content-Type": "application/json", ...auth };
      for (const name of FORWARDED_HEADERS) {
        const value = ctx.req.header(name);
        if (value) headers[name] = value;
      }
      return {
        clientSignal,
        headers,
        isStreaming: Boolean(parsed.stream),
        parsed,
        record: {
          model:
            matchedRecipe?.served_model_name ?? matchedRecipe?.id ?? requestedModel ?? "unknown",
          provider: providerRouting ? requestProvider : "local",
          session_id: sessionId,
          source: sourceHeader,
        },
        upstreamUrl,
      };
    });

  const readNonStreamingResponse = (
    dialect: ProxyDialect,
    upstream: Response,
    record: InferenceRecord,
    requestStart: number,
  ): ControllerEffect<Response, unknown> =>
    Effect.gen(function* () {
      const contentType = upstream.headers.get("content-type") ?? "";
      const body = yield* Effect.tryPromise({
        try: () => upstream.arrayBuffer(),
        catch: () => new HttpStatus({ status: 502, detail: "Upstream response unreadable" }),
      });
      yield* Effect.try({
        try: () => Object(JSON.parse(new TextDecoder().decode(body))),
        catch: () => null,
      }).pipe(
        Effect.flatMap((payload) => {
          const usage = payload ? usageFromPayload(dialect, payload) : null;
          return recordNonStreamingInferenceUsage(
            { logger: context.logger, stores: context.stores },
            {
              usage: usage ?? undefined,
              record: {
                ...record,
                duration_ms: Math.round(performance.now() - requestStart),
                status: upstream.status,
              },
            },
          );
        }),
        Effect.catch(() => Effect.succeed(null)),
      );
      return new Response(body, {
        status: upstream.status,
        headers: { "Content-Type": contentType || "application/json" },
      });
    });

  const forward =
    ({ dialect, path }: DialectRoute) =>
    (ctx: Context<ControllerEnvironment>): ControllerEffect<Response, unknown> =>
      Effect.gen(function* () {
        const prepared = yield* prepareRequest(ctx, dialect, path);
        if (prepared instanceof Response) return prepared;
        const requestStart = performance.now();
        const fetched = yield* Effect.tryPromise({
          try: (signal) =>
            fetch(prepared.upstreamUrl, {
              method: "POST",
              headers: prepared.headers,
              body: JSON.stringify(prepared.parsed),
              signal: AbortSignal.any([prepared.clientSignal, signal]),
            }),
          catch: () =>
            new HttpStatus({
              status: 503,
              detail: `The inference engine did not answer ${path}. It may still be starting, or this engine may not serve this API.`,
            }),
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (value) => ({ ok: true as const, value }),
          }),
        );
        if (prepared.clientSignal.aborted) return new Response(null, { status: 499 });
        if (!fetched.ok) {
          if (dialect === "chat" && prepared.isStreaming) {
            return new Response(errorFrame("Inference backend unavailable").slice().buffer, {
              headers: buildSseHeaders(),
            });
          }
          return yield* Effect.fail(fetched.error);
        }
        const upstream = fetched.value;
        const contentType = upstream.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream") && upstream.body) {
          return streamedResponse({
            dialect,
            upstream,
            body: upstream.body,
            clientSignal: prepared.clientSignal,
            record: prepared.record,
            requestStart,
          });
        }
        return yield* readNonStreamingResponse(dialect, upstream, prepared.record, requestStart);
      });

  const [chat, responses, messages] = DIALECTS;
  return mergeRoutes(
    effectRoute(app.post, chat!.path, forward(chat!)),
    effectRoute(app.post, responses!.path, forward(responses!)),
    effectRoute(app.post, messages!.path, forward(messages!)),
  );
});
