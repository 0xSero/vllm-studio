import type { GitAction, GitState } from "@/lib/agent/contracts/git";
import { safeJson } from "@/lib/agent/safe-json";

export async function loadGitState(cwd: string): Promise<GitState> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<GitState & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to load git state");
  return payload;
}

export async function runGitAction(cwd: string, action: GitAction): Promise<GitState> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  const payload = await safeJson<GitState & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Git action failed");
  return payload;
}
