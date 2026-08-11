import type { Context, Hono, Schema as HonoSchema, TypedResponse } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppContext } from "../app-context";
import { effectHandler, type ControllerEffect, type ControllerEnvironment } from "./effect-handler";

export type ControllerRouteApp = Hono<ControllerEnvironment, HonoSchema, string>;

export const documentRoute = describeRoute({
  responses: { 200: { description: "Successful response" } },
});

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

export const defineRoutes = <Routes extends ControllerRouteApp>(
  registrar: (app: Hono<ControllerEnvironment>, context: AppContext) => Routes,
): typeof registrar => registrar;

export const mergeRoutes = <
  const Routes extends readonly [ControllerRouteApp, ...ControllerRouteApp[]],
>(
  ...routes: Routes
): UnionToIntersection<Routes[number]> => routes[0] as UnionToIntersection<Routes[number]>;

type EffectRouteHandler<Result extends Response | TypedResponse<unknown>> = (
  context: Context<ControllerEnvironment>,
) => ControllerEffect<Result, unknown>;

export const effectRoute = {
  get: <Path extends string, Result extends Response | TypedResponse<unknown>>(
    app: Hono<ControllerEnvironment>,
    path: Path,
    handler: EffectRouteHandler<Result>,
  ) => app.get(path, documentRoute, effectHandler(handler)),
  post: <Path extends string, Result extends Response | TypedResponse<unknown>>(
    app: Hono<ControllerEnvironment>,
    path: Path,
    handler: EffectRouteHandler<Result>,
  ) => app.post(path, documentRoute, effectHandler(handler)),
  put: <Path extends string, Result extends Response | TypedResponse<unknown>>(
    app: Hono<ControllerEnvironment>,
    path: Path,
    handler: EffectRouteHandler<Result>,
  ) => app.put(path, documentRoute, effectHandler(handler)),
  patch: <Path extends string, Result extends Response | TypedResponse<unknown>>(
    app: Hono<ControllerEnvironment>,
    path: Path,
    handler: EffectRouteHandler<Result>,
  ) => app.patch(path, documentRoute, effectHandler(handler)),
  delete: <Path extends string, Result extends Response | TypedResponse<unknown>>(
    app: Hono<ControllerEnvironment>,
    path: Path,
    handler: EffectRouteHandler<Result>,
  ) => app.delete(path, documentRoute, effectHandler(handler)),
};
