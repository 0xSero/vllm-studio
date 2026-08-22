import type {
  CompatibilityCheck,
  CompatibilityReport,
  RuntimeGpuMonitoringTool,
  RuntimeRocmSmiTool,
  SystemRuntimeInfo,
} from "../../models/types";
import { Effect } from "effect";
import { runCommandAsyncEffect } from "../../../core/command";
import { resolveAmdSmiBinary, resolveNvidiaSmiBinary, resolveRocmSmiBinary } from "./smi-tools";

type GpuMonitoringProbe = { available: boolean; tool: RuntimeGpuMonitoringTool | null };

const toEvidence = (lines: Array<string | null | undefined>): string | null => {
  const filtered = lines.filter((line): line is string => Boolean(line && line.trim()));
  return filtered.length ? filtered.join("\n") : null;
};

const probe = (binary: string, args: string[]): Effect.Effect<boolean> =>
  runCommandAsyncEffect(binary, args, { timeoutMs: 2_000 }).pipe(
    Effect.map((result) => result.status === 0),
  );

/** The liveness probe each ROCm SMI tool answers to. */
const ROCM_PROBES: Record<RuntimeRocmSmiTool, { resolve: () => string | null; args: string[] }> = {
  "amd-smi": { resolve: resolveAmdSmiBinary, args: ["version"] },
  "rocm-smi": { resolve: resolveRocmSmiBinary, args: ["--showproductname"] },
};

export const probeGpuMonitoring = (
  kind: SystemRuntimeInfo["platform"]["kind"],
  rocmTool: RuntimeRocmSmiTool | null,
): Effect.Effect<GpuMonitoringProbe> => {
  if (kind === "cuda") {
    const binary = resolveNvidiaSmiBinary();
    if (!binary) return Effect.succeed({ available: false, tool: "nvidia-smi" });
    return probe(binary, ["--query-gpu=name", "--format=csv,noheader,nounits"]).pipe(
      Effect.map((available) => ({ available, tool: "nvidia-smi" as const })),
    );
  }

  if (kind !== "rocm") return Effect.succeed({ available: false, tool: null });

  const preferred = rocmTool ?? (resolveAmdSmiBinary() ? "amd-smi" : null);
  if (preferred) {
    const binary = ROCM_PROBES[preferred].resolve();
    if (!binary) return Effect.succeed({ available: false, tool: preferred });
    return probe(binary, ROCM_PROBES[preferred].args).pipe(
      Effect.map((available) => ({ available, tool: preferred })),
    );
  }

  return Effect.gen(function* () {
    for (const tool of ["amd-smi", "rocm-smi"] as const) {
      const binary = ROCM_PROBES[tool].resolve();
      if (binary && (yield* probe(binary, ROCM_PROBES[tool].args))) {
        return { available: true, tool };
      }
    }
    return { available: false, tool: null };
  });
};

const NO_GPU_FIX: Record<string, string> = {
  rocm: "Verify ROCm is installed and GPU tools are available (amd-smi/rocm-smi).",
  cuda: "Verify NVIDIA drivers are installed and nvidia-smi is accessible.",
};

export const buildCompatibilityReport = (args: {
  runtime: SystemRuntimeInfo;
  inference_port: number;
  inference_port_open: boolean;
  inference_process_known: boolean;
  gpu_monitoring: GpuMonitoringProbe;
}): CompatibilityReport => {
  const { runtime } = args;
  const gpuMonitoring = args.gpu_monitoring;
  const backends = runtime.backends;

  // Each entry is `[should report, the check]`; only the flagged ones reach the report.
  const candidates: Array<[boolean, CompatibilityCheck]> = [
    [
      runtime.gpus.count === 0,
      {
        id: "gpu.none-detected",
        severity: "warn",
        message: "No GPUs detected by the controller.",
        evidence: toEvidence([
          `platform.kind=${runtime.platform.kind}`,
          `gpus.count=${runtime.gpus.count}`,
        ]),
        suggested_fix:
          NO_GPU_FIX[runtime.platform.kind] ??
          "Verify GPU drivers are installed and set LOCAL_STUDIO_GPU_SMI_TOOL if needed.",
      },
    ],
    [
      runtime.platform.kind === "rocm" && !runtime.platform.torch.torch_hip,
      {
        id: "torch.rocm-missing-hip",
        severity: "error",
        message:
          "ROCm platform detected, but PyTorch does not report HIP support (torch.version.hip is null).",
        evidence: toEvidence([
          `torch_version=${runtime.platform.torch.torch_version ?? "null"}`,
          `torch_hip=${runtime.platform.torch.torch_hip ?? "null"}`,
        ]),
        suggested_fix:
          "Install a ROCm-enabled PyTorch build that matches your ROCm version, and ensure the controller is using that Python environment.",
      },
    ],
    [
      runtime.platform.kind === "rocm" && !gpuMonitoring.available,
      {
        id: "gpu-monitoring.rocm-unavailable",
        severity: "warn",
        message: "ROCm platform detected, but GPU monitoring tooling is not accessible.",
        evidence: toEvidence([`tool=${gpuMonitoring.tool ?? "null"}`]),
        suggested_fix:
          "Ensure `amd-smi` or `rocm-smi` is installed and on PATH, or set AMD_SMI_PATH/ROCM_SMI_PATH.",
      },
    ],
    [
      runtime.platform.kind === "cuda" && !gpuMonitoring.available,
      {
        id: "gpu-monitoring.cuda-unavailable",
        severity: "warn",
        message:
          "CUDA platform detected, but nvidia-smi is not accessible (GPU telemetry may be unavailable).",
        evidence: toEvidence([`tool=${gpuMonitoring.tool ?? "nvidia-smi"}`]),
        suggested_fix:
          "Ensure NVIDIA drivers are installed and nvidia-smi is on PATH (snap-installed bun can block access).",
      },
    ],
    [
      args.inference_port_open && !args.inference_process_known,
      {
        id: "inference.port-in-use",
        severity: "error",
        message: "Inference port is in use by an unknown process.",
        evidence: toEvidence([`inference_port=${args.inference_port}`]),
        suggested_fix:
          "Stop the process using the inference port, or change LOCAL_STUDIO_INFERENCE_PORT to a free port.",
      },
    ],
    [
      !backends.vllm.installed &&
        !backends.sglang.installed &&
        !backends.llamacpp.installed &&
        !(backends.mlx?.installed ?? false),
      {
        id: "backends.none-installed",
        severity: "info",
        message: "No inference runtime backends appear to be installed.",
        evidence: null,
        suggested_fix:
          "Install at least one backend runtime (vLLM, SGLang, llama.cpp, or MLX), then restart the controller.",
      },
    ],
  ];

  return {
    platform: { kind: runtime.platform.kind },
    gpu_monitoring: gpuMonitoring,
    torch: runtime.platform.torch,
    backends,
    checks: candidates.filter(([flagged]) => flagged).map(([, check]) => check),
  };
};
