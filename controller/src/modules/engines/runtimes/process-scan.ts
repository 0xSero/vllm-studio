import type { Backend } from "@local-studio/contracts/recipes";
import { realProcessRunner } from "../../../core/command";
import { hasCliServeInvocation, hasModuleInvocation } from "../argument-utilities";

/**
 * Discovery of manually-started engines: one `ps` sweep plus argv fingerprints. This is
 * how a hand-launched `llama-server` or `vllm serve` shows up as a runtime target even
 * though the controller did not start it. Read-only — nothing here ever signals a pid.
 */

export interface ScannedProcess {
  readonly pid: number;
  readonly args: string[];
}

const splitCommand = (command: string): string[] => {
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ""));
};

export const listProcesses = (): ScannedProcess[] => {
  try {
    const result = realProcessRunner.runSync("ps", ["-eo", "pid=,args="]);
    if (result.status !== 0) return [];
    return result.stdout
      .trim()
      .split("\n")
      .flatMap((line) => {
        const match = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!match) return [];
        const args = splitCommand(match[2] ?? "");
        return args.length > 0 ? [{ pid: Number(match[1]), args }] : [];
      })
      .filter((entry) => entry.pid > 0);
  } catch {
    return [];
  }
};

export const detectBackend = (args: string[]): Backend | null => {
  if (args.length === 0) return null;
  if (hasModuleInvocation(args, "vllm.entrypoints.openai.api_server")) return "vllm";
  if (hasCliServeInvocation(args, "vllm")) return "vllm";
  if (hasModuleInvocation(args, "sglang.launch_server")) return "sglang";
  if (hasCliServeInvocation(args, "sglang")) return "sglang";
  if (args.some((argument) => argument.includes("llama-server"))) return "llamacpp";
  // Subsumes the exact `-m mlx_lm.server` form.
  if (args.some((argument) => argument.includes("mlx_lm.server"))) return "mlx";
  return null;
};
