import { statSync } from "node:fs";
import { readRolloutHead, rolloutCache, scanCompleteRolloutLines } from "./rollout-cache";
import { isRecord, type UnknownRecord, type UnparsedValue } from "../../../shared/agent/guards";
import { Schema } from "effect";

const isNumber = Schema.is(Schema.Number);

export type SessionUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  cost: number;
  calls: number;
  compactions: number;
};

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

type CacheEntry = {
  size: number;
  mtimeMs: number;
  totals: SessionUsageTotals;
  scannedBytes: number;
  head: string;
};

const usageDisk = rolloutCache<CacheEntry, CacheEntry>("usage-totals", {
  serialize: (value) => value,
  deserialize: (value) => value,
});

type ScanResult = { totals: SessionUsageTotals; scannedBytes: number };

async function scanFrom(
  filepath: string,
  start: number,
  seed: SessionUsageTotals,
): Promise<ScanResult> {
  let totals = seed;
  const scannedBytes = await scanCompleteRolloutLines(filepath, start, (line) => {
    if (line) totals = accumulateUsageLine(totals, line);
  });
  return { totals, scannedBytes };
}

function numeric(source: UnknownRecord | null, keys: string[]): number {
  if (!source) return 0;
  for (const key of keys) {
    const value = source[key];
    if (isNumber(value) && Number.isFinite(value)) return value;
  }
  return 0;
}

function asRecord(value: UnparsedValue): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

export function accumulateUsageLine(totals: SessionUsageTotals, line: string): SessionUsageTotals {
  const hasUsage = line.includes('"usage"');
  const hasCompaction = line.includes("compaction");
  if (!hasUsage && !hasCompaction) return totals;

  let entry: UnknownRecord | null = null;
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

export async function readSessionUsageTotals(filepath: string): Promise<SessionUsageTotals> {
  let stat: { size: number; mtimeMs: number };
  try {
    stat = statSync(filepath);
  } catch {
    return emptyUsageTotals();
  }

  try {
    const head = await readRolloutHead(filepath);

    const previous = usageDisk.readStale(filepath);

    const resumable =
      previous !== undefined &&
      previous.head === head &&
      stat.size >= previous.scannedBytes &&
      previous.scannedBytes > 0;

    if (resumable && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
      return previous.totals;
    }

    const { totals, scannedBytes } = resumable
      ? await scanFrom(filepath, previous.scannedBytes, previous.totals)
      : await scanFrom(filepath, 0, emptyUsageTotals());

    const entry = { size: stat.size, mtimeMs: stat.mtimeMs, totals, scannedBytes, head };
    usageDisk.write(filepath, stat, entry);
    return totals;
  } catch {
    return emptyUsageTotals();
  }
}
