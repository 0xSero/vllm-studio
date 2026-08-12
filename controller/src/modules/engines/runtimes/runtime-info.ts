import { arch, platform as operatingSystem } from "node:os";
import { Effect, Fiber, Semaphore } from "effect";
import type {
  ProcessInfo,
  RuntimeCudaInfo,
  RuntimePlatformInfo,
  RuntimePlatformKind,
  RuntimeTorchBuildInfo,
  SystemRuntimeInfo,
} from "../../models/types";
import type { Config } from "../../../config/env";
import { runCommandAsyncEffect } from "../../../core/command";
import { getGpuInfo, queryNvidiaSmiSnapshot } from "../../system/platform/gpu";
import { extractCudaVersion } from "./cuda-version";
import { getVllmRuntimeInfo } from "./vllm-runtime";
import { probeGpuMonitoring } from "../../system/platform/compatibility-report";
import { getRocmInfo, resolveRocmSmiTool } from "../../system/platform/rocm-info";
import { resolveNvidiaSmiBinary } from "../../system/platform/smi-tools";
import { getTorchBuildInfo } from "../../system/platform/torch-info";
import type { EngineOperationError } from "../engine-spec";
import { getRuntimeTargets, runtimeTargetsToBackendInfo } from "./runtime-targets";
import { isUpgradeCommandConfigured, CUDA_UPGRADE_ENV } from "./upgrade-config";

const SYSTEM_RUNTIME_CACHE_TTL_MS = 30_000;
let systemRuntimeCache: { expiresAt: number; value: SystemRuntimeInfo } | null = null;
let systemRuntimeInFlight: Fiber.Fiber<SystemRuntimeInfo, EngineOperationError> | null = null;
const systemRuntimeSemaphore = Semaphore.makeUnsafe(1);

export const getSystemRuntimeInfo = (
  config: Config,
  runningProcess?: ProcessInfo | null,
): Effect.Effect<SystemRuntimeInfo, EngineOperationError> =>
  Effect.gen(function* () {
    const fiber = yield* systemRuntimeSemaphore.withPermit(
      Effect.gen(function* () {
        const now = Date.now();
        if (systemRuntimeCache && systemRuntimeCache.expiresAt > now) {
          return yield* Effect.forkChild(Effect.succeed(systemRuntimeCache.value));
        }
        if (systemRuntimeInFlight) return systemRuntimeInFlight;
        const running = yield* computeSystemRuntimeInfo(config, runningProcess).pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              systemRuntimeCache = {
                expiresAt: Date.now() + SYSTEM_RUNTIME_CACHE_TTL_MS,
                value,
              };
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              systemRuntimeInFlight = null;
            }),
          ),
          Effect.forkDetach({ startImmediately: true }),
        );
        systemRuntimeInFlight = running;
        return running;
      }),
    );
    return yield* Fiber.join(fiber);
  });

export const shutdownRuntimeInfo = (): Effect.Effect<void> =>
  Effect.suspend(() => {
    const fiber = systemRuntimeInFlight;
    systemRuntimeInFlight = null;
    systemRuntimeCache = null;
    return fiber ? Fiber.interrupt(fiber).pipe(Effect.asVoid) : Effect.void;
  });

const computeSystemRuntimeInfo = (
  config: Config,
  runningProcess?: ProcessInfo | null,
): Effect.Effect<SystemRuntimeInfo, EngineOperationError> =>
  Effect.gen(function* () {
    const forcedSmiTool = process.env["LOCAL_STUDIO_GPU_SMI_TOOL"];
    const hasNvidiaSmi = Boolean(resolveNvidiaSmiBinary());
    const rocmSmiTool = resolveRocmSmiTool();
    const hasRocmSmi = Boolean(rocmSmiTool);
    const nvidiaAllowed = !forcedSmiTool?.trim() || forcedSmiTool.trim() === "nvidia-smi";

    const vllmFiber = yield* Effect.forkChild(getVllmRuntimeInfo());
    const [nvidiaSnapshot, vllmInfo, targets, torch, detectedGpus] = yield* Effect.all(
      [
        nvidiaAllowed && hasNvidiaSmi ? queryNvidiaSmiSnapshot() : Effect.succeed(null),
        Fiber.join(vllmFiber),
        getRuntimeTargets(config, runningProcess),
        Fiber.join(vllmFiber).pipe(
          Effect.flatMap((vllmInfo) =>
            getTorchBuildInfo(config.sglang_python || vllmInfo.python_path || "python3"),
          ),
        ),
        getGpuInfo(),
      ] as const,
      { concurrency: "unbounded" },
    );
    const gpus =
      nvidiaSnapshot && nvidiaSnapshot.gpus.length > 0 ? nvidiaSnapshot.gpus : detectedGpus;
    const types = Array.from(
      new Set(gpus.map((gpu) => gpu.name).filter((name) => name && name !== "Unknown")),
    );
    const kind = detectPlatformKind({
      forcedSmiTool,
      torch,
      hasNvidiaSmi,
      hasRocmSmi,
      isAppleSilicon: operatingSystem() === "darwin" && arch() === "arm64",
    });
    const rocm = kind === "rocm" ? yield* getRocmInfo(rocmSmiTool) : null;
    const platform: RuntimePlatformInfo = {
      kind,
      vendor:
        kind === "cuda" ? "nvidia" : kind === "rocm" ? "amd" : kind === "metal" ? "apple" : null,
      rocm,
      torch,
    };
    const [gpuMonitoring, cuda] = yield* Effect.all(
      [
        kind === "metal"
          ? Effect.succeed({ available: false, tool: "apple-metal" as const })
          : kind === "cuda" && nvidiaSnapshot
            ? Effect.succeed({ available: nvidiaSnapshot.available, tool: "nvidia-smi" as const })
            : probeGpuMonitoring(kind, rocmSmiTool),
        kind === "cuda"
          ? getCudaInfo(nvidiaSnapshot?.driverVersion ?? null)
          : Effect.succeed({
              driver_version: null,
              cuda_version: null,
              upgrade_command_available: false,
            }),
      ] as const,
      { concurrency: "unbounded" },
    );
    return {
      platform,
      gpu_monitoring: gpuMonitoring,
      cuda,
      gpus: { count: gpus.length, types },
      backends: {
        vllm: {
          installed: vllmInfo.installed,
          version: vllmInfo.version,
          python_path: vllmInfo.python_path,
          binary_path: vllmInfo.vllm_bin,
          upgrade_command_available: Boolean(vllmInfo.python_path),
        },
        sglang: runtimeTargetsToBackendInfo(targets, "sglang"),
        llamacpp: runtimeTargetsToBackendInfo(targets, "llamacpp"),
        mlx: runtimeTargetsToBackendInfo(targets, "mlx"),
      },
    };
  });

export const detectPlatformKind = (args: {
  forcedSmiTool: string | undefined;
  torch: RuntimeTorchBuildInfo;
  hasNvidiaSmi: boolean;
  hasRocmSmi: boolean;
  isAppleSilicon?: boolean;
}): RuntimePlatformKind => {
  const forced = args.forcedSmiTool?.trim();
  if (forced === "nvidia-smi") return "cuda";
  if (forced === "amd-smi" || forced === "rocm-smi") return "rocm";
  if (args.torch.torch_hip) return "rocm";
  if (args.torch.torch_cuda) return "cuda";
  if (args.hasNvidiaSmi) return "cuda";
  if (args.hasRocmSmi) return "rocm";
  if (args.isAppleSilicon) return "metal";
  return "unknown";
};

const extractNvccVersion = (output: string): string | null => {
  const match = output.match(/release\s+([0-9.]+)/i);
  if (match) return match[1] ?? null;
  return null;
};

export const getCudaInfo = (
  knownDriverVersion: string | null = null,
): Effect.Effect<RuntimeCudaInfo> =>
  Effect.gen(function* () {
    const nvidiaSmi = process.env["NVIDIA_SMI_PATH"] || "nvidia-smi";
    let driverVersion = knownDriverVersion;
    let cudaVersion: string | null = null;
    if (!driverVersion) {
      const driverResult = yield* runCommandAsyncEffect(
        nvidiaSmi,
        ["--query-gpu=driver_version", "--format=csv,noheader,nounits"],
        { timeoutMs: 5_000 },
      );
      if (driverResult.status === 0 && driverResult.stdout) {
        driverVersion = driverResult.stdout.split("\n")[0]?.trim() || null;
      }
    }
    const smiResult = yield* runCommandAsyncEffect(nvidiaSmi, [], { timeoutMs: 5_000 });
    if (smiResult.status === 0) {
      cudaVersion = extractCudaVersion(smiResult.stdout) ?? extractCudaVersion(smiResult.stderr);
    }
    if (!cudaVersion) {
      const nvccResult = yield* runCommandAsyncEffect("nvcc", ["--version"], { timeoutMs: 5_000 });
      if (nvccResult.status === 0) {
        cudaVersion =
          extractNvccVersion(nvccResult.stdout) ?? extractNvccVersion(nvccResult.stderr);
      }
    }
    return {
      driver_version: driverVersion,
      cuda_version: cudaVersion,
      upgrade_command_available: isUpgradeCommandConfigured(CUDA_UPGRADE_ENV),
    };
  });
