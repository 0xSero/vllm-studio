import { Effect } from "effect";
import { runCommandAsyncEffect } from "../../../core/command";
import { getCudaInfo } from "./runtime-info";
import { getRocmInfo, resolveRocmSmiTool } from "../../system/platform/rocm-info";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";
import {
  CUDA_UPGRADE_ENV,
  getUpgradeCommandFromEnvironment,
  ROCM_UPGRADE_ENV,
} from "./upgrade-config";
import { RUNTIME_UPGRADE_TIMEOUT_MS } from "../configs";

export type { RuntimeUpgradeResult } from "@local-studio/contracts/system";

export interface RuntimeUpgradeOptions {
  version?: string;
  pythonPath?: string | null;
}

export const runPlatformUpgrade = (
  platform: "cuda" | "rocm",
  _options: RuntimeUpgradeOptions,
): Effect.Effect<RuntimeUpgradeResult> => {
  const envKey = platform === "cuda" ? CUDA_UPGRADE_ENV : ROCM_UPGRADE_ENV;
  const command = getUpgradeCommandFromEnvironment(envKey);
  if (!command)
    return Effect.succeed({
      success: false,
      version: null,
      output: null,
      error: `No ${platform.toUpperCase()} upgrade command configured. Set ${envKey}.`,
      used_command: null,
    });
  return Effect.gen(function* () {
    const result = yield* runCommandAsyncEffect(command, [], {
      timeoutMs: RUNTIME_UPGRADE_TIMEOUT_MS,
    });
    if (result.status !== 0) {
      return {
        success: false,
        version: null,
        output: result.stdout || null,
        error: result.timedOut
          ? `Upgrade command timed out after ${Math.round(RUNTIME_UPGRADE_TIMEOUT_MS / 60_000)} minutes`
          : result.stderr || "Upgrade command failed",
        used_command: command,
      };
    }
    const version = yield* platform === "cuda"
      ? getCudaInfo().pipe(Effect.map((info) => info.cuda_version || info.driver_version))
      : getRocmInfo(resolveRocmSmiTool()).pipe(
          Effect.map((info) => info.rocm_version || info.hip_version),
        );
    return {
      success: true,
      version,
      output: result.stdout || null,
      error: null,
      used_command: command,
    };
  });
};
