import { performance } from "node:perf_hooks";
import {
  SessionMetadataSchema,
  WORKER_TARGET_HEADER,
  type WorkerModel,
  type WorkersPayload,
} from "@local-studio/contracts/federation";
import { Effect, Schema, Stream } from "effect";
import { HttpStatus } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { buildSseHeaders } from "../../http/sse";
import { defineRoutes, effectRoute, mergeRoutes } from "../../http/route-registrar";
import { extractSessionId } from "../proxy/chat-request";
import {
  type InferenceUsageInput,
  recordNonStreamingInferenceUsage,
  recordStreamingInferenceUsage,
} from "../proxy/inference-accounting";
import { modelNotRunningError } from "../proxy/openai-routes";
import type { WorkerTarget } from "./worker-pool";
import { listProviderModelsCached } from "../../services/provider-routing";
import type { AppContext } from "../../app-context";

const ChatRequestSchema = Schema.Record(Schema.String, Schema.Unknown);

const workerHeaders = (response: Response, workerId: string): Headers => {
  const headers = new Headers(response.headers);
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set(WORKER_TARGET_HEADER, workerId);
  return headers;
};

const aggregateModels = (statuses: WorkersPayload["workers"]): WorkerModel[] => {
  const models = new Map<string, WorkerModel>();
  for (const status of statuses) {
    if (!status.healthy) continue;
    for (const candidate of status.models) {
      const existing = models.get(candidate.id);
      if (!existing) {
        models.set(candidate.id, { ...candidate });
        continue;
      }
      models.set(candidate.id, {
        ...existing,
        active: existing.active === true || candidate.active === true,
        max_model_len: Math.max(existing.max_model_len ?? 0, candidate.max_model_len ?? 0) || null,
      });
    }
  }
  return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
};

const aggregateHeadModels = (
  context: AppContext,
  statuses: WorkersPayload["workers"],
): Effect.Effect<WorkerModel[]> =>
  Effect.gen(function* () {
    const models = new Map(aggregateModels(statuses).map((model) => [model.id, model]));
    const providerCatalogs = yield* listProviderModelsCached(context.config.providers);
    for (const catalog of providerCatalogs) {
      for (const model of catalog.models) {
        const id = `${catalog.provider}/${model.id}`;
        models.set(id, {
          id,
          object: "model",
          owned_by: catalog.provider,
          active: true,
          metadata: {
            external: true,
            provider: catalog.provider,
          },
        });
      }
    }
    const headProviderCatalogs = yield* Effect.tryPromise({
      try: () => context.headProviders.catalogs(),
      catch: () => [] as const,
    }).pipe(Effect.catch(() => Effect.succeed([] as const)));
    for (const catalog of headProviderCatalogs) {
      for (const model of catalog.models) {
        const id = `${catalog.providerId}/${model.id}`;
        models.set(id, {
          id,
          object: "model",
          owned_by: catalog.providerId,
          active: true,
          max_model_len: model.contextWindow,
          metadata: {
            provider: catalog.providerId,
            upstream_model_id: model.id,
            api: "openai-responses",
            context_window: model.contextWindow,
            max_tokens: model.maxTokens,
            reasoning: model.reasoning,
            vision: model.vision,
            input: model.vision ? ["text", "image"] : ["text"],
          },
        });
      }
    }
    return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
  });

const readUsageFrame = (frame: string): InferenceUsageInput | null => {
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const usage = parsed["usage"];
      if (usage && typeof usage === "object" && !Array.isArray(usage)) {
        return usage as InferenceUsageInput;
      }
    } catch {}
  }
  return null;
};

export const registerFederationRoutes = defineRoutes((app, context) => {
  const recordEmpty = (input: {
    model: string;
    source: string | null;
    sessionId: string | null;
    workerId: string;
    durationMs: number;
    status: number;
    streamed: boolean;
  }): Effect.Effect<void> =>
    context.stores.inferenceRequestStore
      .record({
        model: input.model,
        source: input.source,
        session_id: input.sessionId,
        provider: "worker",
        worker_id: input.workerId,
        prompt_tokens: 0,
        completion_tokens: 0,
        duration_ms: input.durationMs,
        status: input.status,
        streamed: input.streamed,
      })
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            context.logger.warn("Head inference accounting failed", { error: String(error) }),
          ),
        ),
      );

  const streamResponse = (input: {
    response: Response;
    worker: WorkerTarget;
    model: string;
    source: string | null;
    sessionId: string | null;
    requestStart: number;
  }): Response => {
    const body = input.response.body;
    if (!body) {
      context.workerPool.release(input.worker.id);
      return new Response(null, {
        status: input.response.status,
        headers: workerHeaders(input.response, input.worker.id),
      });
    }
    const decoder = new TextDecoder();
    let pending = "";
    let usage: InferenceUsageInput | null = null;
    let ttftMs: number | null = null;
    const source = Stream.fromReadableStream({ evaluate: () => body, onError: () => null }).pipe(
      Stream.tap((chunk) =>
        Effect.sync(() => {
          ttftMs ??= Math.max(0, Math.round(performance.now() - input.requestStart));
          pending += decoder.decode(chunk, { stream: true });
          const frames = pending.split("\n\n");
          pending = frames.pop() ?? "";
          for (const frame of frames) usage = readUsageFrame(frame) ?? usage;
        }),
      ),
      Stream.ensuring(
        Effect.suspend(() => {
          context.workerPool.release(input.worker.id);
          const durationMs = Math.round(performance.now() - input.requestStart);
          const accounting = usage
            ? recordStreamingInferenceUsage(
                { logger: context.logger, stores: context.stores },
                {
                  usage,
                  record: {
                    model: input.model,
                    source: input.source,
                    session_id: input.sessionId,
                    provider: "worker",
                    worker_id: input.worker.id,
                    ttft_ms: ttftMs,
                    duration_ms: durationMs,
                    status: input.response.status,
                  },
                },
              ).pipe(Effect.asVoid)
            : recordEmpty({
                model: input.model,
                source: input.source,
                sessionId: input.sessionId,
                workerId: input.worker.id,
                durationMs,
                status: input.response.status,
                streamed: true,
              });
          return accounting.pipe(
            Effect.catch((error) =>
              Effect.sync(() =>
                context.logger.warn("Head streaming accounting failed", { error: String(error) }),
              ),
            ),
          );
        }),
      ),
    );
    const headers = workerHeaders(input.response, input.worker.id);
    for (const [name, value] of Object.entries(buildSseHeaders())) headers.set(name, value);
    return new Response(Stream.toReadableStream(source), {
      status: input.response.status,
      headers,
    });
  };

  return mergeRoutes(
    effectRoute(app.get, "/studio/sessions", (ctx) =>
      context.stores.sessionMetadataStore
        .listEffect()
        .pipe(Effect.map((sessions) => ctx.json({ sessions }))),
    ),
    effectRoute(app.put, "/studio/sessions/:sessionId", (ctx) =>
      Effect.gen(function* () {
        const metadata = yield* decodeJsonBody(ctx, SessionMetadataSchema);
        if (metadata.session_id !== ctx.req.param("sessionId")) {
          return yield* Effect.fail(
            new HttpStatus({ status: 400, detail: "Session id does not match route" }),
          );
        }
        yield* context.stores.sessionMetadataStore.saveEffect(metadata);
        return ctx.json({ success: true });
      }),
    ),
    effectRoute(app.get, "/studio/workers", (ctx) =>
      context.workerPool
        .statuses(true)
        .pipe(
          Effect.map((workers) =>
            ctx.json({ mode: context.config.controller_mode, workers } satisfies WorkersPayload),
          ),
        ),
    ),
    effectRoute(app.get, "/v1/models", (ctx) =>
      context.workerPool.statuses().pipe(
        Effect.flatMap((statuses) => aggregateHeadModels(context, statuses)),
        Effect.map((data) => ctx.json({ object: "list", data })),
      ),
    ),
    effectRoute(app.post, "/v1/chat/completions", (ctx) =>
      Effect.gen(function* () {
        const bodyBuffer = yield* Effect.tryPromise({
          try: () => ctx.req.arrayBuffer(),
          catch: () => new HttpStatus({ status: 400, detail: "Invalid request body" }),
        });
        const parsed = yield* Effect.try({
          try: () =>
            Schema.decodeUnknownSync(ChatRequestSchema)(
              JSON.parse(new TextDecoder().decode(bodyBuffer)),
            ),
          catch: () => new HttpStatus({ status: 400, detail: "Invalid JSON body" }),
        });
        const model = typeof parsed["model"] === "string" ? parsed["model"].trim() : "";
        if (!model)
          return yield* Effect.fail(new HttpStatus({ status: 400, detail: "model is required" }));
        const source =
          ctx.req.header("x-vllm-source") ??
          ctx.req.header("x-source") ??
          ctx.req.header("user-agent") ??
          null;
        const sessionId = extractSessionId(parsed, (name) => ctx.req.header(name));
        const worker = yield* context.workerPool.selectServing(model);
        if (!worker) return ctx.json(modelNotRunningError(null, model), { status: 503 });
        const requestStart = performance.now();
        context.workerPool.acquire(worker.id);
        const fetched = yield* context.workerPool
          .fetch(
            worker,
            "/v1/chat/completions",
            {
              method: "POST",
              headers: ctx.req.raw.headers,
              body: bodyBuffer,
              signal: ctx.req.raw.signal,
            },
            300_000,
          )
          .pipe(
            Effect.match({
              onFailure: (left) => ({ _tag: "Left" as const, left }),
              onSuccess: (right) => ({ _tag: "Right" as const, right }),
            }),
          );
        if (fetched._tag === "Left") {
          context.workerPool.release(worker.id);
          const alternate = yield* context.workerPool.selectServing(model, new Set([worker.id]));
          if (!alternate) return ctx.json({ detail: fetched.left.message }, { status: 502 });
          context.workerPool.acquire(alternate.id);
          const retried = yield* context.workerPool
            .fetch(
              alternate,
              "/v1/chat/completions",
              {
                method: "POST",
                headers: ctx.req.raw.headers,
                body: bodyBuffer,
                signal: ctx.req.raw.signal,
              },
              300_000,
            )
            .pipe(
              Effect.match({
                onFailure: (left) => ({ _tag: "Left" as const, left }),
                onSuccess: (right) => ({ _tag: "Right" as const, right }),
              }),
            );
          if (retried._tag === "Left") {
            context.workerPool.release(alternate.id);
            return ctx.json({ detail: retried.left.message }, { status: 502 });
          }
          return Boolean(parsed["stream"])
            ? streamResponse({
                response: retried.right,
                worker: alternate,
                model,
                source,
                sessionId,
                requestStart,
              })
            : yield* finishNonStreaming(
                retried.right,
                alternate,
                model,
                source,
                sessionId,
                requestStart,
              );
        }
        return Boolean(parsed["stream"])
          ? streamResponse({
              response: fetched.right,
              worker,
              model,
              source,
              sessionId,
              requestStart,
            })
          : yield* finishNonStreaming(
              fetched.right,
              worker,
              model,
              source,
              sessionId,
              requestStart,
            );
      }),
    ),
  );

  function finishNonStreaming(
    response: Response,
    worker: WorkerTarget,
    model: string,
    source: string | null,
    sessionId: string | null,
    requestStart: number,
  ): Effect.Effect<Response> {
    return Effect.gen(function* () {
      const body = yield* Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: () => new Error("Worker response could not be read"),
      }).pipe(Effect.orElseSucceed(() => new ArrayBuffer(0)));
      const durationMs = Math.round(performance.now() - requestStart);
      context.workerPool.release(worker.id);
      let usage: InferenceUsageInput | undefined;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
        if (parsed["usage"] && typeof parsed["usage"] === "object")
          usage = parsed["usage"] as InferenceUsageInput;
      } catch {}
      if (usage) {
        yield* recordNonStreamingInferenceUsage(
          { logger: context.logger, stores: context.stores },
          {
            usage,
            record: {
              model,
              source,
              session_id: sessionId,
              provider: "worker",
              worker_id: worker.id,
              duration_ms: durationMs,
              status: response.status,
            },
          },
        ).pipe(Effect.catch(() => Effect.succeed(null)));
      } else {
        yield* recordEmpty({
          model,
          source,
          sessionId,
          workerId: worker.id,
          durationMs,
          status: response.status,
          streamed: false,
        });
      }
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: workerHeaders(response, worker.id),
      });
    });
  }
});
