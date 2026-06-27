import { join } from "node:path";
import type { Config } from "../../../config/env";
import type { EngineBackend } from "../../shared/system-types";

export type ManagedPythonBackend = Extract<EngineBackend, "vllm" | "sglang" | "mlx">;

export const isManagedPythonBackend = (
  backend: EngineBackend | string,
): backend is ManagedPythonBackend =>
  backend === "vllm" || backend === "sglang" || backend === "mlx";

export const managedVenvName = (backend: ManagedPythonBackend): string => `${backend}-latest`;

export const managedVenvPath = (
  config: Pick<Config, "data_dir">,
  backend: ManagedPythonBackend,
): string => join(config.data_dir, "runtime", "venvs", managedVenvName(backend));

export const managedVenvPython = (
  config: Pick<Config, "data_dir">,
  backend: ManagedPythonBackend,
): string => join(managedVenvPath(config, backend), "bin", "python");
