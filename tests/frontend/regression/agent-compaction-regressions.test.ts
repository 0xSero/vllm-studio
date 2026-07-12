import assert from "node:assert/strict";
import test from "node:test";
import { piEventIsSuccessfulCompaction } from "@shared/agent/pi-events";
import { applyAssistantPiEventToBlocks } from "@/features/agent/messages/block-event";
import { runtimeContextUsage } from "@/features/agent/runtime/api";
import { makePiEventApplierHarness, makeSession } from "./agent-fixtures";

// NOTE: post-compaction usage suppression on the server runtime (stale
// pre-compaction tokens must read as null until a fresh assistant responds)
// is owned by the pi SDK's getContextUsage() and pinned end-to-end in
// tests/frontend/agent-runtime/compaction.test.ts. The tests here cover the
// client-side pipeline: event classification, block rendering, and the
// session-store applier.

test("runtime null context usage clears stale compaction warnings", () => {
  const stale = {
    tokens: 999_999,
    contextWindow: 1_000_000,
    percent: 99.9,
    shouldCompact: true,
  };

  assert.equal(runtimeContextUsage({ contextUsage: null }, stale), null);
});

test("successful compaction_end events are classified as successful compactions", () => {
  assert.equal(
    piEventIsSuccessfulCompaction({
      type: "compaction_end",
      result: {
        summary: "Compacted",
        firstKeptEntryId: "m2",
        tokensBefore: 190_000,
      },
      aborted: false,
    }),
    true,
  );
});

test("failed compaction events do not acknowledge the compaction boundary", () => {
  assert.equal(
    piEventIsSuccessfulCompaction({
      type: "compaction_end",
      result: null,
      errorMessage: "Auto-compaction failed",
    }),
    false,
  );
});

test("compaction events render as assistant event blocks", () => {
  const blocks = applyAssistantPiEventToBlocks([], {
    type: "context_compaction",
    summary: "Compacted the current plan and selected skills.",
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.kind, "event");
  assert.equal(
    blocks[0]?.text,
    "Compacted the current plan and selected skills.",
  );
});

test("compaction start and failed end events do not render completed compaction blocks", () => {
  assert.equal(
    applyAssistantPiEventToBlocks([], {
      type: "compaction_start",
      reason: "threshold",
    }),
    null,
  );
  assert.equal(
    applyAssistantPiEventToBlocks([], {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      errorMessage: "Auto-compaction failed",
    }),
    null,
  );
});

test("successful compaction_end renders the completed result summary", () => {
  const blocks = applyAssistantPiEventToBlocks([], {
    type: "compaction_end",
    reason: "threshold",
    result: {
      summary: "Compacted before continuing.",
      firstKeptEntryId: "entry-1",
      tokensBefore: 180_000,
    },
  });

  assert.equal(blocks?.length, 1);
  assert.equal(blocks?.[0]?.kind, "event");
  assert.equal(blocks?.[0]?.text, "Compacted before continuing.");
});

test("compaction events clear stale token and context usage", () => {
  const { apply, session } = makePiEventApplierHarness(
    makeSession("s-compact", {
      tokenStats: { read: 1, write: 2, current: 3 },
      contextUsage: {
        tokens: 99_999,
        contextWindow: 100_000,
        percent: 99.9,
        shouldCompact: true,
      },
      messages: [{ id: "a-main", role: "assistant", text: "", blocks: [] }],
    }),
  );

  apply("s-compact", "a-main", {
    type: "compaction_end",
    reason: "threshold",
    result: {
      summary: "Compacted",
      firstKeptEntryId: "e1",
      tokensBefore: 99_999,
    },
  });

  assert.equal(session().tokenStats, undefined);
  assert.equal(session().contextUsage, null);
});

test("failed compaction events preserve stale token and context usage", () => {
  const contextUsage = {
    tokens: 99_999,
    contextWindow: 100_000,
    percent: 99.9,
    shouldCompact: true,
  };
  const tokenStats = { read: 1, write: 2, current: 3 };
  const { apply, session } = makePiEventApplierHarness(
    makeSession("s-compact-failed", {
      tokenStats,
      contextUsage,
      messages: [{ id: "a-main", role: "assistant", text: "", blocks: [] }],
    }),
  );

  apply("s-compact-failed", "a-main", {
    type: "compaction_end",
    status: "aborted",
    error: "Compaction was interrupted",
  });

  assert.deepEqual(session().tokenStats, tokenStats);
  assert.deepEqual(session().contextUsage, contextUsage);
});

test("failed compaction_end with errorMessage preserves stale token and context usage", () => {
  const contextUsage = {
    tokens: 99_999,
    contextWindow: 100_000,
    percent: 99.9,
    shouldCompact: true,
  };
  const tokenStats = { read: 1, write: 2, current: 3 };
  const { apply, session } = makePiEventApplierHarness(
    makeSession("s-compact-error-message", {
      tokenStats,
      contextUsage,
      messages: [{ id: "a-main", role: "assistant", text: "", blocks: [] }],
    }),
  );

  apply("s-compact-error-message", "a-main", {
    type: "compaction_end",
    errorMessage: "Compaction failed before producing a result",
    result: undefined,
  });

  assert.deepEqual(session().tokenStats, tokenStats);
  assert.deepEqual(session().contextUsage, contextUsage);
});
