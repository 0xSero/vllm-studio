import type { RouteRegistrar } from "../../http/route-registrar";
import { badRequest, notFound } from "../../core/errors";
import { parseJsonObjectBody } from "../../core/validation";
import { parseRecipe } from "../models/recipes/recipe-serializer";
import { Event } from "../system/event-manager";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import { createGetObservedProcess } from "./observed-process";

export const registerRecipeRoutes: RouteRegistrar = (app, context) => {
  const getObservedProcess = createGetObservedProcess(context);

  app.get("/recipes", async (ctx) => {
    const recipes = context.stores.recipeStore.list();
    const current = await getObservedProcess("recipes.list");
    // launchState is the transitional truth: it marks the recipe between
    // /launch acceptance and readiness. The process scan is the running truth.
    // (The old getCurrentRecipe() cache showed a crashed model as "starting"
    // forever and a launching one as "stopped".)
    const launchingId = context.launchState.getLaunchingRecipeId();
    const result = recipes.map((recipe) => {
      const crashLoop = context.launchFailureBudget.get(recipe.id);
      let status = crashLoop?.blocked ? "error" : "stopped";
      if (launchingId === recipe.id) status = "starting";
      if (current && isRecipeRunning(recipe, current)) status = "running";
      return { ...recipe, status, crash_loop: crashLoop };
    });
    return ctx.json(result);
  });

  app.get("/recipes/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const recipe = context.stores.recipeStore.get(recipeId);
    if (!recipe) throw notFound("Recipe not found");
    return ctx.json(recipe);
  });

  app.post("/recipes", async (ctx) => {
    const body = await parseJsonObjectBody(ctx);
    try {
      const recipe = parseRecipe(body);
      context.stores.recipeStore.save(recipe);
      context.engineService.resetLaunchFailureBudget(recipe.id);
      await context.eventManager.publish(new Event(CONTROLLER_EVENTS.RECIPE_CREATED, { recipe }));
      return ctx.json({ success: true, id: recipe.id });
    } catch (error) {
      throw badRequest(String(error));
    }
  });

  app.put("/recipes/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const body = await parseJsonObjectBody(ctx);
    try {
      const recipe = parseRecipe({ ...body, id: recipeId });
      context.stores.recipeStore.save(recipe);
      context.engineService.resetLaunchFailureBudget(recipe.id);
      await context.eventManager.publish(new Event(CONTROLLER_EVENTS.RECIPE_UPDATED, { recipe }));
      return ctx.json({ success: true, id: recipe.id });
    } catch (error) {
      throw badRequest(String(error));
    }
  });

  app.delete("/recipes/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const deleted = context.stores.recipeStore.delete(recipeId);
    if (!deleted) throw notFound("Recipe not found");
    context.engineService.resetLaunchFailureBudget(recipeId);
    await context.eventManager.publish(
      new Event(CONTROLLER_EVENTS.RECIPE_DELETED, { recipe_id: recipeId }),
    );
    return ctx.json({ success: true });
  });
};
