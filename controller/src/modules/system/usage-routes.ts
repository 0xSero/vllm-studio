import type { UsageStats } from "@local-studio/contracts/usage";
import { Effect } from "effect";
import { observeControllerFunction } from "../../core/function-observability";
import { defineRoutes, mergeRoutes, effectRoute } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";
import { emptyResponse } from "./usage/usage-utilities";
const USAGE_CACHE_TTL_MS = 15000;
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
export const registerUsageRoutes = defineRoutes((app, context) => {
  let usageCache: {
    at: number;
    body: UsageStats;
  } | null = null;
  return mergeRoutes(
    effectRoute.get(app, "/usage", (ctx) => {
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
        Effect.catch((error) => {
          context.logger.error(`[Usage] Error fetching usage stats: ${(error as Error).message}`);
          return withControllerUsage(context, emptyResponse(), includeController);
        }),
      );
      return usageEffect.pipe(Effect.map((body) => ctx.json(body)));
    }),
  );
});
