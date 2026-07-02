import assert from "node:assert/strict";
import test from "node:test";
import {
  compactionTokensBefore,
  contextUsageAwaitingFreshCompactionUsage,
  normalizeSdkMessageTimestampsForCompactionBoundary,
  piEventIsSuccessfulCompaction,
  postCompactionUsageIsFresh,
} from "@local-studio/agent-runtime/pi-runtime-compaction";
import { applyAssistantPiEventToBlocks } from "@/features/agent/messages/block-event";
import { runtimeContextUsage } from "@/features/agent/runtime/api";
import { makePiEventApplierHarness, makeSession } from "./agent-fixtures";

test("runtime null context usage clears stale compaction warnings", () => {
  const stale = {
    tokens: 999_999,
    contextWindow: 1_000_000,
    percent: 99.9,
    shouldCompact: true,
  };

  assert.equal(runtimeContextUsage({ contextUsage: null }, stale), null);
});

test("successful compaction suppresses stale runtime compaction warnings until fresh usage", () => {
  const usage = { tokens: 190_000, contextWindow: 200_000, percent: 95 };
  const compactionEvent = {
    type: "compaction_end",
    result: {
      summary: "Compacted",
      firstKeptEntryId: "m2",
      tokensBefore: 190_000,
    },
    aborted: false,
  };

  assert.equal(piEventIsSuccessfulCompaction(compactionEvent), true);
  assert.deepEqual(contextUsageAwaitingFreshCompactionUsage(usage), {
    tokens: null,
    contextWindow: 200_000,
    percent: null,
    shouldCompact: false,
  });
});

test("post-compaction usage stays suppressed when the next prompt reports stale high usage", () => {
  const compactionEvent = {
    type: "compaction_end",
    result: {
      summary: "Compacted",
      firstKeptEntryId: "m2",
      tokensBefore: 190_000,
    },
    aborted: false,
  };
  const staleUsage = {
    tokens: 190_000,
    contextWindow: 200_000,
    percent: 95,
    shouldCompact: true,
  };
  const freshUsage = {
    tokens: 42_000,
    contextWindow: 200_000,
    percent: 21,
    shouldCompact: false,
  };
  const freshButStillCompactableUsage = {
    tokens: 185_000,
    contextWindow: 200_000,
    percent: 92.5,
    shouldCompact: true,
  };

  assert.equal(compactionTokensBefore(compactionEvent), 190_000);
  assert.equal(postCompactionUsageIsFresh(staleUsage, 190_000), false);
  assert.equal(postCompactionUsageIsFresh(freshUsage, 190_000), true);
  assert.equal(
    postCompactionUsageIsFresh(freshButStillCompactableUsage, 190_000),
    true,
  );
});

test("post-compaction prompt guard normalizes replayed assistant timestamps", () => {
  const branch = [
    {
      type: "message",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
    },
    {
      type: "compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    messages: [
      { role: "assistant", timestamp: "2026-06-06T17:00:00.000Z" },
      { role: "user", timestamp: "2026-06-06T17:01:00.000Z" },
      { role: "assistant" },
    ],
    sessionManager: {
      getBranch: () => branch,
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(
    sdkSession.messages[0]?.timestamp,
    Date.parse("2026-06-06T17:00:00.000Z"),
  );
  assert.equal(
    sdkSession.messages[2]?.timestamp,
    Date.parse("2026-06-06T17:02:00.000Z") - 1,
  );
  assert.equal(branch[1]?.timestamp, Date.parse("2026-06-06T17:02:00.000Z"));
});

test("post-compaction prompt guard normalizes resumed Pi agent state messages", () => {
  const branch = [
    {
      type: "message",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
    },
    {
      type: "compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    agent: {
      state: {
        messages: [
          { role: "assistant", timestamp: "2026-06-06T17:00:00.000Z" },
          { role: "assistant", timestamp: "2026-06-06T17:01:00.000Z" },
        ],
      },
    },
    sessionManager: {
      getBranch: () => branch,
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(
    sdkSession.agent.state.messages[0]?.timestamp,
    Date.parse("2026-06-06T17:00:00.000Z"),
  );
  assert.equal(
    sdkSession.agent.state.messages[1]?.timestamp,
    Date.parse("2026-06-06T17:01:00.000Z"),
  );
});

test("post-compaction prompt guard stamps missing pre-boundary assistant timestamps only", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const branch = [
    {
      type: "message",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
    },
    {
      type: "compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    agent: {
      state: {
        messages: [
          { role: "compactionSummary", timestamp: compactionMs },
          {
            role: "assistant",
            usage: { inputTokens: 180_000, outputTokens: 1_000 },
          },
          { role: "user", timestamp: compactionMs + 10_000 },
          { role: "assistant", timestamp: "2026-06-06T17:03:00.000Z" },
        ],
      },
    },
    sessionManager: {
      getBranch: () => branch,
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(sdkSession.agent.state.messages[1]?.timestamp, compactionMs - 1);
  assert.equal(
    sdkSession.agent.state.messages[3]?.timestamp,
    compactionMs + 60_000,
  );
});

test("post-compaction prompt guard copies kept assistant timestamps from branch entries", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const keptAssistant: {
    role: string;
    content: Array<{ type: string; text: string }>;
    usage: { inputTokens: number; outputTokens: number };
    timestamp?: number;
  } = {
    role: "assistant",
    content: [{ type: "text", text: "pre-compaction answer" }],
    usage: { inputTokens: 180_000, outputTokens: 1_000 },
  };
  const sdkSession = {
    agent: {
      state: {
        messages: [
          { role: "compactionSummary", timestamp: compactionMs },
          keptAssistant,
        ],
      },
    },
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          timestamp: "2026-06-06T17:00:00.000Z" as string | number,
          message: keptAssistant,
        },
        {
          type: "compaction",
          timestamp: "2026-06-06T17:02:00.000Z" as string | number,
        },
      ],
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(keptAssistant.timestamp, Date.parse("2026-06-06T17:00:00.000Z"));
});

test("post-compaction prompt guard matches cloned kept messages by content", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const keptContent = [{ type: "text", text: "pre-compaction answer" }];
  const clonedAssistant: {
    role: string;
    content: Array<{ type: string; text: string }>;
    stopReason: string;
    usage: { inputTokens: number; outputTokens: number };
    timestamp?: number;
  } = {
    role: "assistant",
    content: keptContent,
    stopReason: "stop",
    usage: { inputTokens: 180_000, outputTokens: 1_000 },
  };
  const sdkSession = {
    state: {
      messages: [
        { role: "compactionSummary", timestamp: compactionMs },
        clonedAssistant,
      ],
    },
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          timestamp: "2026-06-06T17:00:00.000Z" as string | number,
          message: {
            role: "assistant",
            content: keptContent,
            stopReason: "stop",
          },
        },
        {
          type: "compaction",
          timestamp: "2026-06-06T17:02:00.000Z" as string | number,
        },
      ],
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(
    clonedAssistant.timestamp,
    Date.parse("2026-06-06T17:00:00.000Z"),
  );
});

test("post-compaction prompt guard preserves duplicate cloned assistant order", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const repeatedContent = [{ type: "text", text: "Done" }];
  const preCompactionClone: {
    role: string;
    content: Array<{ type: string; text: string }>;
    stopReason: string;
    usage: { inputTokens: number; outputTokens: number };
    timestamp?: number;
  } = {
    role: "assistant",
    content: repeatedContent,
    stopReason: "stop",
    usage: { inputTokens: 180_000, outputTokens: 1_000 },
  };
  const postCompactionClone: typeof preCompactionClone = {
    role: "assistant",
    content: repeatedContent,
    stopReason: "stop",
    usage: { inputTokens: 10_000, outputTokens: 100 },
  };
  const sdkSession = {
    state: {
      messages: [
        { role: "compactionSummary", timestamp: compactionMs },
        preCompactionClone,
        { role: "user", timestamp: compactionMs + 10_000 },
        postCompactionClone,
      ],
    },
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          timestamp: "2026-06-06T17:00:00.000Z" as string | number,
          message: {
            role: "assistant",
            content: repeatedContent,
            stopReason: "stop",
          },
        },
        {
          type: "compaction",
          timestamp: "2026-06-06T17:02:00.000Z" as string | number,
        },
        {
          type: "message",
          timestamp: "2026-06-06T17:03:00.000Z" as string | number,
          message: {
            role: "assistant",
            content: repeatedContent,
            stopReason: "stop",
          },
        },
      ],
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(
    preCompactionClone.timestamp,
    Date.parse("2026-06-06T17:00:00.000Z"),
  );
  assert.equal(
    postCompactionClone.timestamp,
    Date.parse("2026-06-06T17:03:00.000Z"),
  );
});

test("post-compaction prompt decision skips stale kept assistant usage", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const keptAssistant: {
    role: string;
    content: Array<{ type: string; text: string }>;
    stopReason: string;
    usage: { inputTokens: number; outputTokens: number };
    timestamp?: number;
  } = {
    role: "assistant",
    content: [{ type: "text", text: "large pre-compaction answer" }],
    stopReason: "stop",
    usage: { inputTokens: 180_000, outputTokens: 10_000 },
  };
  const compactionEvent = {
    type: "compaction_end",
    result: {
      summary: "Compacted",
      firstKeptEntryId: "kept",
      tokensBefore: 190_000,
    },
  };
  const branch = [
    {
      type: "message",
      id: "kept",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
      message: {
        role: "assistant",
        content: keptAssistant.content,
        stopReason: "stop",
      },
    },
    {
      type: "compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    state: {
      messages: [
        { role: "compactionSummary", timestamp: compactionMs },
        keptAssistant,
      ],
    },
    sessionManager: {
      getBranch: () => branch,
    },
  };
  const staleHighUsage = {
    tokens: 190_000,
    contextWindow: 200_000,
    percent: 95,
    shouldCompact: true,
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(keptAssistant.timestamp, Date.parse("2026-06-06T17:00:00.000Z"));
  assert.equal(
    keptAssistant.timestamp <= compactionMs,
    true,
    "SDK pre-prompt compaction check should treat kept assistant usage as pre-boundary",
  );
  assert.equal(
    postCompactionUsageIsFresh(
      staleHighUsage,
      compactionTokensBefore(compactionEvent),
    ),
    false,
    "runtime status should keep stale high usage suppressed until fresh assistant usage arrives",
  );
});

test("post-compaction prompt guard accepts compaction-like boundary entry types", () => {
  const compactionMs = Date.parse("2026-06-06T17:02:00.000Z");
  const branch = [
    {
      type: "message",
      timestamp: "2026-06-06T17:00:00.000Z" as string | number,
    },
    {
      type: "context_compaction",
      timestamp: "2026-06-06T17:02:00.000Z" as string | number,
    },
  ];
  const sdkSession = {
    messages: [
      {
        role: "assistant",
        usage: { inputTokens: 180_000, outputTokens: 1_000 },
      },
    ],
    sessionManager: {
      getBranch: () => branch,
    },
  };

  assert.equal(
    normalizeSdkMessageTimestampsForCompactionBoundary(sdkSession),
    true,
  );
  assert.equal(sdkSession.messages[0]?.timestamp, compactionMs - 1);
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
