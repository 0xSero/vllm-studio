import { spawn } from "node:child_process";
import type { OnboardingProbeResult } from "./agent-onboarding-contract";

const sshTargetPattern = /^(?:[a-zA-Z0-9._-]+@)?[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/;

export const isValidSshTarget = (target: string): boolean => sshTargetPattern.test(target.trim());

export function probeSshTarget(target: string): Promise<OnboardingProbeResult> {
  return new Promise((resolve) => {
    if (!isValidSshTarget(target)) {
      resolve({
        target: "remote-agent",
        ok: false,
        status: "invalid",
        detail: "SSH target is invalid",
        checkedAt: new Date().toISOString(),
      });
      return;
    }
    const child = spawn(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", target, "printf", "LOCAL_STUDIO_AGENT_OK"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk).slice(0, 256);
    });
    child.stderr.on("data", (chunk) => {
      error += String(chunk).slice(0, 512);
    });
    child.once("error", (cause) =>
      resolve({
        target: "remote-agent",
        ok: false,
        status: "unavailable",
        detail: cause.message,
        checkedAt: new Date().toISOString(),
      }),
    );
    child.once("close", (code) =>
      resolve({
        target: "remote-agent",
        ok: code === 0 && output.includes("LOCAL_STUDIO_AGENT_OK"),
        status: code === 0 ? "SSH 0" : `SSH ${code ?? "unknown"}`,
        detail: code === 0 ? target : error.trim() || "SSH verification failed",
        checkedAt: new Date().toISOString(),
      }),
    );
  });
}
