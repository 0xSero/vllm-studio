import type { UsageStats } from "@local-studio/contracts/usage";
import { observeControllerFunction } from "../../core/function-observability";
import type { RouteRegistrar } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";
import { getUsageFromPiSessions } from "./usage/pi-sessions";
import { emptyResponse } from "./usage/usage-utilities";

// Analytics endpoints are not real-time; a short TTL collapses bursty
// dashboard polling (and repeated aggregation passes) into one computation.
const USAGE_CACHE_TTL_MS = 15_000;

const withControllerUsage = (
  context: AppContext,
  body: UsageStats,
  includeController: boolean,
): UsageStats =>
  includeController
    ? { ...body, controller: context.stores.controllerRequestStore.aggregate() }
    : body;

export const registerUsageRoutes: RouteRegistrar = (app, context) => {
  let usageCache: { at: number; body: UsageStats } | null = null;

  app.get("/usage", async (ctx) => {
    const includeController = ctx.req.query("include_controller") === "true";
    try {
      if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_TTL_MS) {
        return ctx.json(withControllerUsage(context, usageCache.body, includeController));
      }
      const usage = await observeControllerFunction(
        context,
        "usage.aggregateInferenceRequests",
        () => context.stores.inferenceRequestStore.aggregate(),
      );
      const body: UsageStats = usage ?? emptyResponse();
      usageCache = { at: Date.now(), body };
      return ctx.json(withControllerUsage(context, body, includeController));
    } catch (error) {
      context.logger.error(`[Usage] Error fetching usage stats: ${(error as Error).message}`);
      return ctx.json(withControllerUsage(context, emptyResponse(), includeController));
    }
  });

  app.get("/usage/pi-sessions", async (ctx) => {
    try {
      // pi-sessions tab shows ALL pi coding-agent activity, regardless of
      // whether the model is one of our recipes (so users can see their
      // external model usage too).
      const usage = await observeControllerFunction(context, "usage.aggregatePiSessions", () =>
        getUsageFromPiSessions(),
      );
      const body: UsageStats = usage ?? emptyResponse();
      return ctx.json(body);
    } catch (error) {
      context.logger.error(`[Usage] Error fetching pi-sessions usage: ${(error as Error).message}`);
      return ctx.json(emptyResponse());
    }
  });
};
