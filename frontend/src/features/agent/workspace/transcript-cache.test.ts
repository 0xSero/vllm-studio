import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  TRANSCRIPT_CACHE_PREFIX,
  readTranscriptSnapshot,
  writeTranscriptSnapshot,
} from "./transcript-cache";
import type { ChatMessage } from "@/features/agent/messages/types";

/**
 * localStorage with a byte ceiling. `length` has to be a live getter: the
 * cache walks index 0..length-1 to find its keys, so a fixed 0 makes every
 * eviction path silently no-op and any test written against it meaningless.
 */
function quotaStorage(limitBytes: number) {
  const values = new Map<string, string>();
  const used = () => [...values].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => {
      const existing = values.get(key);
      const without = used() - (existing === undefined ? 0 : key.length + existing.length);
      if (without + key.length + value.length > limitBytes) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      values.set(key, value);
    },
    cachedSessions: () =>
      [...values.keys()].filter((key) => key.startsWith(TRANSCRIPT_CACHE_PREFIX)).length,
  };
}

function transcript(blockChars: number): ChatMessage[] {
  const body = "x".repeat(blockChars);
  return Array.from({ length: 40 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    text: `message ${index}`,
    blocks: [{ kind: "text", id: `b${index}`, text: body }],
  })) as unknown as ChatMessage[];
}

describe("transcript cache under quota pressure", () => {
  // The cache is an optimisation, so running out of room must never surface as
  // an error — but it also must not throw away every other session to store
  // one. Tool-heavy transcripts are ~500KB against a ~5MB origin quota, so a
  // wholesale wipe fires about every tenth write and empties the cache exactly
  // when the most sessions are open. Nothing about that is visible; sessions
  // just stop reopening instantly.
  test("keeps most sessions cached instead of clearing them all", () => {
    const storage = quotaStorage(2 * 1024 * 1024);
    const heavy = transcript(24 * 1024);

    const counts: number[] = [];
    for (let session = 0; session < 12; session += 1) {
      writeTranscriptSnapshot(`session-${session}`, heavy, undefined, storage);
      counts.push(storage.cachedSessions());
    }

    // A collapse is a write that removes more than one other session.
    const collapses = counts.filter(
      (count, index) => index > 0 && count < counts[index - 1] - 1,
    ).length;
    assert.equal(collapses, 0, `cache collapsed ${collapses} time(s): ${counts.join(",")}`);
    assert.ok(counts[counts.length - 1] > 1, `only ${counts.at(-1)} session(s) cached at the end`);
  });

  test("the newest session is always the one that survives", () => {
    const storage = quotaStorage(1024 * 1024);
    const heavy = transcript(24 * 1024);

    writeTranscriptSnapshot("older", heavy, undefined, storage);
    writeTranscriptSnapshot("newest", heavy, undefined, storage);

    assert.ok(readTranscriptSnapshot("newest", storage));
  });

  test("a write that cannot fit at all is dropped rather than thrown", () => {
    // Smaller than a single entry: there is no eviction that makes room.
    const storage = quotaStorage(1024);
    assert.doesNotThrow(() =>
      writeTranscriptSnapshot("too-big", transcript(24 * 1024), undefined, storage),
    );
    assert.equal(storage.cachedSessions(), 0);
  });
});
