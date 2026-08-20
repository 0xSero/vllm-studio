import type { Context, Handler, MiddlewareHandler, Next, TypedResponse } from "hono";
import { Cause, Effect, Exit } from "effect";
import type { AppContextService } from "../app-context";
import type { ControllerRuntime } from "../core/effect-runtime";

export type ControllerEffect<A, E = never> = Effect.Effect<A, E, AppContextService>;
export type ControllerEnvironment = {
  Variables: {
    controllerRuntime: ControllerRuntime;
  };
};

export const controllerRuntimeMiddleware =
  (runtime: ControllerRuntime): MiddlewareHandler<ControllerEnvironment> =>
  (context, next) => {
    context.set("controllerRuntime", runtime);
    return next();
  };

export const runControllerEffect = <A, E>(
  runtime: ControllerRuntime,
  effect: ControllerEffect<A, E>,
): Promise<A> =>
  runtime.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.findErrorOption(exit.cause);
    if (failure._tag === "Some") throw failure.value;
    throw Cause.squash(exit.cause);
  });

export const runEffectWithCleanup = <A, E>(
  effect: Effect.Effect<A, E, never>,
  cleanup: Effect.Effect<void, never, never>,
): Promise<A> => Effect.runPromise(Effect.ensuring(effect, cleanup));

export const effectHandler =
  <Result extends Response | TypedResponse<unknown>>(
    handler: (context: Context<ControllerEnvironment>) => ControllerEffect<Result, unknown>,
  ): Handler<ControllerEnvironment, string, {}, Promise<Result>> =>
  (context) =>
    runControllerEffect(context.get("controllerRuntime"), handler(context));

export const effectMiddleware =
  (
    handler: (
      context: Context<ControllerEnvironment>,
      next: Next,
    ) => ControllerEffect<Response | void, unknown>,
  ): MiddlewareHandler<ControllerEnvironment> =>
  (context, next) =>
    runControllerEffect(context.get("controllerRuntime"), handler(context, next));
