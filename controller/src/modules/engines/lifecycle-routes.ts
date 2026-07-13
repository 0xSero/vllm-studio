import type { RouteRegistrar } from "../../http/route-registrar";
import { HttpStatus, badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { isRecipeRunning } from "../models/recipes/recipe-matching";

export const registerLifecycleRoutes: RouteRegistrar = (app, context) => {
  const launchAbortControllers = new Map<string, AbortController>();

  app.post("/launch/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const recipe = context.stores.recipeStore.get(recipeId);
    if (!recipe) throw notFound("Recipe not found");
    const source =
      ctx.req.header("x-vllm-source") ??
      ctx.req.header("x-source") ??
      ctx.req.header("user-agent") ??
      null;
    const launchState = context.launchState.getState();
    if (launchState.phase !== "idle") {
      const activeRecipeId = launchState.recipeId ?? "unknown";
      context.logger.warn("Rejected queued launch request", {
        active_recipe_id: activeRecipeId,
        requested_recipe_id: recipeId,
        source,
      });
      throw new HttpStatus({
        status: 409,
        detail:
          activeRecipeId === recipeId
            ? `Launch already in progress for ${recipeId}`
            : `Launch already in progress for ${activeRecipeId}; refusing to queue ${recipeId}`,
      });
    }
    const current = await context.processManager.findInferenceProcess(
      context.config.inference_port,
    );
    if (current && !isRecipeRunning(recipe, current, { allowEitherPathContains: true })) {
      context.logger.warn("Rejected launch request while another model is running", {
        running_model: current.served_model_name ?? current.model_path,
        running_backend: current.backend,
        requested_recipe_id: recipeId,
        source,
      });
      throw new HttpStatus({
        status: 409,
        detail: `Model ${current.served_model_name ?? current.model_path} is already running; evict it before launching ${recipeId}`,
      });
    }
    context.logger.info("Accepted launch request", { recipe_id: recipeId, source });
    const controller = new AbortController();
    launchAbortControllers.set(recipeId, controller);
    context.launchState.markLaunching(recipeId);
    try {
      const result = await context.engineService.setActiveRecipe(recipe, {
        signal: controller.signal,
      });
      if (!result.ok) {
        if (result.error.toLowerCase().includes("cancelled")) throw badRequest(result.error);
        throw serviceUnavailable(result.error);
      }
      return ctx.json({ success: true, message: "Launch started" });
    } finally {
      if (launchAbortControllers.get(recipeId) === controller) {
        launchAbortControllers.delete(recipeId);
      }
      if (context.launchState.getLaunchingRecipeId() === recipeId) {
        context.launchState.markIdle();
      }
    }
  });

  app.post("/launch/:recipeId/cancel", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const controller = launchAbortControllers.get(recipeId);
    if (!controller) throw notFound(`No launch in progress for ${recipeId}`);
    controller.abort();
    const result = await context.engineService.setActiveRecipe(null, { signal: controller.signal });
    if (!result.ok) throw serviceUnavailable(result.error);
    return ctx.json({ success: true, message: `Launch of ${recipeId} cancelled` });
  });

  app.post("/evict", async (ctx) => {
    const result = await context.engineService.setActiveRecipe(null);
    if (!result.ok) throw serviceUnavailable(result.error);
    return ctx.json({ success: true, evicted_pid: null });
  });

  app.get("/wait-ready", async (ctx) => {
    const timeout = Number(ctx.req.query("timeout") ?? 300);
    const start = Date.now();
    if (await context.engineService.waitForHealthy(timeout * 1000)) {
      return ctx.json({ ready: true, elapsed: Math.floor((Date.now() - start) / 1000) });
    }
    return ctx.json({ ready: false, elapsed: timeout, error: "Timeout waiting for backend" });
  });
};
