import { Cause, Effect, Exit, Schema } from "effect";
import type { MiddlewareHandler } from "hono";
import { isHttpStatus } from "../core/errors";
import type { AppContext } from "../app-context";
import { effectMiddleware, type ControllerEnvironment } from "./effect-handler";

const TELEMETRY_SKIP_PATHS = new Set([
  "/health",
  "/metrics",
  "/events",
  "/status",
  "/api/docs",
  "/api/spec",
]);

function elapsedMs(start: number): number {
  return Math.round(performance.now() - start);
}

interface RequestFailure {
  readonly cause: unknown;
}

const NamedFailureSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
});

function errorClass(failure: RequestFailure): string {
  if (isHttpStatus(failure.cause)) return `Http${failure.cause.status}`;
  const named = Schema.decodeUnknownOption(NamedFailureSchema)(failure.cause);
  return named._tag === "Some" ? named.value.name || "Error" : "Error";
}

function errorMessage(failure: RequestFailure): string {
  if (isHttpStatus(failure.cause)) return failure.cause.detail;
  if (failure.cause instanceof Error) return failure.cause.message;
  return String(failure.cause);
}

export function createControllerRequestObservabilityMiddleware(
  context: AppContext,
): MiddlewareHandler<ControllerEnvironment> {
  return effectMiddleware((ctx, next) => {
    if (TELEMETRY_SKIP_PATHS.has(ctx.req.path)) {
      return Effect.tryPromise({ try: () => next(), catch: (source) => source });
    }
    context.logger.debug(`${ctx.req.method} ${ctx.req.path}`);
    const start = performance.now();
    const method = ctx.req.method.toUpperCase();
    const path = ctx.req.path;
    const userAgent = ctx.req.header("user-agent") ?? null;
    return Effect.tryPromise({ try: () => next(), catch: (source) => source }).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) {
          const status = ctx.res.status || 200;
          return context.stores.controllerRequestStore
            .recordEffect({
              method,
              path,
              status,
              duration_ms: elapsedMs(start),
              success: status >= 200 && status < 400,
              user_agent: userAgent,
            })
            .pipe(Effect.ignore);
        }
        const failure = Cause.findErrorOption(exit.cause);
        const error = failure._tag === "Some" ? failure.value : Cause.squash(exit.cause);
        return context.stores.controllerRequestStore
          .recordEffect({
            method,
            path,
            status: isHttpStatus(error) ? error.status : 500,
            duration_ms: elapsedMs(start),
            success: false,
            error_class: errorClass({ cause: error }),
            error_message: errorMessage({ cause: error }),
            user_agent: userAgent,
          })
          .pipe(Effect.ignore);
      }),
    );
  });
}
