import type { Hono } from "hono";
import type { AppContext } from "../app-context";

/**
 * Common shape for every module's route registration entry point. Modules
 * export `register<Module>Routes: RouteRegistrar` and http/app.ts composes
 * them; no module wires itself into the app directly.
 */
export type RouteRegistrar = (app: Hono, context: AppContext) => void;
