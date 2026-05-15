import { objectRecord, stringArray, stringField, type ParseResult } from "./common";

export type GitRef = { name: string; current: boolean; remote: boolean };
export type GitStatusEntry = { code: string; path: string };

export type GitState = {
  isRepo: boolean;
  branch: string | null;
  status: string[];
  entries: GitStatusEntry[];
  diff: string;
  additions: number;
  deletions: number;
  refs: GitRef[];
  hasUpstream: boolean;
  remoteUrl: string | null;
  prUrl: string | null;
  error?: string;
};

export type GitAction =
  | { action: "init" }
  | { action: "checkout"; ref: string }
  | { action: "createBranch"; branch: string }
  | { action: "commit"; message: string; paths: string[] }
  | { action: "push" };

export function parseGitAction(input: unknown): ParseResult<GitAction> {
  const body = objectRecord(input);
  if (!body || typeof body.action !== "string") {
    return { ok: false, error: "action is required" };
  }
  if (body.action === "init") return { ok: true, value: { action: "init" } };
  if (body.action === "push") return { ok: true, value: { action: "push" } };
  if (body.action === "checkout") {
    const ref = stringField(body, "ref", true);
    return ref.ok ? { ok: true, value: { action: "checkout", ref: ref.value! } } : ref;
  }
  if (body.action === "createBranch") {
    const branch = stringField(body, "branch", true);
    return branch.ok
      ? { ok: true, value: { action: "createBranch", branch: branch.value! } }
      : branch;
  }
  if (body.action === "commit") {
    const message = stringField(body, "message", true);
    if (!message.ok) return message;
    return {
      ok: true,
      value: { action: "commit", message: message.value!, paths: stringArray(body.paths) },
    };
  }
  return { ok: false, error: `Unsupported git action: ${body.action}` };
}
