import { connect } from "node:net";
import { hostname } from "node:os";
import { access, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Effect, Schema } from "effect";
import { effectRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import type { SystemConfigResponse } from "../models/types";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { estimateWeightsSizeBytes } from "../models/model-browser";
import { getGpuInfo } from "./platform/gpu";
import { getSystemRuntimeInfo } from "../engines/runtimes/runtime-info";
import { buildCompatibilityReport } from "./platform/compatibility-report";
import { registerMonitoringRoutes } from "./metrics-routes";
import { registerLogsRoutes } from "./logs-routes";
import { registerUsageRoutes } from "./usage-routes";
const SYSTEM_SERVICE_CHECK_HOST = "127.0.0.1";
const SYSTEM_COMPAT_SERVICE_CHECK_TIMEOUT_MS = 500;
const SYSTEM_DEFAULT_SERVICE_CHECK_TIMEOUT_MS = 1_000;
const PositiveNumberSchema = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThan(0)),
);
const PositiveIntegerSchema = PositiveNumberSchema.pipe(Schema.check(Schema.isInt()));
const ModelDimensionSchema = Schema.Union([Schema.Number, Schema.NumberFromString]).pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThan(0)),
);
const VramCalculatorBodySchema = Schema.Struct({
  model: Schema.String,
  context_length: PositiveNumberSchema,
  tp_size: Schema.optionalKey(PositiveIntegerSchema),
  kv_dtype: Schema.optionalKey(Schema.String),
});
const ModelConfigSchema = Schema.Struct({
  num_hidden_layers: Schema.optionalKey(ModelDimensionSchema),
  n_layer: Schema.optionalKey(ModelDimensionSchema),
  num_layers: Schema.optionalKey(ModelDimensionSchema),
  hidden_size: Schema.optionalKey(ModelDimensionSchema),
  n_embd: Schema.optionalKey(ModelDimensionSchema),
  d_model: Schema.optionalKey(ModelDimensionSchema),
  dim: Schema.optionalKey(ModelDimensionSchema),
  num_attention_heads: Schema.optionalKey(ModelDimensionSchema),
  n_head: Schema.optionalKey(ModelDimensionSchema),
  num_heads: Schema.optionalKey(ModelDimensionSchema),
  num_key_value_heads: Schema.optionalKey(ModelDimensionSchema),
  num_kv_heads: Schema.optionalKey(ModelDimensionSchema),
  head_dim: Schema.optionalKey(ModelDimensionSchema),
});

type ModelConfig = Schema.Schema.Type<typeof ModelConfigSchema>;
type VramCalculatorBody = Schema.Schema.Type<typeof VramCalculatorBodySchema>;

type ModelDimensions = {
  layerCount: number | undefined;
  keyValueHeadCount: number | undefined;
  headDim: number | undefined;
};

type VramResult = {
  model_size_gb: number;
  context_memory_gb: number;
  overhead_gb: number;
  total_gb: number;
  fits_in_vram: boolean;
  fits: boolean;
  utilization_percent: number;
  breakdown: Record<
    "model_weights_gb" | "kv_cache_gb" | "activations_gb" | "per_gpu_gb" | "total_gb",
    number
  >;
};

const loadModel = (
  modelsDirectory: string,
  model: string,
): Effect.Effect<{ resolved: string; weightsBytes: number }, unknown> =>
  Effect.gen(function* () {
    if (!model) return yield* Effect.fail(badRequest("model is required"));
    const resolved = resolve(model);
    const modelsRoot = resolve(modelsDirectory);
    const rootPrefix = modelsRoot.endsWith(sep) ? modelsRoot : modelsRoot + sep;
    if (!resolved.startsWith(rootPrefix)) {
      return yield* Effect.fail(badRequest("model must be inside models_dir"));
    }
    const modelExists = yield* Effect.tryPromise({
      try: () => access(resolved),
      catch: (error) => error,
    }).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (!modelExists) return yield* Effect.fail(notFound("Model path not found"));
    const weightsBytes = yield* estimateWeightsSizeBytes(resolved, false);
    if (!weightsBytes || weightsBytes <= 0) {
      return yield* Effect.fail(notFound("Model weights not found"));
    }
    return { resolved, weightsBytes };
  });

const loadModelConfig = (resolved: string): Effect.Effect<ModelConfig, unknown> =>
  Effect.tryPromise({
    try: () => readFile(join(resolved, "config.json"), "utf-8"),
    catch: (error) => error,
  }).pipe(
    Effect.flatMap((raw) => Effect.try({ try: () => JSON.parse(raw), catch: (error) => error })),
    Effect.flatMap((value) => Schema.decodeUnknownEffect(ModelConfigSchema)(value)),
    Effect.catch(() => Schema.decodeUnknownEffect(ModelConfigSchema)({})),
  );

const getModelDimensions = (config: ModelConfig): ModelDimensions => {
  const layerCount = config.num_hidden_layers ?? config.n_layer ?? config.num_layers;
  const hiddenSize = config.hidden_size ?? config.n_embd ?? config.d_model ?? config.dim;
  const headCount = config.num_attention_heads ?? config.n_head ?? config.num_heads;
  const keyValueHeadCount = config.num_key_value_heads ?? config.num_kv_heads ?? headCount;
  const headDim = config.head_dim ?? (hiddenSize && headCount ? hiddenSize / headCount : undefined);
  return { layerCount, keyValueHeadCount, headDim };
};

const calculateKvCacheBytes = (
  contextLength: number,
  dimensions: ReturnType<typeof getModelDimensions>,
  kvBytesPerValue: number,
): number => {
  if (!dimensions.layerCount || !dimensions.keyValueHeadCount || !dimensions.headDim) return 0;
  return (
    contextLength *
    dimensions.layerCount *
    dimensions.keyValueHeadCount *
    dimensions.headDim *
    2 *
    kvBytesPerValue
  );
};

const buildVramResult = (
  body: VramCalculatorBody,
  config: ModelConfig,
  weightsBytes: number,
  gpuCapacitiesGb: number[],
): VramResult => {
  const tpSize = body.tp_size ?? 1;
  const dimensions = getModelDimensions(config);
  const kvBytesPerValue = (body.kv_dtype ?? "auto").toLowerCase() === "fp8" ? 1 : 2;
  const kvCacheBytes = calculateKvCacheBytes(body.context_length, dimensions, kvBytesPerValue);
  const weightsTotalGb = weightsBytes / 1024 ** 3;
  const weightsPerGpuGb = weightsTotalGb / tpSize;
  const kvCachePerGpuGb = kvCacheBytes > 0 ? kvCacheBytes / 1024 ** 3 / tpSize : 0;
  const activationsPerGpuGb = Math.max(0.5, weightsPerGpuGb * 0.1);
  const overheadPerGpuGb = 2.0;
  const perGpuGb = weightsPerGpuGb + kvCachePerGpuGb + activationsPerGpuGb + overheadPerGpuGb;
  const totalGb = perGpuGb * tpSize;
  const perGpuCapacityGb =
    gpuCapacitiesGb.length >= tpSize ? Math.min(...gpuCapacitiesGb.slice(0, tpSize)) : 0;
  const fits = perGpuCapacityGb > 0 ? perGpuGb <= perGpuCapacityGb : true;
  const utilizationPercent = perGpuCapacityGb > 0 ? (perGpuGb / perGpuCapacityGb) * 100 : 0;
  return {
    model_size_gb: weightsTotalGb,
    context_memory_gb: kvCachePerGpuGb * tpSize,
    overhead_gb: overheadPerGpuGb,
    total_gb: totalGb,
    fits_in_vram: fits,
    fits,
    utilization_percent: utilizationPercent,
    breakdown: {
      model_weights_gb: weightsPerGpuGb,
      kv_cache_gb: kvCachePerGpuGb,
      activations_gb: activationsPerGpuGb,
      per_gpu_gb: perGpuGb,
      total_gb: totalGb,
    },
  };
};

export const registerSystemRoutes = defineRoutes((app, context) => {
  const checkService = (
    host: string,
    port: number,
    timeoutMs = SYSTEM_DEFAULT_SERVICE_CHECK_TIMEOUT_MS,
  ): Effect.Effect<boolean> =>
    Effect.callback<boolean>((resume, signal) => {
      const socket = connect({ port, host });
      let settled = false;
      const cleanup = (): void => {
        socket.removeListener("connect", onConnect);
        socket.removeListener("timeout", onTimeout);
        socket.removeListener("error", onError);
        signal.removeEventListener("abort", onAbort);
        socket.destroy();
      };
      const finalize = (result: boolean): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resume(Effect.succeed(result));
      };
      const onConnect = (): void => finalize(true);
      const onTimeout = (): void => finalize(false);
      const onError = (): void => finalize(false);
      const onAbort = (): void => finalize(false);

      socket.setTimeout(timeoutMs);
      socket.once("connect", onConnect);
      socket.once("timeout", onTimeout);
      socket.once("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
      return Effect.sync(cleanup);
    });

  return mergeRoutes(
    effectRoute(app.get, "/status", (ctx) =>
      Effect.gen(function* () {
        const current = yield* findObservedInferenceProcess(context, "status");
        return ctx.json({
          running: Boolean(current),
          process: current,
          inference_port: context.config.inference_port,
          launching: context.compute.model.launchingRecipeId(),
          launch_failures: context.launchFailureBudget.listActive(),
        });
      }),
    ),

    effectRoute(app.get, "/gpus", (ctx) =>
      getGpuInfo().pipe(Effect.map((gpus) => ctx.json({ count: gpus.length, gpus }))),
    ),

    effectRoute(app.get, "/compat", (ctx) =>
      Effect.gen(function* () {
        const known = yield* findObservedInferenceProcess(context, "compat");
        const runtime = yield* context.compute.host().pipe(Effect.flatMap(getSystemRuntimeInfo));
        const portOpen = yield* checkService(
          SYSTEM_SERVICE_CHECK_HOST,
          context.config.inference_port,
          SYSTEM_COMPAT_SERVICE_CHECK_TIMEOUT_MS,
        );
        return ctx.json(
          buildCompatibilityReport({
            runtime,
            inference_port: context.config.inference_port,
            inference_port_open: portOpen,
            inference_process_known: Boolean(known),
            gpu_monitoring: runtime.gpu_monitoring,
          }),
        );
      }),
    ),

    effectRoute(app.post, "/vram-calculator", (ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, VramCalculatorBodySchema);
        const model = yield* loadModel(context.config.models_dir, body.model.trim());
        const config = yield* loadModelConfig(model.resolved);
        const gpus = yield* getGpuInfo();
        const capacities = gpus.map((gpu) => gpu.memory_total_mb / 1024);
        return ctx.json(buildVramResult(body, config, model.weightsBytes, capacities));
      }),
    ),

    effectRoute(app.get, "/config", (ctx) =>
      Effect.gen(function* () {
        const services: SystemConfigResponse["services"] = [];
        services.push({
          name: "Controller",
          port: context.config.port,
          internal_port: context.config.port,
          protocol: "http",
          status: "running",
          description: "Controller service (Bun/Hono)",
        });

        const current = yield* findObservedInferenceProcess(context, "config");
        const inferenceStatus = current ? "running" : "stopped";

        services.push({
          name: "Inference runtime",
          port: context.config.inference_port,
          internal_port: context.config.inference_port,
          protocol: "http",
          status: inferenceStatus,
          description: "Inference backend (vLLM, SGLang, llama.cpp, or MLX)",
        });

        const frontendReachable = yield* checkService("localhost", 3000);
        services.push({
          name: "Frontend",
          port: 3000,
          internal_port: 3000,
          protocol: "http",
          status: frontendReachable ? "running" : "stopped",
          description: "Next.js web UI",
        });

        const runtime = yield* context.compute.host().pipe(Effect.flatMap(getSystemRuntimeInfo));

        const payload: SystemConfigResponse = {
          config: {
            host: context.config.host,
            port: context.config.port,
            inference_port: context.config.inference_port,
            api_key_configured: Boolean(context.config.api_key),
            models_dir: context.config.models_dir,
            data_dir: context.config.data_dir,
            db_path: context.config.db_path,
          },
          services,
          environment: {
            controller_url: `http://${hostname()}:${context.config.port}`,
            inference_url: `http://${hostname()}:${context.config.inference_port}`,
            frontend_url: `http://${hostname()}:3000`,
          },
          runtime,
        };

        return ctx.json(payload);
      }),
    ),

    registerMonitoringRoutes(app, context),
    registerLogsRoutes(app, context),
    registerUsageRoutes(app, context),
  );
});
