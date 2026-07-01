import type { RouteRegistrar } from "../../http/route-registrar";
import { badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { optionalString, parseJsonObjectBody } from "../../core/validation";
import { resolveBinary } from "../../core/command";
import { parseEnvironment } from "./environment-serializer";
import { isEnvironmentRunning, startEnvironment, stopEnvironment } from "./environment-process";
import { resolveEnvironmentImage } from "./image-registry";
import type { Environment } from "./types";

const withStatus = (environment: Environment): Environment & { image: string; running: boolean } => ({
  ...environment,
  image: resolveEnvironmentImage({
    engineId: environment.engineId,
    version: environment.version,
    ...(environment.variant ? { variant: environment.variant } : {}),
  }),
  running: isEnvironmentRunning(environment.id),
});

export const registerEnvironmentRoutes: RouteRegistrar = (app, context) => {
  app.get("/environments", (ctx) => {
    const environments = context.stores.environmentStore.list().map(withStatus);
    return ctx.json(environments);
  });

  app.get("/environments/:environmentId", (ctx) => {
    const environment = context.stores.environmentStore.get(ctx.req.param("environmentId"));
    if (!environment) throw notFound("Environment not found");
    return ctx.json(withStatus(environment));
  });

  app.post("/environments", async (ctx) => {
    const body = await parseJsonObjectBody(ctx);
    const recipeId = optionalString(body, "recipeId");
    if (!recipeId) throw badRequest("recipeId is required");
    if (!context.stores.recipeStore.get(recipeId)) {
      throw badRequest(`No recipe found with id "${recipeId}"`);
    }
    let environment: Environment;
    try {
      environment = parseEnvironment(body);
    } catch (error) {
      throw badRequest(String(error));
    }
    context.stores.environmentStore.save(environment);
    return ctx.json(withStatus(environment));
  });

  app.delete("/environments/:environmentId", async (ctx) => {
    const environmentId = ctx.req.param("environmentId");
    const environment = context.stores.environmentStore.get(environmentId);
    if (!environment) throw notFound("Environment not found");
    if (isEnvironmentRunning(environmentId)) {
      await stopEnvironment(environmentId, true);
    }
    context.stores.environmentStore.delete(environmentId);
    return ctx.json({ success: true });
  });

  app.post("/environments/:environmentId/start", async (ctx) => {
    const environmentId = ctx.req.param("environmentId");
    const environment = context.stores.environmentStore.get(environmentId);
    if (!environment) throw notFound("Environment not found");
    const recipe = context.stores.recipeStore.get(environment.recipeId);
    if (!recipe) {
      throw badRequest(`Environment "${environmentId}" references a missing recipe`);
    }
    if (!resolveBinary("docker")) throw serviceUnavailable("docker is not installed or not on PATH");
    if (isEnvironmentRunning(environmentId)) {
      return ctx.json({ started: true, message: "Already running" });
    }
    const result = await startEnvironment(environment, recipe);
    return ctx.json(result, { status: result.started ? 200 : 502 });
  });

  app.post("/environments/:environmentId/stop", async (ctx) => {
    const environmentId = ctx.req.param("environmentId");
    if (!context.stores.environmentStore.get(environmentId)) throw notFound("Environment not found");
    const force = ctx.req.query("force") === "1";
    const stopped = await stopEnvironment(environmentId, force);
    return ctx.json({ stopped });
  });
};
