import type { RuntimeGpuMonitoringTool, RuntimeRocmSmiTool } from "../../models/types";
import { resolveBinary } from "../../../core/command";

type SmiPathEnvironment = "NVIDIA_SMI_PATH" | "AMD_SMI_PATH" | "ROCM_SMI_PATH";

const resolveConfiguredBinary = (envKey: SmiPathEnvironment, fallback: string): string | null => {
  const configured = process.env[envKey]?.trim();
  return resolveBinary(configured && configured.length > 0 ? configured : fallback);
};

export const resolveNvidiaSmiBinary = (): string | null =>
  resolveConfiguredBinary("NVIDIA_SMI_PATH", "nvidia-smi");

export const resolveAmdSmiBinary = (): string | null =>
  resolveConfiguredBinary("AMD_SMI_PATH", "amd-smi");

export const resolveRocmSmiBinary = (): string | null =>
  resolveConfiguredBinary("ROCM_SMI_PATH", "rocm-smi");

/** The tools LOCAL_STUDIO_GPU_SMI_TOOL may pin; `apple-metal` is detected, never forced. */
const FORCED_GPU_MONITORING_TOOLS = [
  "nvidia-smi",
  "amd-smi",
  "rocm-smi",
  "intel-sysfs",
] as const satisfies readonly RuntimeGpuMonitoringTool[];

export type ForcedGpuMonitoringTool = (typeof FORCED_GPU_MONITORING_TOOLS)[number];

export const resolveForcedGpuMonitoringTool = (): ForcedGpuMonitoringTool | null => {
  const forced = process.env["LOCAL_STUDIO_GPU_SMI_TOOL"]?.trim();
  return FORCED_GPU_MONITORING_TOOLS.find((tool) => tool === forced) ?? null;
};

export const resolveForcedRocmTool = (): RuntimeRocmSmiTool | null => {
  const forced = resolveForcedGpuMonitoringTool();
  return forced === "amd-smi" || forced === "rocm-smi" ? forced : null;
};
