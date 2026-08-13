/**
 * What the transcript snapshot cache does when localStorage runs out.
 *
 * The cache is bounded per session (200 messages / 512KB) and by count
 * (24 sessions), so its own ceiling is ~12.6MB — above the ~5MB most browsers
 * give an origin. The overflow path deletes *every other session's* entry and
 * retries, which is safe but potentially self-defeating: with several large
 * sessions each write could evict the others, so the cache that exists to make
 * reopening instant would hold nothing useful exactly when the most sessions
 * are open.
 *
 * This drives it against a quota-enforcing storage and reports how many
 * sessions still have a usable snapshot afterwards.
 *
 * Run: bun run bench/transcript-cache-quota.bench.ts (from frontend/)
 */
import {
  writeTranscriptSnapshot,
  TRANSCRIPT_CACHE_PREFIX,
} from "../src/features/agent/workspace/transcript-cache";
import type { ChatMessage } from "../src/features/agent/messages/types";

/** localStorage with a byte ceiling, which is the part that matters here. */
function quotaStorage(limitBytes: number) {
  const values = new Map<string, string>();
  const used = () => [...values].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  return {
    // A live getter, not a fixed number. `cacheKeys` walks index 0..length-1,
    // so a hardcoded 0 makes every eviction path silently no-op and the whole
    // measurement meaningless — which is exactly what the first run of this
    // bench did.
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => {
      const next = used() - (values.get(key)?.length ?? 0) - (values.has(key) ? key.length : 0);
      if (next + key.length + value.length > limitBytes) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      values.set(key, value);
    },
    _entries: values,
    _usedBytes: used,
  };
}

/** A session whose messages carry tool output, i.e. a realistically fat one. */
function transcript(messages: number, blockChars: number): ChatMessage[] {
  const body = "x".repeat(blockChars);
  return Array.from({ length: messages }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    text: `message ${index}`,
    blocks: [{ kind: "text", id: `b${index}`, text: body }],
  })) as unknown as ChatMessage[];
}

const QUOTA_BYTES = 5 * 1024 * 1024;

for (const [label, messages, blockChars] of [
  ["light sessions (text only)", 200, 400],
  ["heavy sessions (tool output)", 200, 8_000],
] as const) {
  const storage = quotaStorage(QUOTA_BYTES);
  const body = transcript(messages, blockChars);

  // Track the survivor count after every write, not just at the end: a cache
  // that collapses to 1 and climbs back looks the same at the end as one that
  // never collapsed.
  const counts: number[] = [];
  for (let session = 0; session < 24; session += 1) {
    writeTranscriptSnapshot(`session-${session}`, body, `Session ${session}`, storage as never);
    counts.push(
      [...storage._entries.keys()].filter((k) => k.startsWith(TRANSCRIPT_CACHE_PREFIX)).length,
    );
  }

  // The written entry is what the cap produced, not the transcript we handed in.
  const writtenKb = Math.round(([...storage._entries.values()][0]?.length ?? 0) / 1024);
  const survivors = counts[counts.length - 1];
  const collapses = counts.filter(
    (count, index) => index > 0 && count < counts[index - 1] - 1,
  ).length;
  console.log(
    `${label}\n  ~${writtenKb}KB written per session, 24 written into a ${QUOTA_BYTES / 1024 / 1024}MB quota` +
      `\n  -> ${survivors} cached at the end, ${Math.round(storage._usedBytes() / 1024)}KB used` +
      `\n  -> survivors after each write: ${counts.join(",")}` +
      `\n  -> ${collapses} mass eviction(s)\n`,
  );
}

console.log(
  "A survivor count of 1 means every write evicted the rest: the cache holds nothing when it is needed most.",
);
