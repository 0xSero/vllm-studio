// CRITICAL
import type { Hono } from "hono";
import type { AppContext } from "../../types/context";
import { getUsageFromPiSessions } from "./usage/pi-sessions";
import { emptyResponse } from "./usage/usage-utilities";

const collectKnownModels = (context: AppContext): Set<string> => {
  const knownModels = new Set<string>();
  for (const recipe of context.stores.recipeStore.list()) {
    if (recipe.served_model_name) knownModels.add(recipe.served_model_name);
    knownModels.add(recipe.id);
    if (recipe.name) knownModels.add(recipe.name);
  }
  return knownModels;
};

/**
 * Register usage analytics routes.
 *
 * /usage              — server-recorded inference requests (this controller's
 *                       OpenAI proxy), filtered to recipe-managed models.
 * /usage/pi-sessions  — pi coding-agent JSONL session aggregation, separate tab.
 *
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerUsageRoutes = (app: Hono, context: AppContext): void => {
  app.get("/usage", async (ctx) => {
    try {
      const knownModels = collectKnownModels(context);
      const usage = context.stores.inferenceRequestStore.aggregate(knownModels);
      if (usage) return ctx.json(usage);
      return ctx.json(emptyResponse());
    } catch (error) {
      context.logger.error(`[Usage] Error fetching usage stats: ${(error as Error).message}`);
      return ctx.json(emptyResponse());
    }
  });

  app.get("/usage/pi-sessions", async (ctx) => {
    try {
      // pi-sessions tab shows ALL pi coding-agent activity, regardless of
      // whether the model is one of our recipes (so users can see their
      // external model usage too).
      const usage = getUsageFromPiSessions(undefined, undefined, undefined);
      if (usage) return ctx.json(usage);
      return ctx.json(emptyResponse());
    } catch (error) {
      context.logger.error(
        `[Usage] Error fetching pi-sessions usage: ${(error as Error).message}`
      );
      return ctx.json(emptyResponse());
    }
  });
};
