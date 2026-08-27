import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Option, Schema } from "effect";
import {
  AGENT_TURN_BODY_LIMIT_BYTES,
  readJsonRequestWithinLimit,
} from "../../../../shared/agent/agent-turn-body";
import type { UnparsedValue } from "../../../../shared/agent/guards";
import { resolveAllowedWorkspace } from "../projects-store";
import { errorMessage, jsonError } from "./helpers";

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 15_000;
const GH_MAX_BUFFER = 4 * 1024 * 1024;
const PR_MERGE_BODY_LIMIT_BYTES = Math.min(AGENT_TURN_BODY_LIMIT_BYTES, 64 * 1024);
const MERGE_METHODS = new Set(["merge", "squash", "rebase"]);

const PR_VIEW_FIELDS = [
  "number",
  "title",
  "url",
  "state",
  "isDraft",
  "headRefName",
  "baseRefName",
  "additions",
  "deletions",
  "reviewRequests",
  "reviews",
  "comments",
  "body",
  "mergeable",
  "statusCheckRollup",
].join(",");
const PR_LIST_FIELDS = ["number", "title", "headRefName", "updatedAt", "isDraft"].join(",");

const RecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const ArraySchema = Schema.Array(Schema.Unknown);
type DynamicFields = typeof RecordSchema.Type;
type DynamicArray = typeof ArraySchema.Type;
const decodeRecord = Schema.decodeUnknownOption(RecordSchema);
const decodeArray = Schema.decodeUnknownOption(ArraySchema);
const decodeText = Schema.decodeUnknownOption(Schema.String);
const decodeNumber = Schema.decodeUnknownOption(Schema.Number);

function fields(value: UnparsedValue): DynamicFields {
  return Option.getOrElse(decodeRecord(value), () => ({}));
}
function array(value: UnparsedValue): DynamicArray {
  return Option.getOrElse(decodeArray(value), () => []);
}
function text(value: UnparsedValue): string | null {
  return Option.match(decodeText(value), {
    onNone: () => null,
    onSome: (decoded) => decoded.trim() || null,
  });
}
function integer(value: UnparsedValue): number {
  return Option.match(decodeNumber(value), {
    onNone: () => 0,
    onSome: (decoded) => (Number.isFinite(decoded) ? Math.trunc(decoded) : 0),
  });
}

export type CheckBucket = "pending" | "passing" | "failing";
export type PrCheck = {
  name: string;
  status: string;
  conclusion: string | null;
  bucket: CheckBucket;
};
export type PrChecksSummary = { pending: number; passing: number; failing: number; total: number };
type NormalizedChecks = { checks: PrCheck[]; summary: PrChecksSummary };

const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const PASSING_STATES = new Set(["SUCCESS"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

function classifyCheck(entry: DynamicFields): CheckBucket {
  const state = text(entry.state)?.toUpperCase();
  if (state) {
    if (PASSING_STATES.has(state)) return "passing";
    if (PENDING_STATES.has(state)) return "pending";
    return "failing";
  }
  const status = text(entry.status)?.toUpperCase();
  if (status && status !== "COMPLETED") return "pending";
  const conclusion = text(entry.conclusion)?.toUpperCase();
  if (!conclusion) return "pending";
  return PASSING_CONCLUSIONS.has(conclusion) ? "passing" : "failing";
}

export function normalizeChecks(rollup: DynamicArray): NormalizedChecks {
  const summary: PrChecksSummary = { pending: 0, passing: 0, failing: 0, total: 0 };
  const checks: PrCheck[] = [];
  for (const raw of rollup) {
    const entry = fields(raw);
    const name = text(entry.name) ?? text(entry.context) ?? "check";
    const status = text(entry.status) ?? text(entry.state) ?? "UNKNOWN";
    const conclusion = text(entry.conclusion);
    const bucket = classifyCheck(entry);
    summary[bucket] += 1;
    summary.total += 1;
    checks.push({ name, status, conclusion, bucket });
  }
  return { checks, summary };
}

function normalizeReviewers(reviewRequests: DynamicArray): string[] {
  const names: string[] = [];
  for (const raw of reviewRequests) {
    const entry = fields(raw);
    const name = text(entry.login) ?? text(entry.name) ?? text(entry.slug);
    if (name) names.push(name);
  }
  return names;
}

export type NormalizedPr = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  reviewers: string[];
  commentsCount: number;
  body: string;
  mergeable: string;
  checks: PrCheck[];
  checksSummary: PrChecksSummary;
};

export function normalizePrView(pr: DynamicFields): NormalizedPr {
  const { checks, summary } = normalizeChecks(array(pr.statusCheckRollup));
  return {
    number: integer(pr.number),
    title: text(pr.title) ?? "",
    url: text(pr.url) ?? "",
    state: text(pr.state) ?? "UNKNOWN",
    isDraft: pr.isDraft === true,
    headRefName: text(pr.headRefName) ?? "",
    baseRefName: text(pr.baseRefName) ?? "",
    additions: integer(pr.additions),
    deletions: integer(pr.deletions),
    reviewers: normalizeReviewers(array(pr.reviewRequests)),
    commentsCount: array(pr.comments).length,
    body: text(pr.body) ?? "",
    mergeable: text(pr.mergeable) ?? "UNKNOWN",
    checks,
    checksSummary: summary,
  };
}

export type PrListItem = {
  number: number;
  title: string;
  headRefName: string;
  updatedAt: string;
  isDraft: boolean;
};

export function normalizePrList(entries: DynamicArray): PrListItem[] {
  return entries.map((item) => {
    const entry = fields(item);
    return {
      number: integer(entry.number),
      title: text(entry.title) ?? "",
      headRefName: text(entry.headRefName) ?? "",
      updatedAt: text(entry.updatedAt) ?? "",
      isDraft: entry.isDraft === true,
    };
  });
}

type GhFailure = { code: string | null; stderr: string; message: string };
function parseGhFailure(error: UnparsedValue): GhFailure {
  const value = fields(error);
  return {
    code: text(value.code),
    stderr: text(value.stderr) ?? "",
    message: error instanceof Error ? error.message : "gh command failed",
  };
}

async function runGh(args: string[], cwd: string): Promise<{ stdout: string }> {
  return execFileAsync("gh", args, {
    cwd,
    timeout: GH_TIMEOUT_MS,
    maxBuffer: GH_MAX_BUFFER,
    windowsHide: true,
  });
}

function friendlyGhError(failure: GhFailure): string {
  if (failure.code === "ENOENT")
    return "GitHub CLI (gh) is not installed. Install it to view pull requests.";
  const stderr = failure.stderr.trim();
  if (/gh auth login/i.test(stderr) || /not logged into/i.test(stderr)) {
    return "GitHub CLI is not authenticated. Run `gh auth login` in a terminal.";
  }
  if (stderr) return stderr.split("\n")[0] ?? failure.message;
  return failure.message;
}

function isNoPullRequest(stderr: string): boolean {
  return /no pull requests? found/i.test(stderr) || /no open pull requests/i.test(stderr);
}

function validateCwd(rawCwd: string | null): string | Response {
  const trimmed = rawCwd?.trim() ?? "";
  if (!trimmed) return jsonError("cwd is required");
  if (!path.isAbsolute(trimmed)) return jsonError("cwd must be absolute");
  try {
    return resolveAllowedWorkspace(trimmed);
  } catch (error) {
    return jsonError(errorMessage(error, "cwd is not an allowed workspace"), 403);
  }
}

export async function handlePrGet(request: Request): Promise<Response> {
  const cwd = validateCwd(new URL(request.url).searchParams.get("cwd"));
  if (cwd instanceof Response) return cwd;
  try {
    const { stdout } = await runGh(["pr", "view", "--json", PR_VIEW_FIELDS], cwd);
    const pr = fields(JSON.parse(stdout));
    return Response.json({ pr: normalizePrView(pr) });
  } catch (error) {
    const failure = parseGhFailure(error);
    if (failure.code === "ENOENT") return Response.json({ error: friendlyGhError(failure) });
    if (isNoPullRequest(failure.stderr)) return listPullRequests(cwd);
    return Response.json({ error: friendlyGhError(failure) });
  }
}

async function listPullRequests(cwd: string): Promise<Response> {
  try {
    const { stdout } = await runGh(["pr", "list", "--json", PR_LIST_FIELDS, "--limit", "20"], cwd);
    const prs = array(JSON.parse(stdout));
    return Response.json({ prs: normalizePrList(prs) });
  } catch (error) {
    const failure = parseGhFailure(error);
    return Response.json({ error: friendlyGhError(failure) });
  }
}

export async function handlePrMerge(request: Request): Promise<Response> {
  const body = await readJsonRequestWithinLimit(request, PR_MERGE_BODY_LIMIT_BYTES);
  if (!body.ok) return jsonError(body.error, body.status);
  const payload = fields(body.value);
  const cwd = validateCwd(text(payload.cwd));
  if (cwd instanceof Response) return cwd;
  const number = integer(payload.number);
  if (number <= 0) return jsonError("number must be a positive integer");
  const method = text(payload.method) ?? "merge";
  if (!MERGE_METHODS.has(method)) return jsonError("method must be merge, squash, or rebase");
  try {
    await runGh(["pr", "merge", String(number), `--${method}`], cwd);
    return Response.json({ ok: true });
  } catch (error) {
    const failure = parseGhFailure(error);
    return Response.json({ ok: false, error: friendlyGhError(failure) });
  }
}
