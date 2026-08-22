import { Effect, Schema } from "effect";
import { badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { defineRoutes, effectRoute, mergeRoutes } from "../../http/route-registrar";

const LoginResponseSchema = Schema.Struct({ promptId: Schema.Number, value: Schema.String });

export const registerCodexProviderRoutes = defineRoutes((app, context) =>
  mergeRoutes(
    effectRoute(app.get, "/studio/providers/openai-codex/status", (ctx) =>
      Effect.tryPromise({
        try: () => context.codexProvider.view(),
        catch: () => serviceUnavailable("OpenAI Codex provider is unavailable"),
      }).pipe(Effect.map((provider) => ctx.json({ provider }))),
    ),
    effectRoute(app.post, "/studio/providers/openai-codex/login", (ctx) =>
      Effect.sync(() => ctx.json({ jobId: context.codexProvider.startLogin() })),
    ),
    effectRoute(app.get, "/studio/providers/openai-codex/login/:jobId", (ctx) =>
      Effect.gen(function* () {
        const parsedAfter = Number(ctx.req.query("after") ?? "0");
        const after = Number.isFinite(parsedAfter) ? parsedAfter : 0;
        const job = context.codexProvider.loginJob(ctx.req.param("jobId") ?? "", after);
        if (!job) return yield* Effect.fail(notFound("OpenAI Codex login job not found"));
        return ctx.json(job);
      }),
    ),
    effectRoute(app.post, "/studio/providers/openai-codex/login/:jobId/respond", (ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, LoginResponseSchema);
        if (
          !context.codexProvider.respond(ctx.req.param("jobId") ?? "", body.promptId, body.value)
        ) {
          return yield* Effect.fail(badRequest("No matching OpenAI Codex login prompt"));
        }
        return ctx.json({ ok: true });
      }),
    ),
    effectRoute(app.post, "/studio/providers/openai-codex/login/:jobId/cancel", (ctx) =>
      context.codexProvider.cancel(ctx.req.param("jobId") ?? "")
        ? Effect.succeed(ctx.json({ ok: true }))
        : Effect.fail(notFound("OpenAI Codex login job not found")),
    ),
    effectRoute(app.post, "/studio/providers/openai-codex/logout", (ctx) =>
      Effect.tryPromise({
        try: () => context.codexProvider.logout(),
        catch: () => serviceUnavailable("OpenAI Codex provider is unavailable"),
      }).pipe(Effect.map(() => ctx.json({ ok: true }))),
    ),
  ),
);
