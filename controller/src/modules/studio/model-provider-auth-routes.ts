import { Effect, Schema } from "effect";
import { badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { defineRoutes, effectRoute, mergeRoutes } from "../../http/route-registrar";

const LoginStartSchema = Schema.Struct({ type: Schema.Literals(["oauth", "api_key"]) });
const LoginResponseSchema = Schema.Struct({ promptId: Schema.Number, value: Schema.String });

export const registerModelProviderAuthRoutes = defineRoutes((app, context) =>
  mergeRoutes(
    effectRoute(app.get, "/studio/model-providers", (ctx) =>
      Effect.tryPromise({
        try: () => context.headProviders.list(),
        catch: () => serviceUnavailable("Head model providers are unavailable"),
      }).pipe(Effect.map((providers) => ctx.json({ providers }))),
    ),
    effectRoute(app.post, "/studio/model-providers/:providerId/login", (ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, LoginStartSchema);
        const providerId = ctx.req.param("providerId") ?? "";
        if (!context.headProviders.has(providerId)) {
          return yield* Effect.fail(notFound("Head model provider not found"));
        }
        return ctx.json({ jobId: context.headProviders.startLogin(providerId, body.type) });
      }),
    ),
    effectRoute(app.get, "/studio/model-providers/:providerId/login/:jobId", (ctx) =>
      Effect.gen(function* () {
        const parsedAfter = Number(ctx.req.query("after") ?? "0");
        const after = Number.isFinite(parsedAfter) ? parsedAfter : 0;
        const job = context.headProviders.loginJob(
          ctx.req.param("providerId") ?? "",
          ctx.req.param("jobId") ?? "",
          after,
        );
        if (!job) return yield* Effect.fail(notFound("Model provider login job not found"));
        return ctx.json(job);
      }),
    ),
    effectRoute(
      app.post,
      "/studio/model-providers/:providerId/login/:jobId/respond",
      (ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, LoginResponseSchema);
          if (
            !context.headProviders.respond(
              ctx.req.param("providerId") ?? "",
              ctx.req.param("jobId") ?? "",
              body.promptId,
              body.value,
            )
          ) {
            return yield* Effect.fail(badRequest("No matching model provider login prompt"));
          }
          return ctx.json({ ok: true });
        }),
    ),
    effectRoute(
      app.post,
      "/studio/model-providers/:providerId/login/:jobId/cancel",
      (ctx) =>
        context.headProviders.cancel(
          ctx.req.param("providerId") ?? "",
          ctx.req.param("jobId") ?? "",
        )
          ? Effect.succeed(ctx.json({ ok: true }))
          : Effect.fail(notFound("Model provider login job not found")),
    ),
    effectRoute(app.post, "/studio/model-providers/:providerId/logout", (ctx) =>
      Effect.tryPromise({
        try: () => context.headProviders.logout(ctx.req.param("providerId") ?? ""),
        catch: () => serviceUnavailable("Head model provider is unavailable"),
      }).pipe(Effect.map(() => ctx.json({ ok: true }))),
    ),
  ),
);
