import assert from "node:assert/strict";
import test from "node:test";

import type { ChatMessage } from "../src/features/agent/messages/types";
import {
  TRANSCRIPT_CACHE_KEY,
  boundMessagesForCache,
  parseTranscriptCache,
  putTranscript,
  readTranscriptSnapshot,
  writeTranscriptSnapshot,
} from "../src/features/agent/workspace/transcript-cache";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function fakeStorage(opts: { failSetTimes?: number } = {}) {
  const map = new Map<string, string>();
  let fails = opts.failSetTimes ?? 0;
  const storage: Storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (fails > 0) {
        fails -= 1;
        throw new Error("QuotaExceededError");
      }
      map.set(key, value);
    },
    removeItem: (key) => void map.delete(key),
  };
  return { storage, map };
}

function userMessage(id: string, text: string): ChatMessage {
  return { id, role: "user", text };
}

test("write then read round-trips a session's transcript", () => {
  const { storage } = fakeStorage();
  const messages = [
    userMessage("u1", "hello"),
    { id: "a1", role: "assistant", text: "hi" as const },
  ];
  writeTranscriptSnapshot("pi-1", messages as ChatMessage[], "Greeting", storage, 1000);
  const restored = readTranscriptSnapshot("pi-1", storage);
  assert.equal(restored?.length, 2);
  assert.equal(restored?.[0].text, "hello");
  assert.equal(restored?.[1].text, "hi");
});

test("transient streaming fields and attachment bodies are stripped", () => {
  const { storage } = fakeStorage();
  const message: ChatMessage = {
    id: "a1",
    role: "assistant",
    text: "answer",
    blocks: [{ kind: "text", id: "b1", text: "answer" }],
    streamCalls: [[{ type: "text" }]],
    pending: true,
    attachments: [
      {
        id: "att1",
        name: "big.png",
        type: "image/png",
        size: 999,
        mode: "data-url",
        content: "data:image/png;base64,AAAAAAAAAAA...huge...",
        previewUrl: "blob:huge",
      },
    ],
  };
  writeTranscriptSnapshot("pi-1", [message], undefined, storage, 1000);
  const restored = readTranscriptSnapshot("pi-1", storage);
  const cached = restored?.[0];
  assert.equal(cached?.streamCalls, undefined);
  assert.equal(cached?.pending, undefined);
  assert.equal(cached?.attachments?.[0].content, "");
  assert.equal("previewUrl" in (cached?.attachments?.[0] ?? {}), false);
  assert.equal(cached?.attachments?.[0].name, "big.png");
});

test("boundMessagesForCache keeps only the most recent 200 messages", () => {
  const messages = Array.from({ length: 250 }, (_, i) => userMessage(`m${i}`, `line ${i}`));
  const bounded = boundMessagesForCache(messages);
  assert.equal(bounded.length, 200);
  assert.equal(bounded[0].id, "m50");
  assert.equal(bounded[bounded.length - 1].id, "m249");
});

test("an oversized session drops oldest messages but always keeps the last", () => {
  const big = "x".repeat(200 * 1024);
  const messages = [userMessage("old", big), userMessage("mid", big), userMessage("new", big)];
  const bounded = boundMessagesForCache(messages);
  assert.ok(bounded.length >= 1);
  assert.equal(bounded[bounded.length - 1].id, "new");
  assert.ok(JSON.stringify(bounded).length <= 512 * 1024);
});

test("eviction keeps the most-recent sessions by updatedAt", () => {
  let cache = parseTranscriptCache(null);
  for (let i = 0; i < 30; i += 1) {
    cache = putTranscript(cache, `pi-${i}`, [userMessage(`u${i}`, "hi")], undefined, i);
  }
  const ids = Object.keys(cache.sessions);
  assert.equal(ids.length, 24);
  assert.equal(cache.sessions["pi-29"]?.messages[0].text, "hi");
  assert.equal(cache.sessions["pi-0"], undefined);
  assert.equal(cache.sessions["pi-5"], undefined);
});

test("empty messages and missing pi id are no-ops", () => {
  const { storage, map } = fakeStorage();
  writeTranscriptSnapshot("pi-1", [], "t", storage, 1000);
  assert.equal(map.has(TRANSCRIPT_CACHE_KEY), false);
  writeTranscriptSnapshot(null, [userMessage("u", "x")], "t", storage, 1000);
  assert.equal(map.has(TRANSCRIPT_CACHE_KEY), false);
  assert.equal(readTranscriptSnapshot(null, storage), null);
  assert.equal(readTranscriptSnapshot("pi-unknown", storage), null);
});

test("a quota failure sheds older entries and still persists the freshest", () => {
  const { storage, map } = fakeStorage({ failSetTimes: 1 });
  // First setItem throws; persist() retries with the trimmed half.
  writeTranscriptSnapshot("pi-1", [userMessage("u1", "keep me")], "t", storage, 1000);
  assert.ok(map.has(TRANSCRIPT_CACHE_KEY));
  assert.equal(readTranscriptSnapshot("pi-1", storage)?.[0].text, "keep me");
});

test("parseTranscriptCache rejects malformed payloads", () => {
  assert.deepEqual(parseTranscriptCache(null).sessions, {});
  assert.deepEqual(parseTranscriptCache("not json").sessions, {});
  assert.deepEqual(parseTranscriptCache('{"version":2,"sessions":{}}').sessions, {});
  assert.deepEqual(parseTranscriptCache('{"version":1,"sessions":[]}').sessions, {});
});
