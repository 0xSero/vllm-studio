import { Effect, Schema } from "effect";
import { notFound, serviceUnavailable } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";

const LaneSwitchRequestSchema = Schema.Struct({
  target_lane: Schema.Literals(["omlx", "ds4"]),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

export const registerStudioLaneRoutes = defineRoutes((app, context) => {
  return mergeRoutes(
    app.get(
      "/studio/lanes",
      documentRoute,
      effectHandler((ctx) =>
        context.laneSwitch.getStatus().pipe(Effect.map((status) => ctx.json(status))),
      ),
    ),

    app.post(
      "/studio/lanes/switch",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, LaneSwitchRequestSchema);
          const result = yield* context.laneSwitch.accept(body.target_lane);
          switch (result.kind) {
            case "disabled":
              return yield* Effect.fail(notFound("Lane Enable Switch is disabled"));
            case "unconfigured":
              return yield* Effect.fail(serviceUnavailable("Lane Enable Switch is not configured"));
            case "occupied":
              return ctx.json(
                { detail: "Lane switch already in progress", switch: result.job },
                { status: 409 },
              );
            case "existing":
              return ctx.json(result.job);
            case "ready":
              return ctx.json(result.job);
            case "accepted":
              return ctx.json(result.job, { status: 202 });
          }
        }),
      ),
    ),

    app.get(
      "/studio/lanes/switch/:id",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const id = ctx.req.param("id") ?? "";
          const job = context.laneSwitch.getJob(id);
          if (!job) return yield* Effect.fail(notFound("Lane switch job not found"));
          return ctx.json(job);
        }),
      ),
    ),
  );
});
