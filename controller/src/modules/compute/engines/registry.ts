import type {
  EngineId,
  ComputeEngineSpec,
  EngineSupport,
  HostProfile,
  LaunchPlan,
  LaunchRequest,
  EngineRuntimeKind,
} from "../contracts";
import { getEngineSpec } from "../../engines/engine-spec";
import { applyDevices } from "./devices";
import { exllamav3 } from "./exllamav3";

const SPECS = {
  vllm: getEngineSpec("vllm"),
  sglang: getEngineSpec("sglang"),
  llamacpp: getEngineSpec("llamacpp"),
  mlx: getEngineSpec("mlx"),
  exllamav3,
} satisfies Record<EngineId, ComputeEngineSpec>;

export const engineSpec = (id: EngineId): ComputeEngineSpec => SPECS[id];

export const allEngineSpecs: readonly ComputeEngineSpec[] = Object.values(SPECS);

export const availableEngines = (
  host: HostProfile,
): readonly { readonly id: EngineId; readonly support: EngineSupport }[] =>
  allEngineSpecs.map((spec) => ({ id: spec.id, support: spec.supports(host) }));

export const supportsRuntime = (
  id: EngineId,
  host: HostProfile,
  runtime: EngineRuntimeKind,
): boolean => {
  const support = SPECS[id].supports(host);
  return support.ok && support.runtimes.includes(runtime);
};

export const planLaunch = (request: LaunchRequest): LaunchPlan =>
  applyDevices(SPECS[request.engine].plan(request), request.host.accelerator);
