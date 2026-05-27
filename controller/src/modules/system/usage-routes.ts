import type { Hono } from "hono";
import type { AppContext } from "../../types/context";
import { getUsageFromPiSessions } from "./usage/pi-sessions";
import { emptyResponse } from "./usage/usage-utilities";

const collectKnownModels = async (context: AppContext): Promise<Set<string>> => {
  const knownModels = new Set<string>();
  for (const recipe of context.stores.recipeStore.list()) {
    if (recipe.served_model_name) knownModels.add(recipe.served_model_name);
    knownModels.add(recipe.id);
    if (recipe.name) knownModels.add(recipe.name);
  }
  const current = await context.processManager.findInferenceProcess(context.config.inference_port);
  if (current?.served_model_name) knownModels.add(current.served_model_name);
  if (current?.model_path) {
    knownModels.add(current.model_path);
    knownModels.add(current.model_path.split("/").pop() ?? current.model_path);
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
      const knownModels = await collectKnownModels(context);
      const usage = context.stores.inferenceRequestStore.aggregate(knownModels);
      const response = usage ?? emptyResponse();
      return ctx.json({
        ...response,
        controller: context.stores.controllerRequestStore.aggregate(),
      });
    } catch (error) {
      context.logger.error(`[Usage] Error fetching usage stats: ${(error as Error).message}`);
      return ctx.json({
        ...emptyResponse(),
        controller: context.stores.controllerRequestStore.aggregate(),
      });
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
      context.logger.error(`[Usage] Error fetching pi-sessions usage: ${(error as Error).message}`);
      return ctx.json(emptyResponse());
    }
  });
};
