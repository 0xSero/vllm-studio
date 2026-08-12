import { createReadStream, statSync } from "node:fs";
import readline from "node:readline";
import type { SessionUsageTotals } from "../../../shared/agent/session-summary";

export type { SessionUsageTotals } from "../../../shared/agent/session-summary";

export function emptyUsageTotals(): SessionUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 0,
    cost: 0,
    calls: 0,
    compactions: 0,
  };
}

type CacheEntry = { size: number; mtimeMs: number; totals: SessionUsageTotals };

// Rollouts are append-only, so a file whose size and mtime are unchanged has
// unchanged totals. Keyed by path; one entry per session file.
const cache = new Map<string, CacheEntry>();

function numeric(source: Record<string, unknown> | null, keys: string[]): number {
  if (!source) return 0;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Fold one rollout line into the running totals. */
export function accumulateUsageLine(totals: SessionUsageTotals, line: string): SessionUsageTotals {
  // Cheap pre-filter: the vast majority of lines are tool output and user text
  // with no usage block at all, and JSON.parse on a multi-GB log is the whole
  // cost of this scan.
  const hasUsage = line.includes('"usage"');
  const hasCompaction = line.includes("compaction");
  if (!hasUsage && !hasCompaction) return totals;

  let entry: Record<string, unknown> | null = null;
  try {
    entry = asRecord(JSON.parse(line));
  } catch {
    return totals;
  }
  if (!entry) return totals;

  if (entry.type === "compaction" || entry.customType === "compaction") {
    return { ...totals, compactions: totals.compactions + 1 };
  }

  const message = asRecord(entry.message);
  if (!message || message.role !== "assistant") return totals;
  const usage = asRecord(message.usage);
  if (!usage) return totals;

  const input = numeric(usage, ["input", "input_tokens", "prompt_tokens"]);
  const output = numeric(usage, ["output", "output_tokens", "completion_tokens"]);
  const cacheRead = numeric(usage, ["cacheRead", "cache_read_input_tokens"]);
  const cacheWrite = numeric(usage, ["cacheWrite", "cache_creation_input_tokens"]);
  const reasoning = numeric(usage, ["reasoning", "reasoning_tokens"]);
  const reported = numeric(usage, ["totalTokens", "total_tokens", "total"]);
  const cost = numeric(asRecord(usage.cost), ["total"]);

  return {
    input: totals.input + input,
    output: totals.output + output,
    cacheRead: totals.cacheRead + cacheRead,
    cacheWrite: totals.cacheWrite + cacheWrite,
    reasoning: totals.reasoning + reasoning,
    total: totals.total + (reported || input + output),
    cost: totals.cost + cost,
    calls: totals.calls + 1,
    compactions: totals.compactions,
  };
}

/** Walk a rollout and total what it spent.
 *
 *  Streams line by line so memory stays flat regardless of file size, and
 *  memoises on (size, mtime) — an append-only log that has not grown cannot
 *  have different totals, and the status panel asks for this on every session
 *  open. */
export async function readSessionUsageTotals(filepath: string): Promise<SessionUsageTotals> {
  let stat: { size: number; mtimeMs: number };
  try {
    stat = statSync(filepath);
  } catch {
    return emptyUsageTotals();
  }

  const cached = cache.get(filepath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.totals;
  }

  let totals = emptyUsageTotals();
  try {
    const stream = createReadStream(filepath, { encoding: "utf-8" });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line) totals = accumulateUsageLine(totals, line);
    }
  } catch {
    return emptyUsageTotals();
  }

  cache.set(filepath, { size: stat.size, mtimeMs: stat.mtimeMs, totals });
  return totals;
}
