import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
} from "../src/features/agent/active-sessions";

function snap(
  id: string,
  patch: Partial<ActiveAgentSessionSnapshot> = {},
): ActiveAgentSessionSnapshot {
  return {
    projectId: "",
    cwd: "",
    paneId: `pane-${id}`,
    tabId: `tab-${id}`,
    runtimeSessionId: `rt-${id}`,
    piSessionId: `pi-${id}`,
    title: id,
    status: "running",
    updatedAt: "2026-06-23T00:00:00.000Z",
    startedAt: "2026-06-23T00:00:00.000Z",
    ...patch,
  };
}

// Regression for finding [16]: the persisted active-sessions snapshot must not
// accumulate this instance's closed sessions forever. `incoming` is authoritative
// for the writing instance, so an entry it stamped before but no longer lists was
// closed and must drop — while entries written by OTHER windows (different
// writerId) and legacy entries (no writerId) are preserved.
test("merge drops this writer's closed sessions but keeps other windows' and legacy entries", () => {
  const W1 = "writer-1";
  const previous: ActiveAgentSessionSnapshot[] = [
    snap("A", { writerId: W1 }), // this instance, still active
    snap("B", { writerId: W1 }), // this instance, CLOSED (absent from incoming)
    snap("C", { writerId: "writer-2" }), // another window
    snap("D"), // legacy entry, no writerId
  ];
  const incoming: ActiveAgentSessionSnapshot[] = [snap("A")]; // only A is still active here

  const merged = mergeActiveAgentSessions(previous, incoming, {}, W1);
  const titles = new Set(merged.map((s) => s.title));

  assert.ok(titles.has("A"), "still-active session kept");
  assert.ok(!titles.has("B"), "this writer's closed session must be dropped");
  assert.ok(titles.has("C"), "another window's session preserved");
  assert.ok(titles.has("D"), "legacy (no-writerId) entry preserved");
});

test("without ownWriterId the merge still unions (back-compat for the projects-nav caller)", () => {
  const previous = [snap("A", { writerId: "w" }), snap("B", { writerId: "w" })];
  const merged = mergeActiveAgentSessions(previous, [snap("A")], {});
  const titles = new Set(merged.map((s) => s.title));
  // No ownWriterId passed → legacy union behavior: nothing is dropped.
  assert.ok(titles.has("A") && titles.has("B"), "union behavior preserved when no writerId given");
});
