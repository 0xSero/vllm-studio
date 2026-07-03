// Compaction contract test: pins the externally observable compaction
// behavior of PiSdkSession BEFORE (and after) delegating the post-compaction
// usage bookkeeping to the SDK's own `getContextUsage()`:
//   (a) after real turns, status.contextUsage reflects model-reported usage;
//   (b) immediately after a successful compaction, the stale pre-compaction
//       usage is suppressed (tokens/percent null, shouldCompact false);
//   (c) the next turn's fresh (smaller) usage lifts the suppression;
//   (d) the ring buffer carries compaction_start + a successful
//       compaction_end whose result includes a numeric tokensBefore.
//
// The faux provider derives usage from content size (withUsageEstimate), so
// the turns below carry enough text that compaction genuinely shrinks the
// context (history beyond keepRecentTokens gets summarized) and the
// post-compaction usage is unambiguously smaller than tokensBefore. In THIS
// regime the legacy local flag layer (awaitingPostCompactionUsage +
// tokens < tokensBefore) and the SDK's own index-based getContextUsage()
// suppression agree on every observable, so the refactor that removes the
// local layer must keep every assertion here green unchanged.
//
// (Known divergence outside this regime, verified 2026-07-02: when the
// post-compaction prompt re-writes the cache, its totalTokens can exceed
// tokensBefore and the legacy `tokens < tokensBefore` heuristic then keeps
// usage suppressed indefinitely; the SDK lifts suppression on the first
// post-compaction assistant usage. The SDK behavior is the intended one.)

import { afterAll, beforeAll, expect, test } from "bun:test";
import type { LoggedPiEvent } from "@local-studio/agent-runtime/pi-runtime-types";
import {
  createTestRuntimeManager,
  type TestRuntimeHarness,
} from "../../support/agent/create-test-runtime";
import { fauxAssistantMessage } from "../../support/agent/mock-model";

// ~40k chars each ≈ ~10k estimated tokens; three turns push the branch well
// past the default keepRecentTokens (20k) so compaction has history to cut.
const BIG_ANSWER = (label: string) =>
  `${label}: ${"lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(700)}`;

type ContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  shouldCompact: boolean;
} | null;

let harness: TestRuntimeHarness;
let usageBeforeCompaction: ContextUsage = null;
let usageAfterCompaction: ContextUsage = null;
let usageAfterFreshTurn: ContextUsage = null;
let compactResult: unknown;
let logged: LoggedPiEvent[] = [];

beforeAll(async () => {
  harness = await createTestRuntimeManager();
  await harness.session.ensureStarted(harness.modelId, harness.cwd);

  const labels = ["survey", "deep dive", "recap", "audit", "cross-check", "final pass"];
  for (const [index, label] of labels.entries()) {
    harness.faux.setResponses([fauxAssistantMessage(BIG_ANSWER(label))]);
    await harness.session.prompt(`Continue the ${label} (${index + 1}).`, () => {});
  }
  usageBeforeCompaction = harness.session.status.contextUsage as ContextUsage;

  // Manual compaction: the SDK summarizes through the same scripted model.
  // Two responses: the history summary plus a turn-prefix summary in case the
  // keepRecentTokens cut point splits a turn.
  harness.faux.setResponses([
    fauxAssistantMessage("Summary: surveyed the workspace; nothing pending."),
    fauxAssistantMessage("Turn prefix summary: mid-turn context condensed."),
  ]);
  compactResult = await harness.session.compact();
  usageAfterCompaction = harness.session.status.contextUsage as ContextUsage;

  // Fresh post-compaction turn with a small answer.
  harness.faux.setResponses([fauxAssistantMessage("All done.")]);
  await harness.session.prompt("Anything left to do?", () => {});
  usageAfterFreshTurn = harness.session.status.contextUsage as ContextUsage;

  logged = harness.session.getEventsAfter(0);
}, 60_000);

afterAll(async () => {
  await harness?.cleanup();
});

test("pre-compaction turns surface model-reported context usage", () => {
  expect(usageBeforeCompaction).not.toBeNull();
  expect(typeof usageBeforeCompaction?.tokens).toBe("number");
  expect(usageBeforeCompaction?.tokens ?? 0).toBeGreaterThan(20_000);
  expect(usageBeforeCompaction?.contextWindow).toBeGreaterThan(0);
  expect(typeof usageBeforeCompaction?.percent).toBe("number");
});

test("manual compact() returns the SDK result with a numeric tokensBefore", () => {
  const result = compactResult as { summary?: unknown; tokensBefore?: unknown };
  expect(typeof result?.summary).toBe("string");
  expect(typeof result?.tokensBefore).toBe("number");
  expect(result?.tokensBefore as number).toBeGreaterThan(20_000);
});

test("stale pre-compaction usage is suppressed until fresh usage arrives", () => {
  expect(usageAfterCompaction).not.toBeNull();
  expect(usageAfterCompaction?.tokens).toBeNull();
  expect(usageAfterCompaction?.percent).toBeNull();
  expect(usageAfterCompaction?.shouldCompact).toBe(false);
  expect(usageAfterCompaction?.contextWindow).toBe(
    usageBeforeCompaction?.contextWindow ?? -1,
  );
});

test("the next turn's fresh usage lifts the post-compaction suppression", () => {
  const tokensBefore = (compactResult as { tokensBefore?: number })?.tokensBefore ?? 0;
  expect(usageAfterFreshTurn).not.toBeNull();
  expect(typeof usageAfterFreshTurn?.tokens).toBe("number");
  expect(usageAfterFreshTurn?.tokens ?? Number.POSITIVE_INFINITY).toBeLessThan(tokensBefore);
  expect(usageAfterFreshTurn?.shouldCompact).toBe(false);
});

test("ring buffer logged compaction_start and a successful compaction_end", () => {
  const events = logged.map((entry) => entry.event as Record<string, unknown>);
  const start = events.find((event) => event.type === "compaction_start");
  expect(start).toBeDefined();
  const end = events.find((event) => event.type === "compaction_end") as
    | { result?: { tokensBefore?: unknown }; aborted?: unknown; errorMessage?: unknown }
    | undefined;
  expect(end).toBeDefined();
  expect(end?.aborted).not.toBe(true);
  expect(end?.errorMessage).toBeUndefined();
  expect(typeof end?.result?.tokensBefore).toBe("number");
});
