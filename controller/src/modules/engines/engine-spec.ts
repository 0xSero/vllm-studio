import type { ChildProcess } from "node:child_process";
import { Schema, type Effect } from "effect";
import type { Config } from "../../config/env";
import type { ProcessInfo } from "../models/types";
import type {
  ComputeEngineSpec,
  EngineId,
  EngineRuntimeKind,
  EngineSupport,
  HostProfile,
  LaunchPlan,
  LaunchRequest,
} from "../compute/contracts";
import { applyDevices } from "../compute/engines/devices";
import { exllamav3 } from "../compute/engines/exllamav3";
import type {
  EngineBackend,
  RuntimeBackendInfo,
  RuntimeUpgradeResult,
} from "@local-studio/contracts/system";
import type { InstallProgressUpdate } from "./runtimes/managed-venv";

export type { InstallProgressUpdate };

export interface InstallOptions {
  config: Config;
  version?: string | undefined;
  pythonPath?: string | null | undefined;
  preferBundled?: boolean | undefined;
  createManagedVenv?: boolean | undefined;
  onProgress?: ((update: InstallProgressUpdate) => void) | undefined;
  onSpawn?: ((child: ChildProcess) => void) | undefined;
}
import { llamacppSpec, mlxSpec, sglangSpec, vllmSpec } from "./specs/backend-specs";

export interface BinaryProbeResult {
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  pythonPath?: string | null;
  message?: string;
}

export interface ConfigHelpResult {
  config: string | null;
  error: string | null;
}

export class EngineOperationError extends Schema.TaggedErrorClass<EngineOperationError>()(
  "EngineOperationError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export interface EngineSpec extends Omit<ComputeEngineSpec, "id"> {
  readonly id: EngineBackend;
  readonly cliBinary: string | null;
  managedPackageSpec: (version?: string | null) => string;
  install: (options: InstallOptions) => Effect.Effect<RuntimeUpgradeResult, EngineOperationError>;
  probeBinary?: (binary: string) => Effect.Effect<BinaryProbeResult, EngineOperationError>;
  resolvePythonPath?: (config: Config) => string | null;
  getRuntimeInfo?: (
    config: Config,
    runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
  ) => Effect.Effect<RuntimeBackendInfo, EngineOperationError>;
  getConfigHelp?: (config: Config) => Effect.Effect<ConfigHelpResult, EngineOperationError>;
}

const SPECS = {
  vllm: vllmSpec,
  sglang: sglangSpec,
  llamacpp: llamacppSpec,
  mlx: mlxSpec,
  exllamav3,
} satisfies Readonly<Record<EngineId, ComputeEngineSpec>>;

export const getEngineSpec = (backend: EngineBackend): EngineSpec => SPECS[backend];

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

export { vllmSpec, sglangSpec, llamacppSpec, mlxSpec };
