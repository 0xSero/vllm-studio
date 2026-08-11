import { objectRecord, stringArray, stringField, type ParseResult } from "./agent-turn";

export type FsEntry = {
  name: string;
  path: string;
  rel: string;
  kind: "file" | "directory";
  size?: number;
  modifiedAt?: string;
};

export type FileComment = { id: string; line: number; body: string; createdAt: string };
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
  | { action: "commit"; message: string; paths: string[] }
  | { action: "push" };

export function parseGitAction(input: unknown): ParseResult<GitAction> {
  const body = objectRecord(input);
  if (!body || typeof body.action !== "string") return { ok: false, error: "action is required" };
  if (body.action === "init" || body.action === "push")
    return { ok: true, value: { action: body.action } };
  if (body.action === "checkout") {
    const ref = stringField(body, "ref", true);
    return ref.ok ? { ok: true, value: { action: "checkout", ref: ref.value! } } : ref;
  }
  if (body.action === "commit") {
    const message = stringField(body, "message", true);
    return message.ok
      ? {
          ok: true,
          value: { action: "commit", message: message.value!, paths: stringArray(body.paths) },
        }
      : message;
  }
  return { ok: false, error: `Unsupported git action: ${body.action}` };
}

export type TerminalRunRequest = { command: string };
export type TerminalRunResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

export function parseTerminalRunRequest(input: unknown): ParseResult<TerminalRunRequest> {
  const body = objectRecord(input);
  if (!body) return { ok: false, error: "Invalid JSON body" };
  const command = stringField(body, "command", true);
  return command.ok ? { ok: true, value: { command: command.value! } } : command;
}
