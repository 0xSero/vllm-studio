import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";
import { LLAMACPP_HELP_TIMEOUT_MS } from "../configs";
import type { ProcessInfo, Recipe } from "../../models/types";
import type { RuntimeBackendInfo, RuntimeUpgradeResult } from "@local-studio/contracts/system";
import { getLlamacppRuntimeInfo } from "../runtimes/runtime-info";
import { getExtraArgument } from "../argument-utilities";
import type { ConfigHelpResult, EngineSpec, InstallOptions } from "../engine-spec";
import {
  getUpgradeCommandFromEnvironment,
  LLAMACPP_UPGRADE_ENV,
  runEnvironmentUpgradeCommand,
} from "../runtimes/upgrade-config";
import { installManagedLlamacpp, managedLlamaServerPath } from "../runtimes/managed-llamacpp";

const isAllowedLlamaServerBinary = (value: string): boolean => {
  const name = value.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? value.toLowerCase();
  return name === "llama-server" || name === "llama-server.exe";
};

export const resolveLlamaBinary = (recipe: Recipe, config: Config): string => {
  const override = getExtraArgument(recipe.extra_args, "llama_bin") ?? config.llama_bin;
  if (typeof override === "string" && override.trim()) {
    if (override.split(/[\\/]+/).includes("..")) {
      throw new Error("Invalid llama_bin: path traversal is not allowed");
    }
    if (!isAllowedLlamaServerBinary(override)) {
      throw new Error("Invalid llama_bin: only llama-server executables are allowed");
    }
    const resolved = resolveBinary(override);
    if (resolved) return resolved;
    throw new Error(`Invalid llama_bin: executable "${override}" was not found`);
  }
  const managed = managedLlamaServerPath(config);
  return resolveBinary("llama-server") ?? (existsSync(managed) ? managed : "llama-server");
};

const getRuntimeInfo = (
  config: Config,
  _runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Effect.Effect<RuntimeBackendInfo> => getLlamacppRuntimeInfo(config);

const getConfigHelp = (config: Config): Effect.Effect<ConfigHelpResult> => {
  const configured = config.llama_bin || "llama-server";
  const resolved =
    resolveBinary(configured) ?? (existsSync(configured) ? resolve(configured) : null);
  const binary = resolved ?? configured;
  return runCommandAsyncEffect(binary, ["--help"], { timeoutMs: LLAMACPP_HELP_TIMEOUT_MS }).pipe(
    Effect.map((result) =>
      result.status !== 0
        ? {
            config: result.stdout || null,
            error: result.stderr || "Failed to fetch llama.cpp config",
          }
        : { config: result.stdout || null, error: null },
    ),
  );
};

export const llamacppSpec: EngineSpec = {
  id: "llamacpp",
  cliBinary: "llama-server",
  managedPackageSpec: () => "llama.cpp",
  install: (options: InstallOptions) => {
    const command = getUpgradeCommandFromEnvironment(LLAMACPP_UPGRADE_ENV);
    return command
      ? runEnvironmentUpgradeCommand(command, options.onSpawn)
      : installManagedLlamacpp(options);
  },
  getRuntimeInfo,
  getConfigHelp,
};
