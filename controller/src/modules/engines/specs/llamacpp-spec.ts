import type { Config } from "../../../config/env";
import { resolveBinary } from "../../../core/command";
import type { Recipe } from "../../models/types";
import type { RuntimeBackendInfo } from "../../shared/system-types";
import { getLlamacppRuntimeInfo } from "../runtimes/runtime-info";
import { isUpgradeCommandConfigured, LLAMACPP_UPGRADE_ENV } from "../runtimes/upgrade-config";
import {
  appendLlamacppArguments,
  getExtraArgument,
  resolveLlamaBinary,
} from "../process/backend-builder";
import { stripForeignFlagKeys } from "../../../../../shared/contracts/engine-args";
import { extractFlag } from "../arg-utils";
import type {
  ConfigHelpResult,
  EngineSpec,
} from "../engine-spec";

const buildLlamacppCommand = (recipe: Recipe, config: Config): string[] => {
  const command: string[] = [resolveLlamaBinary(recipe, config)];
  command.push("--model", recipe.model_path, "--host", recipe.host, "--port", String(recipe.port));
  if (recipe.served_model_name) {
    command.push("--alias", recipe.served_model_name);
  }
  const ctxOverride = getExtraArgument(recipe.extra_args, "ctx-size");
  if (!ctxOverride && recipe.max_model_len > 0) {
    command.push("--ctx-size", String(recipe.max_model_len));
  }
  return appendLlamacppArguments(command, stripForeignFlagKeys("llamacpp", recipe.extra_args));
};

const managedPackageSpec = (_version?: string | null): string => {
  // llama.cpp is built from source or installed as a binary; no pip package.
  return "configured llama.cpp upgrade command";
};

const detectInvocation = (args: string[]): boolean => {
  const joined = args.join(" ");
  if (
    joined.includes("llama-server") ||
    joined.includes("llama.cpp") ||
    (args[0]?.includes("llama") && joined.includes("-m "))
  ) {
    return true;
  }
  return false;
};

const extractModelPath = (args: string[]): string | null => {
  return extractFlag(args, "-m") ?? extractFlag(args, "--model") ?? null;
};

const extractServedModelName = (args: string[]): string | null => {
  return extractFlag(args, "--alias") ?? extractFlag(args, "-a") ?? null;
};

const getRuntimeInfoAsync = async (
  config: Config,
  _runningProcess?: Pick<import("../../models/types").ProcessInfo, "pid" | "backend"> | null,
): Promise<RuntimeBackendInfo> => {
  return getLlamacppRuntimeInfo(config);
};

const getConfigHelp = async (config: Config): Promise<ConfigHelpResult> => {
  const configured = config.llama_bin || "llama-server";
  const resolved = resolveBinary(configured) ?? configured;
  const { runCommandAsync } = await import("../../../core/command");
  const result = await runCommandAsync(resolved, ["--help"], { timeoutMs: 15_000 });
  if (result.status !== 0) {
    return { config: result.stdout || null, error: result.stderr || "Failed to fetch llama.cpp config" };
  }
  return { config: result.stdout || null, error: null };
};

export const llamacppSpec: EngineSpec = {
  id: "llamacpp",
  healthPath: "/health",
  cliBinary: "llama-server",
  buildCommand: buildLlamacppCommand,
  managedPackageSpec,
  detectInvocation,
  extractModelPath,
  extractServedModelName,
  getRuntimeInfo: getRuntimeInfoAsync,
  getConfigHelp,
};
