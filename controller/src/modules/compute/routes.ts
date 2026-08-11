import { Effect, Schema } from "effect";
import { badRequest } from "../../core/errors";
import { readBoundedRequestBody } from "../../http/bounded-body";
import { defineRoutes, mergeRoutes, effectRoute } from "../../http/route-registrar";
import { ENGINE_IDS, type EngineId, type ServingOptions } from "./contracts";
import { availableEngines } from "./engines/registry";
import { toHttp } from "./failures";
const LAUNCH_REQUEST_LIMIT = 64 * 1024;
const OptionsSchema = Schema.Struct({
  tensorParallel: Schema.optional(Schema.Number),
  pipelineParallel: Schema.optional(Schema.Number),
  maxContextLength: Schema.optional(Schema.Number),
  memoryFraction: Schema.optional(Schema.Number),
  maxConcurrentRequests: Schema.optional(Schema.Number),
  kvCacheDtype: Schema.optional(Schema.String),
  dtype: Schema.optional(Schema.String),
  quantization: Schema.optional(Schema.String),
  trustRemoteCode: Schema.optional(Schema.Boolean),
  toolCallParser: Schema.optional(Schema.String),
  reasoningParser: Schema.optional(Schema.String),
});
const LaunchRequestSchema = Schema.Struct({
  name: Schema.String,
  engine: Schema.Literals(ENGINE_IDS as unknown as [EngineId, ...EngineId[]]),
  modelPath: Schema.String,
  recipeId: Schema.optional(Schema.String),
  runtime: Schema.optional(Schema.Literals(["process", "docker"])),
  deviceCount: Schema.optional(Schema.Number),
  servedModelName: Schema.optional(Schema.String),
  options: Schema.optional(OptionsSchema),
  extraArgs: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  dockerImage: Schema.optional(Schema.String),
  binary: Schema.optional(Schema.String),
});
/** Optional-schema fields decode as `key: undefined`; spreading those over the defaults
 *  would erase them, so undefined entries are dropped before the merge. */
const mergeOptions = (
  overrides: Partial<
    Record<keyof ServingOptions, ServingOptions[keyof ServingOptions] | undefined>
  >,
): ServingOptions => {
  const merged: Record<string, unknown> = { ...defaultOptions };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as ServingOptions;
};
const defaultOptions: ServingOptions = {
  tensorParallel: 1,
  pipelineParallel: 1,
  maxContextLength: 8192,
  memoryFraction: 0.9,
  maxConcurrentRequests: 64,
  kvCacheDtype: null,
  dtype: null,
  quantization: null,
  trustRemoteCode: false,
  toolCallParser: null,
  reasoningParser: null,
};
export const registerComputeRoutes = defineRoutes((app, context) =>
  mergeRoutes(
    effectRoute.get(app, "/compute/devices", (ctx) =>
      context.compute.telemetry.snapshot().pipe(Effect.map((snapshot) => ctx.json(snapshot))),
    ),
    effectRoute.get(app, "/compute/engines", (ctx) =>
      context.compute
        .host()
        .pipe(Effect.map((host) => ctx.json({ host, engines: availableEngines(host) }))),
    ),
    effectRoute.get(app, "/compute/instances", (ctx) =>
      context.compute.service
        .instances()
        .pipe(Effect.map((views) => ctx.json({ instances: views }))),
    ),
    effectRoute.post(app, "/compute/launch", (ctx) =>
      Effect.gen(function* () {
        const bytes = yield* readBoundedRequestBody(ctx.req.raw, LAUNCH_REQUEST_LIMIT).pipe(
          Effect.mapError(() => badRequest("unreadable launch request")),
        );
        const parsed = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(LaunchRequestSchema),
        )(new TextDecoder().decode(bytes)).pipe(
          Effect.mapError((error) => badRequest(`invalid launch request: ${String(error)}`)),
        );
        const record = yield* context.compute.service
          .launch({
            name: parsed.name,
            engine: parsed.engine,
            recipeId: parsed.recipeId ?? parsed.name,
            runtime: parsed.runtime ?? "process",
            deviceCount: parsed.deviceCount ?? 1,
            modelPath: parsed.modelPath,
            servedModelName: parsed.servedModelName ?? parsed.name,
            options: mergeOptions(parsed.options ?? {}),
            extraArgs: parsed.extraArgs ?? [],
            env: parsed.env ?? {},
            dockerImage: parsed.dockerImage ?? null,
            binary: parsed.binary ?? null,
          })
          .pipe(Effect.mapError(toHttp));
        return ctx.json({ instance: record });
      }),
    ),
    effectRoute.post(app, "/compute/instances/:name/stop", (ctx) =>
      context.compute.service
        .stop(ctx.req.param("name") ?? "")
        .pipe(Effect.map((stopped) => ctx.json({ stopped }))),
    ),
    effectRoute.post(app, "/compute/instances/:name/cancel", (ctx) =>
      context.compute.service
        .cancel(ctx.req.param("name") ?? "")
        .pipe(Effect.map((cancelled) => ctx.json({ cancelled }))),
    ),
  ),
);
