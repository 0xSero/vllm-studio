import { Effect } from "effect";
import { HttpStatus, notFound, serviceUnavailable } from "../../core/errors";
import { defineRoutes, mergeRoutes, effectRoute } from "../../http/route-registrar";
import { toHttp } from "../compute/failures";
import { formatLaunchFailureBudgetMessage } from "./launch-failure-budget";
/** Model lifecycle over the compute bridge: one active model, served on the legacy
 *  inference port. Failure mapping is the compute union -> HTTP, never string matching. */
export const registerLifecycleRoutes = defineRoutes((app, context) =>
  mergeRoutes(
    effectRoute.post(app, "/launch/:recipeId", (ctx) =>
      Effect.gen(function* () {
        const recipeId = ctx.req.param("recipeId") ?? "";
        const recipe = yield* context.stores.recipeStore.get(recipeId);
        if (!recipe) return yield* Effect.fail(notFound("Recipe not found"));
        const blocked = context.launchFailureBudget.isBlocked(recipeId);
        if (blocked) {
          return yield* Effect.fail(
            new HttpStatus({ status: 429, detail: formatLaunchFailureBudgetMessage(blocked) }),
          );
        }
        yield* context.bridge.launchRecipe(recipe).pipe(
          Effect.mapError((failure) => {
            if (failure.kind !== "already-running" && failure.kind !== "cancelled") {
              context.launchFailureBudget.recordFailure(recipeId);
            }
            return toHttp(failure);
          }),
        );
        context.launchFailureBudget.reset(recipeId);
        return ctx.json({ success: true, message: "Launch started" });
      }),
    ),
    effectRoute.post(app, "/launch/:recipeId/cancel", (ctx) =>
      Effect.gen(function* () {
        const recipeId = ctx.req.param("recipeId") ?? "";
        const cancelled = yield* context.bridge.cancelLaunch();
        if (!cancelled) {
          return yield* Effect.fail(notFound(`No launch in progress for ${recipeId}`));
        }
        return ctx.json({ success: true, message: `Launch of ${recipeId} cancelled` });
      }),
    ),
    effectRoute.post(app, "/evict", (ctx) =>
      Effect.gen(function* () {
        yield* context.bridge
          .evict()
          .pipe(
            Effect.mapError((error) => serviceUnavailable(`Failed to evict: ${String(error)}`)),
          );
        return ctx.json({ success: true, evicted_pid: null });
      }),
    ),
    effectRoute.get(app, "/wait-ready", (ctx) =>
      Effect.gen(function* () {
        const timeout = Number(ctx.req.query("timeout") ?? 300);
        const start = Date.now();
        if (yield* context.bridge.waitForHealthy(timeout * 1000)) {
          return ctx.json({ ready: true, elapsed: Math.floor((Date.now() - start) / 1000) });
        }
        return ctx.json({ ready: false, elapsed: timeout, error: "Timeout waiting for backend" });
      }),
    ),
  ),
);
