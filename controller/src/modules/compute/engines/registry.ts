import type {
  EngineId,
  EngineSpec,
  EngineSupport,
  HostProfile,
  LaunchPlan,
  LaunchRequest,
  RuntimeKind,
} from "../contracts";
import { applyDevices } from "./devices";
import { exllamav3 } from "./exllamav3";
import { llamacpp } from "./llamacpp";
import { mlx } from "./mlx";
import { sglang } from "./sglang";
import { vllm } from "./vllm";

const SPECS: Readonly<Record<EngineId, EngineSpec>> = {
  vllm,
  sglang,
  llamacpp,
  mlx,
  exllamav3,
};

export const engineSpec = (id: EngineId): EngineSpec => SPECS[id];

export const allEngineSpecs: readonly EngineSpec[] = Object.values(SPECS);

/** Engines this host can actually run, with the runtimes available for each. */
export const availableEngines = (
  host: HostProfile,
): readonly { readonly id: EngineId; readonly support: EngineSupport }[] =>
  allEngineSpecs.map((spec) => ({ id: spec.id, support: spec.supports(host) }));

export const supportsRuntime = (
  id: EngineId,
  host: HostProfile,
  runtime: RuntimeKind,
): boolean => {
  const support = SPECS[id].supports(host);
  return support.ok && support.runtimes.includes(runtime);
};

/**
 * The one entry point that turns a request into a runnable plan. Device selection is
 * folded in here so no engine has to know how its accelerator is addressed, and no
 * launcher has to re-derive it.
 */
export const planLaunch = (request: LaunchRequest): LaunchPlan =>
  applyDevices(SPECS[request.engine].plan(request), request.host.accelerator);
