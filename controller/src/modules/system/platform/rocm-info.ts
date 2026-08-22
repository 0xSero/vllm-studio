import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import type { RuntimeRocmInfo, RuntimeRocmSmiTool } from "../../models/types";
import { runCommandAsyncEffect } from "../../../core/command";
import { resolveAmdSmiBinary, resolveForcedRocmTool, resolveRocmSmiBinary } from "./smi-tools";
import {
  ROCM_UPGRADE_ENV,
  isUpgradeCommandConfigured,
} from "../../engines/runtimes/upgrade-config";

const parseHipccVersion = (output: string): string | null =>
  output.match(/HIP version\s*:\s*([0-9.]+)/i)?.[1] ?? null;

export const resolveRocmSmiTool = (): RuntimeRocmSmiTool | null => {
  const forced = resolveForcedRocmTool();
  if (forced) return forced;

  const amdSmi = resolveAmdSmiBinary();
  if (amdSmi) return "amd-smi";

  const rocmSmi = resolveRocmSmiBinary();
  if (rocmSmi) return "rocm-smi";

  return null;
};

const readRocmVersion = (): string | null => {
  const overridden = (process.env["LOCAL_STUDIO_ROCM_VERSION_FILE"] ?? "").trim();
  if (overridden) {
    try {
      if (existsSync(overridden)) return readFileSync(overridden, "utf-8").trim() || null;
    } catch {}
  }

  const rocmInfoDirectory = "/opt/rocm/.info";
  const candidates: string[] = [resolve(rocmInfoDirectory, "version")];

  try {
    for (const entry of readdirSync(rocmInfoDirectory)) {
      if (entry.toLowerCase().startsWith("version")) {
        candidates.push(resolve(rocmInfoDirectory, entry));
      }
    }
  } catch {}

  for (const filePath of candidates) {
    try {
      const content = readFileSync(filePath, "utf-8").trim();
      if (content) return content;
    } catch {}
  }

  return null;
};

export const getRocmInfo = (smiTool: RuntimeRocmSmiTool | null): Effect.Effect<RuntimeRocmInfo> =>
  Effect.gen(function* () {
    const rocmVersion = yield* Effect.sync(readRocmVersion);

    const hipcc = yield* runCommandAsyncEffect("hipcc", ["--version"], { timeoutMs: 3_000 });
    const hipVersion =
      hipcc.status === 0
        ? (parseHipccVersion(hipcc.stdout) ?? parseHipccVersion(hipcc.stderr))
        : null;

    const rocminfo = yield* runCommandAsyncEffect("rocminfo", [], { timeoutMs: 3_000 });
    const architectures =
      rocminfo.status === 0 && rocminfo.stdout
        ? (rocminfo.stdout.match(/gfx[0-9a-f]+/gi) ?? [])
        : [];
    const gpuArch = new Set(architectures.map((value) => value.toLowerCase()));

    return {
      rocm_version: rocmVersion,
      hip_version: hipVersion,
      smi_tool: smiTool,
      gpu_arch: Array.from(gpuArch),
      upgrade_command_available: isUpgradeCommandConfigured(ROCM_UPGRADE_ENV),
    };
  });
