// Turn-loop contract test: runs ONE full turn (prompt -> text deltas -> tool
// call -> tool result -> final text -> agent_end) through the REAL pi SDK
// session machinery with a scripted mock model, then freezes:
//   (a) the PiSdkSession event ring buffer (ordering, seq monotonicity),
//   (b) the serialized event payload contract (runtime-schema decoders — the
//       exact shapes the /api/agent/runtime/events + /status routes emit),
//   (c) status derivation through piStatusFromEvents.
// Later refactor phases must keep this test green unchanged.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  decodeRuntimeEventPayload,
  decodeRuntimeStatusResponse,
} from "@/features/agent/runtime/runtime-schema";
import { isAgentEndEvent } from "@/features/agent/pi-runtime-state";
import type { LoggedPiEvent } from "@/features/agent/pi-runtime-types";
import {
  createTestRuntimeManager,
  type TestRuntimeHarness,
} from "../../support/agent/create-test-runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "../../support/agent/mock-model";

const FILE_CONTENT = "hello from the harness";
const LEAD_IN_TEXT = "Let me read the notes file first.";
const FINAL_TEXT = `The file says: ${FILE_CONTENT}.`;

let harness: TestRuntimeHarness;
let logged: LoggedPiEvent[] = [];
let streamed: Array<{ seq: number; event: Record<string, unknown> }> = [];

beforeAll(async () => {
  harness = await createTestRuntimeManager();
  await writeFile(path.join(harness.cwd, "notes.txt"), FILE_CONTENT, "utf-8");

  // Scripted model: turn 1 streams text deltas then a real `read` tool call;
  // after the SDK executes the tool for real, turn 2 streams the final text.
  harness.faux.setResponses([
    fauxAssistantMessage(
      [fauxText(LEAD_IN_TEXT), fauxToolCall("read", { path: "notes.txt" }, { id: "call_1" })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(FINAL_TEXT),
  ]);

  await harness.session.ensureStarted(harness.modelId, harness.cwd);
  await harness.session.prompt("Read notes.txt and tell me what it says.", (event, seq) => {
    streamed.push({ seq, event: event as Record<string, unknown> });
  });
  logged = harness.session.getEventsAfter(0);
}, 60_000);

afterAll(async () => {
  await harness?.cleanup();
});

function eventTypes(): string[] {
  return logged.map((entry) => String((entry.event as { type?: unknown }).type));
}

function firstIndex(type: string): number {
  return eventTypes().indexOf(type);
}

// ---------------------------------------------------------------------------
// (a) Ring buffer: seq monotonicity + turn-loop ordering
// ---------------------------------------------------------------------------

test("scripted turn produced a non-empty ring buffer with contiguous seqs from 1", () => {
  expect(logged.length).toBeGreaterThan(0);
  logged.forEach((entry, index) => {
    expect(entry.seq).toBe(index + 1);
    expect(typeof entry.timestamp).toBe("string");
  });
});

test("prompt callback saw exactly the logged events, in order", () => {
  expect(streamed.map((entry) => entry.seq)).toEqual(logged.map((entry) => entry.seq));
  streamed.forEach((entry, index) => {
    expect(entry.event).toBe(logged[index].event as Record<string, unknown>);
  });
});

test("turn loop ordering: agent_start -> turn -> deltas -> tool -> final turn -> agent_end", () => {
  const types = eventTypes();
  const order = [
    "agent_start",
    "turn_start",
    "message_start",
    "message_update",
    "tool_execution_start",
    "tool_execution_end",
    "turn_end",
    "agent_end",
  ];
  for (let i = 1; i < order.length; i++) {
    const prev = firstIndex(order[i - 1]);
    const next = firstIndex(order[i]);
    expect(prev).toBeGreaterThanOrEqual(0);
    expect(next).toBeGreaterThan(prev);
  }
  // One model call per turn: the tool-call turn plus the final-text turn.
  expect(types.filter((type) => type === "turn_start")).toHaveLength(2);
  expect(types.filter((type) => type === "turn_end")).toHaveLength(2);
  // agent_end terminates the run and is the last logged event.
  expect(types.filter((type) => type === "agent_end")).toHaveLength(1);
  expect(isAgentEndEvent(logged[logged.length - 1].event)).toBe(true);
});

test("the real read tool executed against the workspace file", () => {
  const start = logged
    .map((entry) => entry.event as Record<string, unknown>)
    .find((event) => event.type === "tool_execution_start");
  expect(start).toBeDefined();
  expect(start?.toolName).toBe("read");
  expect(start?.toolCallId).toBe("call_1");

  const end = logged
    .map((entry) => entry.event as Record<string, unknown>)
    .find((event) => event.type === "tool_execution_end");
  expect(end).toBeDefined();
  expect(end?.isError).toBe(false);
  expect(JSON.stringify(end?.result)).toContain(FILE_CONTENT);
});

test("streamed text deltas reassemble into the scripted assistant messages verbatim", () => {
  const assistantTexts = logged
    .map((entry) => entry.event as { type?: string; message?: { role?: string; content?: unknown } })
    .filter((event) => event.type === "message_end" && event.message?.role === "assistant")
    .map((event) =>
      (event.message?.content as Array<{ type: string; text?: string }>)
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(""),
    );
  expect(assistantTexts).toEqual([LEAD_IN_TEXT, FINAL_TEXT]);

  // Deltas actually streamed (more than one chunk) rather than one blob.
  const textDeltas = logged
    .map((entry) => entry.event as { type?: string; assistantMessageEvent?: { type?: string; delta?: unknown } })
    .filter(
      (event) =>
        event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta",
    );
  expect(textDeltas.length).toBeGreaterThan(1);
  for (const delta of textDeltas) {
    expect(typeof delta.assistantMessageEvent?.delta).toBe("string");
  }
});

// ---------------------------------------------------------------------------
// (b) Frozen serialization contract (runtime-schema decoders)
// ---------------------------------------------------------------------------

test("every logged event survives the /events route wire format and decodes", () => {
  for (const entry of logged) {
    // Exactly how the events route frames each SSE data payload.
    const wire = JSON.parse(
      JSON.stringify({ type: "pi", seq: entry.seq, event: entry.event }),
    ) as unknown;
    const decoded = decodeRuntimeEventPayload(wire);
    expect(decoded).not.toBeNull();
    if (decoded?.type !== "pi") throw new Error(`expected pi payload, got ${decoded?.type}`);
    expect(decoded.seq).toBe(entry.seq);
    expect(decoded.event.type).toBe((entry.event as { type?: unknown }).type);
  }
});

test("status + events survive the /status route wire format and decode", () => {
  const wire = JSON.parse(
    JSON.stringify({ status: harness.session.status, events: logged }),
  ) as unknown;
  const decoded = decodeRuntimeStatusResponse(wire);
  expect(decoded).not.toBeNull();
  expect(decoded?.status.eventSeq).toBe(logged.length);
  expect(decoded?.status.running).toBe(true);
  expect(decoded?.status.active).toBe(false);
  expect(decoded?.events).toHaveLength(logged.length);
  // The SDK computed real usage from the faux stream; the frozen context-usage
  // shape must decode (schema union enforces the exact field set).
  expect(decoded?.status.contextUsage).not.toBeNull();
  expect(decoded?.status.contextUsage?.contextWindow).toBeGreaterThan(0);
  expect(decoded?.status.contextUsage?.shouldCompact).toBe(false);
});

test("status route wire format decodes a status-phase event payload", () => {
  const wire = JSON.parse(
    JSON.stringify({ type: "status", phase: "done", session: harness.session.status }),
  ) as unknown;
  const decoded = decodeRuntimeEventPayload(wire);
  expect(decoded).not.toBeNull();
  if (decoded?.type !== "status") throw new Error(`expected status payload, got ${decoded?.type}`);
  expect(decoded.phase).toBe("done");
  expect(decoded.session?.piSessionId).toBe(harness.session.status.piSessionId);
});

// ---------------------------------------------------------------------------
// (c) Status derivation (piStatusFromEvents via PiSdkSession.status)
// ---------------------------------------------------------------------------

test("post-turn status derives idle-but-running with a real pi session id", () => {
  const status = harness.session.status;
  expect(status.running).toBe(true);
  expect(status.active).toBe(false);
  expect(status.modelId).toBe(harness.modelId);
  expect(status.cwd).toBe(harness.cwd);
  expect(typeof status.piSessionId).toBe("string");
  expect(status.piSessionId?.length).toBeGreaterThan(0);
  expect(status.agentDir).toContain(harness.dataDir);
  expect(status.eventSeq).toBe(logged.length);
  expect(status.lastError).toBeNull();
});

test("getEventsAfter respects the seq cursor", () => {
  const mid = Math.floor(logged.length / 2);
  const tail = harness.session.getEventsAfter(mid);
  expect(tail).toHaveLength(logged.length - mid);
  expect(tail[0]?.seq).toBe(mid + 1);
  expect(harness.session.getEventsAfter(logged.length)).toHaveLength(0);
});
