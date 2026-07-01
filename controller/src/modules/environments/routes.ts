import type { RouteRegistrar } from "../../http/route-registrar";
import { badRequest, notFound } from "../../core/errors";
import { optionalString, parseJsonObjectBody } from "../../core/validation";
import { parseEnvironment } from "./environment-serializer";
import { resolveEnvironmentImage } from "./image-registry";
import type { Environment } from "./types";

const withResolvedImage = (environment: Environment): Environment & { image: string } => ({
  ...environment,
  image: resolveEnvironmentImage({
    engineId: environment.engineId,
    version: environment.version,
    ...(environment.variant ? { variant: environment.variant } : {}),
  }),
});

export const registerEnvironmentRoutes: RouteRegistrar = (app, context) => {
  app.get("/environments", (ctx) => {
    const environments = context.stores.environmentStore.list().map(withResolvedImage);
    return ctx.json(environments);
  });

  app.get("/environments/:environmentId", (ctx) => {
    const environment = context.stores.environmentStore.get(ctx.req.param("environmentId"));
    if (!environment) throw notFound("Environment not found");
    return ctx.json(withResolvedImage(environment));
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
    return ctx.json(withResolvedImage(environment));
  });

  app.delete("/environments/:environmentId", (ctx) => {
    const environmentId = ctx.req.param("environmentId");
    const deleted = context.stores.environmentStore.delete(environmentId);
    if (!deleted) throw notFound("Environment not found");
    return ctx.json({ success: true });
  });
};
