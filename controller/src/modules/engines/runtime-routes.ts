import type { RouteRegistrar } from "../../http/route-registrar";
import { badRequest, notFound } from "../../core/errors";
import { optionalEnum, parseJsonObjectBody } from "../../core/validation";
import { getVllmConfigHelp, getVllmRuntimeInfo } from "./runtimes/vllm-runtime";
import { getCudaInfo } from "./runtimes/runtime-info";
import { getRocmInfo, resolveRocmSmiTool } from "../system/platform/rocm-info";
import { getEngineSpec } from "./engine-spec";
import {
  getDefaultRuntimeTarget,
  getRuntimeTargets,
  runtimeTargetToBackendInfo,
  selectRuntimeTarget,
} from "./runtimes/runtime-targets";
import {
  cancelEngineJob,
  createEngineJob,
  getEngineJob,
  listEngineJobs,
} from "./runtimes/engine-jobs";
import { createGetObservedProcess } from "./observed-process";

const RUNTIME_JOB_BACKENDS = ["vllm", "sglang", "llamacpp", "mlx", "cuda", "rocm"] as const;
const RUNTIME_JOB_TYPES = ["install", "update", "download", "inspect"] as const;

const parseRuntimeJobBody = async (ctx: {
  req: { json: () => Promise<unknown> };
}): Promise<{
  backend?: (typeof RUNTIME_JOB_BACKENDS)[number];
  targetId?: string;
  type?: (typeof RUNTIME_JOB_TYPES)[number];
  version?: string;
  preferBundled?: boolean;
}> => {
  const record = await parseJsonObjectBody(ctx);
  const backend = optionalEnum(record, "backend", RUNTIME_JOB_BACKENDS);
  const type = optionalEnum(record, "type", RUNTIME_JOB_TYPES, "job type");
  if ("command" in record || "args" in record) {
    throw badRequest("Request-controlled command or args are not allowed for runtime jobs");
  }
  return {
    ...(backend ? { backend } : {}),
    ...(typeof record["targetId"] === "string" ? { targetId: record["targetId"] } : {}),
    ...(type ? { type } : {}),
    ...(typeof record["version"] === "string" ? { version: record["version"] } : {}),
    ...(typeof record["prefer_bundled"] === "boolean"
      ? { preferBundled: record["prefer_bundled"] }
      : {}),
  };
};

export const registerRuntimeRoutes: RouteRegistrar = (app, context) => {
  const getObservedProcess = createGetObservedProcess(context);

  app.get("/runtime/targets", async (ctx) => {
    const current = await getObservedProcess("runtime.targets");
    const targets = await getRuntimeTargets(context.config, current);
    return ctx.json({ targets });
  });

  app.post("/runtime/targets/:targetId/select", async (ctx) => {
    const current = await getObservedProcess("runtime.target.select");
    const target = await selectRuntimeTarget(context.config, ctx.req.param("targetId"), current);
    if (!target) throw notFound("Runtime target not found");
    return ctx.json({ target });
  });

  app.post("/runtime/jobs", async (ctx) => {
    const body = await parseRuntimeJobBody(ctx);
    if (!body.backend) throw badRequest("backend is required");
    const current = await getObservedProcess("runtime.jobs");
    const job = createEngineJob(context.config, {
      backend: body.backend,
      type: body.type ?? "update",
      ...(body.targetId ? { targetId: body.targetId } : {}),
      ...(body.version ? { version: body.version } : {}),
      ...(body.preferBundled !== undefined ? { preferBundled: body.preferBundled } : {}),
      runningProcess: current,
    });
    return ctx.json({ job });
  });

  app.get("/runtime/jobs", async (ctx) => {
    return ctx.json({ jobs: listEngineJobs() });
  });

  app.get("/runtime/jobs/:jobId", async (ctx) => {
    const job = getEngineJob(ctx.req.param("jobId"));
    if (!job) throw notFound("Runtime job not found");
    return ctx.json({ job });
  });

  app.post("/runtime/jobs/:jobId/cancel", async (ctx) => {
    const job = cancelEngineJob(ctx.req.param("jobId"));
    if (!job) throw notFound("Runtime job not found");
    return ctx.json({ job });
  });

  app.get("/runtime/vllm", async (ctx) => {
    return ctx.json(await getVllmRuntimeInfo());
  });

  app.get("/runtime/vllm/config", async (ctx) => {
    const config = await getVllmConfigHelp();
    return ctx.json(config);
  });

  app.get("/runtime/llamacpp/config", async (ctx) => {
    const spec = getEngineSpec("llamacpp");
    if (!spec.getConfigHelp) throw notFound("llama.cpp config help not available");
    const config = await spec.getConfigHelp(context.config);
    return ctx.json(config);
  });

  app.get("/runtime/sglang", async (ctx) => {
    const current = await getObservedProcess("runtime.backend.sglang");
    const target = await getDefaultRuntimeTarget(context.config, "sglang", current);
    return ctx.json(runtimeTargetToBackendInfo(target));
  });

  app.get("/runtime/llamacpp", async (ctx) => {
    const current = await getObservedProcess("runtime.backend.llamacpp");
    const target = await getDefaultRuntimeTarget(context.config, "llamacpp", current);
    return ctx.json(runtimeTargetToBackendInfo(target));
  });

  app.get("/runtime/mlx", async (ctx) => {
    const current = await getObservedProcess("runtime.backend.mlx");
    return ctx.json(await getEngineSpec("mlx").getRuntimeInfo!(context.config, current));
  });

  app.get("/runtime/cuda", async (ctx) => {
    return ctx.json(getCudaInfo());
  });

  app.get("/runtime/rocm", async (ctx) => {
    const smiTool = resolveRocmSmiTool();
    return ctx.json(getRocmInfo(smiTool));
  });

  app.post("/runtime/:backend/upgrade", async (ctx) => {
    const backend = optionalEnum(
      { backend: ctx.req.param("backend") },
      "backend",
      RUNTIME_JOB_BACKENDS,
    );
    if (!backend) throw notFound("Unknown runtime backend");
    const body = await parseRuntimeJobBody(ctx);
    const current = await getObservedProcess(`runtime.upgrade.${backend}`);
    const job = createEngineJob(context.config, {
      backend,
      type: "update",
      ...(body.targetId ? { targetId: body.targetId } : {}),
      ...(body.version ? { version: body.version.trim() } : {}),
      ...(body.preferBundled !== undefined ? { preferBundled: body.preferBundled } : {}),
      runningProcess: current,
    });
    return ctx.json({ job_id: job.id, job });
  });
};
