// Golden characterization test for the CURRENT live event path:
// runtime/pi-event-applier.ts reduceSessionEvent folded over a realistic
// live-shaped LoggedPiEvent turn, invoked exactly the way
// session-runtime-controller.ts invokes it today (external ensureAssistantId
// targeting + the shared SessionStreamContext.liveAssistantIds map, with the
// map cleared after agent_end).
//
// This pins the live-fold output so the one-reducer consolidation can (a)
// replace the canonical replay with a fold over this same reducer and (b)
// move assistant-bubble targeting INSIDE the reducer — in both cases this
// golden must stay byte-identical through the shared projection
// (scripts/replay-projection.ts). No internal function identities are
// asserted, only output shapes.
//
// Event shapes mirror pi's runtime stream (message_start/update/end with full
// accumulated snapshots + assistantMessageEvent deltas, tool_execution_*,
// agent_start/agent_end) as consumed by pi-event-applier.ts and exercised in
// tests/frontend/e2e/session-runtime-controller.test.ts.
//
// Regenerate intentionally with:
//   UPDATE_GOLDENS=1 bun test scripts/live-fold-golden.test.ts
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  reduceSessionEvent,
  type SessionStreamContext,
} from "../src/features/agent/runtime/pi-event-applier";
import type { Session, SessionId } from "../src/features/agent/runtime/types";
import { projectMessages, type ProjectedMessage } from "./replay-projection";

const goldenPath = join(
  new URL("./fixtures/", import.meta.url).pathname,
  "live-fold-turn.golden.json",
);

type LiveFoldGolden = {
  messages: ProjectedMessage[];
  status: string;
  error: string;
  tokenStats: Session["tokenStats"] | null;
  activeAssistantCleared: boolean;
};

let idCounter = 0;
const testId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;

// Fold a live event sequence the way the controller does today: resolve the
// target assistant bubble OUTSIDE the reducer (liveAssistantIds override →
// activeAssistantId → last assistant message → open a new bubble), then hand
// reduceSessionEvent one event at a time, dropping the liveAssistantIds
// redirect once the turn ends (mirrors applyPiPayload + ensureAssistantId in
// session-runtime-controller.ts).
function foldLiveEvents(events: Record<string, unknown>[]): {
  session: Session;
  activeAssistantCleared: boolean;
} {
  const sessionId: SessionId = "tab-live-fold";
  const ctx: SessionStreamContext = { liveAssistantIds: new Map() };
  let session: Session = {
    id: sessionId,
    runtimeSessionId: "rt-live-fold",
    piSessionId: "pi-live-fold",
    title: "Live fold golden",
    messages: [{ id: "user-1", role: "user", text: "synthetic live prompt" }],
    status: "running",
    error: "",
    input: "",
  };
  let activeAssistantCleared = false;

  const ensureAssistantId = (): string => {
    const liveAssistantId = ctx.liveAssistantIds.get(sessionId);
    if (liveAssistantId) return liveAssistantId;
    const existing =
      (session.activeAssistantId &&
        session.messages.some((message) => message.id === session.activeAssistantId) &&
        session.activeAssistantId) ||
      [...session.messages].reverse().find((message) => message.role === "assistant")?.id;
    if (existing) {
      session = { ...session, activeAssistantId: existing };
      return existing;
    }
    const assistantId = testId("assistant");
    session = {
      ...session,
      activeAssistantId: assistantId,
      messages: [
        ...session.messages,
        { id: assistantId, role: "assistant", text: "", blocks: [] },
      ],
    };
    return assistantId;
  };

  for (const event of events) {
    const assistantId = ensureAssistantId();
    if (event.type === "agent_end") {
      session = {
        ...reduceSessionEvent(session, ctx, assistantId, event),
        status: "idle",
        activeAssistantId: undefined,
      };
      activeAssistantCleared = true;
      ctx.liveAssistantIds.delete(sessionId);
      continue;
    }
    session = reduceSessionEvent(session, ctx, assistantId, event);
  }
  return { session, activeAssistantCleared };
}

// A realistic tool-heavy live turn: first LLM call streams thinking + text +
// a tool call, the tool executes, a mid-stream user steer opens the next
// assistant bubble, and a second LLM call streams the closing summary.
function liveToolTurnEvents(): Record<string, unknown>[] {
  const toolArgs = { path: "/tmp/live-fold/a.txt" };
  const call1 = (content: Array<Record<string, unknown>>) => ({
    role: "assistant",
    content,
  });
  const firstThinking = { type: "thinking", thinking: "synthetic live thinking" };
  const firstText = { type: "text", text: "synthetic live lead-in" };
  const firstTool = { type: "toolCall", id: "live-call-1", name: "read_file", arguments: toolArgs };
  return [
    { type: "agent_start" },
    { type: "message_start", message: call1([]) },
    {
      type: "message_update",
      message: call1([firstThinking]),
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "synthetic live thinking",
        contentIndex: 0,
        partial: call1([firstThinking]),
      },
    },
    {
      type: "message_update",
      message: call1([firstThinking, firstText]),
      assistantMessageEvent: {
        type: "text_delta",
        delta: "synthetic live lead-in",
        contentIndex: 1,
        partial: call1([firstThinking, firstText]),
      },
    },
    {
      type: "message_update",
      message: call1([firstThinking, firstText, { type: "toolCall", id: "live-call-1", name: "read_file", arguments: {} }]),
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 2,
        partial: call1([firstThinking, firstText, { type: "toolCall", id: "live-call-1", name: "read_file", arguments: {} }]),
      },
    },
    {
      type: "message_update",
      message: call1([firstThinking, firstText, firstTool]),
      assistantMessageEvent: {
        type: "toolcall_delta",
        delta: JSON.stringify(toolArgs),
        contentIndex: 2,
        partial: call1([firstThinking, firstText, firstTool]),
      },
    },
    {
      type: "message_update",
      message: call1([firstThinking, firstText, firstTool]),
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 2,
        toolCall: firstTool,
        partial: call1([firstThinking, firstText, firstTool]),
      },
    },
    {
      type: "message_end",
      message: {
        ...call1([firstThinking, firstText, firstTool]),
        stopReason: "toolUse",
        usage: { input: 12, output: 34, totalTokens: 46 },
      },
    },
    { type: "tool_execution_start", toolCallId: "live-call-1", toolName: "read_file" },
    {
      type: "tool_execution_update",
      toolCallId: "live-call-1",
      partialResult: { content: [{ type: "text", text: "synthetic partial output" }] },
    },
    {
      type: "tool_execution_end",
      toolCallId: "live-call-1",
      isError: false,
      result: { content: [{ type: "text", text: "synthetic tool output" }] },
    },
    // Mid-stream steer echo: opens the NEXT assistant bubble; the second LLM
    // call below must land there via ctx.liveAssistantIds.
    {
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: "synthetic steer note" }] },
    },
    { type: "message_start", message: call1([]) },
    {
      type: "message_update",
      message: call1([{ type: "text", text: "synthetic closing summary" }]),
      assistantMessageEvent: {
        type: "text_delta",
        delta: "synthetic closing summary",
        contentIndex: 0,
        partial: call1([{ type: "text", text: "synthetic closing summary" }]),
      },
    },
    {
      type: "message_end",
      message: {
        ...call1([{ type: "text", text: "synthetic closing summary" }]),
        stopReason: "stop",
        usage: { input: 60, output: 8, totalTokens: 68 },
      },
    },
    { type: "agent_end" },
  ];
}

function liveFoldProjection(): LiveFoldGolden {
  idCounter = 0;
  const { session, activeAssistantCleared } = foldLiveEvents(liveToolTurnEvents());
  return {
    messages: projectMessages(session.messages),
    status: String(session.status),
    error: session.error,
    tokenStats: session.tokenStats ?? null,
    activeAssistantCleared,
  };
}

test("live fold of a tool-heavy turn through reduceSessionEvent matches the checked-in golden", () => {
  const projection = liveFoldProjection();
  if (process.env.UPDATE_GOLDENS) {
    writeFileSync(goldenPath, `${JSON.stringify(projection, null, 2)}\n`);
  }
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as LiveFoldGolden;
  assert.deepEqual(projection, golden);
});

test("live fold is deterministic across runs (no wall-clock leakage)", () => {
  assert.deepEqual(liveFoldProjection(), liveFoldProjection());
});

test("live fold settles all tool badges and clears the target bubble's streamCalls at agent_end", () => {
  idCounter = 0;
  const { session } = foldLiveEvents(liveToolTurnEvents());
  for (const message of session.messages) {
    for (const block of message.blocks ?? []) {
      if (block.kind === "tool") assert.notEqual(block.status, "running");
    }
  }
  // CURRENT behavior: agent_end finalizes only the bubble live events target
  // (the steer-opened second bubble); the first bubble's transient streamCalls
  // survive in memory. The consolidation must keep the projected output
  // identical either way — this pins the settled target explicitly.
  const lastAssistant = [...session.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  assert.ok(lastAssistant);
  assert.equal(lastAssistant.streamCalls, undefined);
});
