import type { UsageStats } from "@local-studio/contracts/usage";
import { validateUsageStats } from "@local-studio/contracts/usage-schema";
import { Effect } from "effect";
import {
  InferenceUsageAckSchema,
  InferenceUsageBatchSchema,
} from "@local-studio/contracts/federation";
import { observeControllerFunction } from "../../core/function-observability";
import { conflict } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";
import { emptyResponse } from "./usage/usage-utilities";

const USAGE_CACHE_TTL_MS = 15_000;

const withControllerUsage = (
  context: AppContext,
  body: UsageStats,
  includeController: boolean,
): Effect.Effect<UsageStats, unknown> =>
  includeController
    ? context.stores.controllerRequestStore
        .aggregateEffect()
        .pipe(Effect.map((controller) => ({ ...body, controller })))
    : Effect.succeed(body);

const validateResponse = (body: UsageStats): Effect.Effect<UsageStats, unknown> =>
  Effect.try({
    try: () => validateUsageStats(body),
    catch: (error) => error,
  });

export const registerUsageRoutes = defineRoutes((app, context) => {
  let usageCache: { at: number; body: UsageStats } | null = null;

  return mergeRoutes(
    effectRoute(app.get, "/usage", (ctx) => {
      const includeController = ctx.req.query("include_controller") === "true";
      const usageEffect = Effect.gen(function* () {
        if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_TTL_MS) {
          return yield* withControllerUsage(context, usageCache.body, includeController);
        }
        const usage = yield* observeControllerFunction(
          context,
          "usage.aggregateInferenceRequests",
          () => context.stores.inferenceRequestStore.aggregateEffect(),
        );
        const body: UsageStats = usage ?? emptyResponse();
        usageCache = { at: Date.now(), body };
        return yield* withControllerUsage(context, body, includeController);
      }).pipe(
        Effect.flatMap(validateResponse),
        Effect.catch((error) => {
          context.logger.error(`[Usage] Error fetching usage stats: ${(error as Error).message}`);
          return withControllerUsage(context, emptyResponse(), includeController).pipe(
            Effect.flatMap(validateResponse),
          );
        }),
      );
      return usageEffect.pipe(Effect.map((body) => ctx.json(body)));
    }),
    effectRoute(app.get, "/studio/usage/outbox", (ctx) =>
      Effect.gen(function* () {
        if (context.config.controller_mode !== "standalone") {
          return yield* Effect.fail(
            conflict("Only a Standalone controller exposes a local usage outbox"),
          );
        }
        const requested = Number(ctx.req.query("limit") ?? 100);
        const events = yield* context.stores.inferenceRequestStore.pendingSyncEvents(requested);
        return ctx.json({ events });
      }),
    ),
    effectRoute(app.post, "/studio/usage/outbox/ack", (ctx) =>
      Effect.gen(function* () {
        if (context.config.controller_mode !== "standalone") {
          return yield* Effect.fail(
            conflict("Only a Standalone controller owns a local usage outbox"),
          );
        }
        const body = yield* decodeJsonBody(ctx, InferenceUsageAckSchema);
        yield* context.stores.inferenceRequestStore.markSynced(body.event_ids);
        return ctx.json({ success: true });
      }),
    ),
    effectRoute(app.post, "/studio/usage/events", (ctx) =>
      Effect.gen(function* () {
        if (context.config.controller_mode !== "head") {
          return yield* Effect.fail(conflict("Usage events can only be ingested by a Head"));
        }
        const body = yield* decodeJsonBody(ctx, InferenceUsageBatchSchema);
        yield* context.stores.inferenceRequestStore.importEvents(body.events);
        usageCache = null;
        return ctx.json({ event_ids: body.events.map((event) => event.event_id) });
      }),
    ),
  );
});
