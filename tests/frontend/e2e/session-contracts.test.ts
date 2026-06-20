import assert from "node:assert/strict";
import test from "node:test";

import { indexActiveByPiId, type ActiveSession } from "@/features/agent/session-contracts";

// Regression coverage for the shared active-session indexer extracted from the
// duplicated memo in sessions-page.tsx and sessions-command.tsx.

function activeSession(overrides: Partial<ActiveSession>): ActiveSession {
  return {
    projectId: "p",
    cwd: "/tmp",
    paneId: "pane",
    tabId: "tab",
    piSessionId: null,
    title: "t",
    status: "idle",
    updatedAt: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

test("indexes active sessions by piSessionId", () => {
  const a = activeSession({ piSessionId: "pi-a", paneId: "1" });
  const b = activeSession({ piSessionId: "pi-b", paneId: "2" });
  const map = indexActiveByPiId([a, b]);
  assert.equal(map.size, 2);
  assert.equal(map.get("pi-a"), a);
  assert.equal(map.get("pi-b"), b);
});

test("skips sessions without a piSessionId", () => {
  const withId = activeSession({ piSessionId: "pi-a" });
  const withoutId = activeSession({ piSessionId: null });
  const map = indexActiveByPiId([withId, withoutId]);
  assert.equal(map.size, 1);
  assert.ok(map.has("pi-a"));
});

test("last session wins when two share a piSessionId", () => {
  const first = activeSession({ piSessionId: "dup", paneId: "first" });
  const second = activeSession({ piSessionId: "dup", paneId: "second" });
  const map = indexActiveByPiId([first, second]);
  assert.equal(map.size, 1);
  assert.equal(map.get("dup")?.paneId, "second");
});

test("returns an empty map for no active sessions", () => {
  assert.equal(indexActiveByPiId([]).size, 0);
});
