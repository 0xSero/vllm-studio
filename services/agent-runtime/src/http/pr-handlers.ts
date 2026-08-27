// HTTP surface for GitHub pull-request info, backed by the `gh` CLI. Every
// call runs `gh` with cwd pinned to the request's validated project workspace
// (same allowlist as the session/git handlers) and array-form args (no shell),
// so a project path can never inject flags. Missing gh, an unauthenticated
// gh, or a non-repo cwd all come back as clean 200s carrying {error} so the
// panel can render a friendly empty state instead of a 500.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Option, Schema } from "effect";
import {
  AGENT_TURN_BODY_LIMIT_BYTES,
  readJsonRequestWithinLimit,
} from "../../../../shared/agent/agent-turn-body";
import { resolveAllowedWorkspace } from "../projects-store";
import { errorMessage, jsonError } from "./helpers";

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 15_000;
const GH_MAX_BUFFER = 4 * 1024 * 1024;
const PR_MERGE_BODY_LIMIT_BYTES = Math.min(AGENT_TURN_BODY_LIMIT_BYTES, 64 * 1024);
const MERGE_METHODS = new Set(["merge", "squash", "rebase"]);

const PR_VIEW_FIELDS = [
  "number", "title", "url", "state", "isDraft", "headRefName", "baseRefName",
  "additions", "deletions", "reviewRequests", "reviews", "comments", "body",
  "mergeable", "statusCheckRollup",
].join(",");
const PR_LIST_FIELDS = ["number", "title", "headRefName", "updatedAt", "isDraft"].join(",");

const DynamicFieldsSchema = Schema.Struct({
  number: Schema.optional(Schema.Unknown),
  title: Schema.optional(Schema.Unknown),
  url: Schema.optional(Schema.Unknown),
  state: Schema.optional(Schema.Unknown),
  isDraft: Schema.optional(Schema.Unknown),
  headRefName: Schema.optional(Schema.Unknown),
  baseRefName: Schema.optional(Schema.Unknown),
  additions: Schema.optional(Schema.Unknown),
  deletions: Schema.optional(Schema.Unknown),
  reviewRequests: Schema.optional(Schema.Unknown),
  reviews: Schema.optional(Schema.Unknown),
  comments: Schema.optional(Schema.Unknown),
  body: Schema.optional(Schema.Unknown),
  mergeable: Schema.optional(Schema.Unknown),
  statusCheckRollup: Schema.optional(Schema.Unknown),
  updatedAt: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.Unknown),
  context: Schema.optional(Schema.Unknown),
  status: Schema.optional(Schema.Unknown),
  conclusion: Schema.optional(Schema.Unknown),
  login: Schema.optional(Schema.Unknown),
  slug: Schema.optional(Schema.Unknown),
});
type DynamicFields = typeof DynamicFieldsSchema.Type;
const DynamicArraySchema = Schema.Array(Schema.Unknown);
type DynamicArray = typeof DynamicArraySchema.Type;
const MergePayloadSchema = Schema.Struct({
  cwd: Schema.optional(Schema.Unknown),
  number: Schema.optional(Schema.Unknown),
  method: Schema.optional(Schema.Unknown),
});
type MergePayload = typeof MergePayloadSchema.Type;
const GhErrorSchema = Schema.Struct({
  code: Schema.optional(Schema.Unknown),
  stderr: Schema.optional(Schema.Unknown),
});
type GhError = typeof GhErrorSchema.Type;
const ErrorSchema = Schema.instanceOf(Error);

const decodeFields = Schema.decodeUnknownOption(DynamicFieldsSchema);
const decodeArray = Schema.decodeUnknownOption(DynamicArraySchema);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeNumber = Schema.decodeUnknownOption(Schema.Number);
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);
const emptyFields = Schema.decodeUnknownSync(DynamicFieldsSchema)({});
const emptyMergePayload = Schema.decodeUnknownSync(MergePayloadSchema)({});
const emptyGhError = Schema.decodeUnknownSync(GhErrorSchema)({});

function fields(value: Option.Option<DynamicFields>): DynamicFields {
  return Option.getOrElse(value, () => emptyFields);
}

function text(value: Option.Option<string>): string | null {
  return Option.match(value, {
    onNone: () => null,
    onSome: (input) => input.trim() || null,
  });
}

function integer(value: Option.Option<number>): number {
  return Option.match(value, {
    onNone: () => 0,
    onSome: (input) => Number.isFinite(input) ? Math.trunc(input) : 0,
  });
}

export type CheckBucket = "pending" | "passing" | "failing";
export type PrCheck = { name: string; status: string; conclusion: string | null; bucket: CheckBucket };
export type PrChecksSummary = { pending: number; passing: number; failing: number; total: number };
type NormalizedChecks = { checks: PrCheck[]; summary: PrChecksSummary };

const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const PASSING_STATES = new Set(["SUCCESS"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);

function classifyCheck(entry: DynamicFields): CheckBucket {
  const state = text(decodeString(entry.state))?.toUpperCase();
  if (state) {
    if (PASSING_STATES.has(state)) return "passing";
    if (PENDING_STATES.has(state)) return "pending";
    return "failing";
  }
  const status = text(decodeString(entry.status))?.toUpperCase();
  if (status && status !== "COMPLETED") return "pending";
  const conclusion = text(decodeString(entry.conclusion))?.toUpperCase();
  if (!conclusion) return "pending";
  return PASSING_CONCLUSIONS.has(conclusion) ? "passing" : "failing";
}

export function normalizeChecks(rollup: DynamicArray): NormalizedChecks {
  const summary: PrChecksSummary = { pending: 0, passing: 0, failing: 0, total: 0 };
  const checks: PrCheck[] = [];
  for (const raw of rollup) {
    const entry = fields(decodeFields(raw));
    const name = text(decodeString(entry.name)) ?? text(decodeString(entry.context)) ?? "check";
    const status = text(decodeString(entry.status)) ?? text(decodeString(entry.state)) ?? "UNKNOWN";
    const conclusion = text(decodeString(entry.conclusion));
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
    const entry = fields(decodeFields(raw));
    const name = text(decodeString(entry.login)) ?? text(decodeString(entry.name)) ?? text(decodeString(entry.slug));
    if (name) names.push(name);
  }
  return names;
}

export type NormalizedPr = {
  number: number; title: string; url: string; state: string; isDraft: boolean;
  headRefName: string; baseRefName: string; additions: number; deletions: number;
  reviewers: string[]; commentsCount: number; body: string; mergeable: string;
  checks: PrCheck[]; checksSummary: PrChecksSummary;
};

export function normalizePrView(pr: DynamicFields): NormalizedPr {
  const { checks, summary } = normalizeChecks(Option.getOrElse(decodeArray(pr.statusCheckRollup), () => []));
  return {
    number: integer(decodeNumber(pr.number)),
    title: text(decodeString(pr.title)) ?? "",
    url: text(decodeString(pr.url)) ?? "",
    state: text(decodeString(pr.state)) ?? "UNKNOWN",
    isDraft: Option.getOrElse(decodeBoolean(pr.isDraft), () => false),
    headRefName: text(decodeString(pr.headRefName)) ?? "",
    baseRefName: text(decodeString(pr.baseRefName)) ?? "",
    additions: integer(decodeNumber(pr.additions)),
    deletions: integer(decodeNumber(pr.deletions)),
    reviewers: normalizeReviewers(Option.getOrElse(decodeArray(pr.reviewRequests), () => [])),
    commentsCount: Option.getOrElse(decodeArray(pr.comments), () => []).length,
    body: Option.getOrElse(decodeString(pr.body), () => ""),
    mergeable: text(decodeString(pr.mergeable)) ?? "UNKNOWN",
    checks,
    checksSummary: summary,
  };
}

export type PrListItem = { number: number; title: string; headRefName: string; updatedAt: string; isDraft: boolean };

export function normalizePrList(entries: DynamicArray): PrListItem[] {
  return entries.map((item) => {
    const entry = fields(decodeFields(item));
    return {
      number: integer(decodeNumber(entry.number)),
      title: text(decodeString(entry.title)) ?? "",
      headRefName: text(decodeString(entry.headRefName)) ?? "",
      updatedAt: text(decodeString(entry.updatedAt)) ?? "",
      isDraft: Option.getOrElse(decodeBoolean(entry.isDraft), () => false),
    };
  });
}

type GhFailure = { code: string | null; stderr: string; message: string };

function ghFailure(error: GhError, nativeError: Error | null): GhFailure {
  return {
    code: Option.getOrNull(decodeString(error.code)),
    stderr: Option.getOrElse(decodeString(error.stderr), () => ""),
    message: nativeError?.message ?? "gh command failed",
  };
}

function parseGhFailure(input: Option.Option<GhError>, nativeError: Option.Option<Error>): GhFailure {
  return ghFailure(
    Option.getOrElse(input, () => emptyGhError),
    Option.getOrNull(nativeError),
  );
}

async function runGh(args: string[], cwd: string): Promise<{ stdout: string }> {
  return execFileAsync("gh", args, { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER, windowsHide: true });
}

function friendlyGhError(failure: GhFailure): string {
  if (failure.code === "ENOENT") return "GitHub CLI (gh) is not installed. Install it to view pull requests.";
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
  try { return resolveAllowedWorkspace(trimmed); }
  catch (error) { return jsonError(errorMessage(error, "cwd is not an allowed workspace"), 403); }
}

export async function handlePrGet(request: Request): Promise<Response> {
  const cwd = validateCwd(new URL(request.url).searchParams.get("cwd"));
  if (cwd instanceof Response) return cwd;
  try {
    const { stdout } = await runGh(["pr", "view", "--json", PR_VIEW_FIELDS], cwd);
    const pr = fields(decodeFields(JSON.parse(stdout)));
    return Response.json({ pr: normalizePrView(pr) });
  } catch (error) {
    const failure = parseGhFailure(
      Schema.decodeUnknownOption(GhErrorSchema)(error),
      Schema.decodeUnknownOption(ErrorSchema)(error),
    );
    if (failure.code === "ENOENT") return Response.json({ error: friendlyGhError(failure) });
    if (isNoPullRequest(failure.stderr)) return listPullRequests(cwd);
    return Response.json({ error: friendlyGhError(failure) });
  }
}

async function listPullRequests(cwd: string): Promise<Response> {
  try {
    const { stdout } = await runGh(["pr", "list", "--json", PR_LIST_FIELDS, "--limit", "20"], cwd);
    const prs = Option.getOrElse(decodeArray(JSON.parse(stdout)), () => []);
    return Response.json({ prs: normalizePrList(prs) });
  } catch (error) {
    const failure = parseGhFailure(
      Schema.decodeUnknownOption(GhErrorSchema)(error),
      Schema.decodeUnknownOption(ErrorSchema)(error),
    );
    return Response.json({ error: friendlyGhError(failure) });
  }
}

export async function handlePrMerge(request: Request): Promise<Response> {
  const body = await readJsonRequestWithinLimit(request, PR_MERGE_BODY_LIMIT_BYTES);
  if (!body.ok) return jsonError(body.error, body.status);
  const payload: MergePayload = Option.getOrElse(
    Schema.decodeUnknownOption(MergePayloadSchema)(body.value),
    () => emptyMergePayload,
  );
  const cwd = validateCwd(Option.getOrNull(decodeString(payload.cwd)));
  if (cwd instanceof Response) return cwd;
  const number = integer(decodeNumber(payload.number));
  if (number <= 0) return jsonError("number must be a positive integer");
  const method = Option.getOrElse(decodeString(payload.method), () => "merge");
  if (!MERGE_METHODS.has(method)) return jsonError("method must be merge, squash, or rebase");
  try {
    await runGh(["pr", "merge", String(number), `--${method}`], cwd);
    return Response.json({ ok: true });
  } catch (error) {
    const failure = parseGhFailure(
      Schema.decodeUnknownOption(GhErrorSchema)(error),
      Schema.decodeUnknownOption(ErrorSchema)(error),
    );
    return Response.json({ ok: false, error: friendlyGhError(failure) });
  }
}
