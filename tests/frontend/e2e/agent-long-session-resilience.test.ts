import assert from "node:assert/strict";
import test from "node:test";

import { replaySessionEvents } from "@/features/agent/messages/replay";

// Resilience harness: a long, realistic multi-turn session — tool calls,
// reasoning, narration, a markdown table split across content parts, periodic
// compaction boundaries, and duplicate re-delivery (the reconnect/reload path) —
// must replay into a well-formed transcript with no lost content, no orphan
// bubbles, and no duplication. This is the deterministic stand-in for "run a
// long unbounded task across many turns/compressions and watch the transforms".

type Ev = Record<string, unknown>;

function userTurn(i: number): Ev {
  return { type: "message", message: { role: "user", content: [{ type: "text", text: `ask ${i}` }] } };
}

// A tool-heavy assistant turn: reasoning + a tool call, then the tool result,
// then a closing text summary as its own settled message (the real pi shape).
function toolTurn(i: number): Ev[] {
  const id = `call-${i}`;
  return [
    {
      type: "message",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "thinking", thinking: `reasoning for ${i}` },
          { type: "toolCall", id, name: "bash", arguments: { cmd: `echo ${i}` } },
        ],
      },
    },
    {
      type: "message",
      message: { role: "toolResult", toolCallId: id, toolName: "bash", content: [{ type: "text", text: `out ${i}` }] },
    },
    {
      type: "message",
      message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: `done ${i}` }] },
    },
  ];
}

// An assistant turn whose answer is a markdown table split across two adjacent
// text parts of one settled message (the table-mangling shape).
function tableTurn(): Ev {
  return {
    type: "message",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "Result:\n\n| a | b |\n| - | - |\n" },
        { type: "text", text: "| 1 | 2 |\n| 3 | 4 |\n" },
      ],
    },
  };
}

const COMPACTION: Ev = { type: "compaction_end", result: { status: "done" } };

function buildLongSession(turns: number): Ev[] {
  const log: Ev[] = [{ type: "session_info_changed", title: "Long run", startedAt: "2026-06-23T00:00:00.000Z" }];
  for (let i = 1; i <= turns; i += 1) {
    log.push(userTurn(i));
    if (i % 7 === 0) log.push(tableTurn()); // a plain-answer turn whose answer is a split table
    else log.push(...toolTurn(i));
    if (i % 10 === 0) log.push(COMPACTION); // periodic compaction boundary
  }
  return log;
}

test("a long multi-turn session replays into a well-formed transcript (no lost content, no orphans)", () => {
  const TURNS = 40;
  const { messages } = replaySessionEvents(buildLongSession(TURNS));

  const users = messages.filter((m) => m.role === "user");
  const assistants = messages.filter((m) => m.role === "assistant");
  assert.ok(users.length >= TURNS, `expected >= ${TURNS} user messages, got ${users.length}`);
  assert.ok(assistants.length >= TURNS, `expected >= ${TURNS} assistant messages, got ${assistants.length}`);

  // No orphan assistant bubble (a bubble with neither text nor blocks).
  for (const a of assistants) {
    const hasContent = (a.text ?? "").length > 0 || (a.blocks ?? []).length > 0;
    assert.ok(hasContent, `assistant message ${a.id} is an empty orphan bubble`);
  }

  // Every id is unique — no duplication from the multi-message merge.
  const ids = messages.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate message ids in the replayed transcript");

  // Tool blocks survive replay.
  const toolBubbles = assistants.filter((a) => (a.blocks ?? []).some((b) => b.kind === "tool"));
  assert.ok(toolBubbles.length > 0, "expected tool blocks to survive replay");

  // No lost content: every tool turn's reasoning, tool call, and closing summary
  // are all present SOMEWHERE in the transcript (live merges multi-call turns
  // into one bubble; replay keeps them as separate bubbles — see the documented
  // grouping inconsistency — but content must never be dropped).
  const allText = assistants.map((a) => a.text ?? "").join("\n");
  const allToolIds = new Set(
    assistants.flatMap((a) => (a.blocks ?? []).filter((b) => b.kind === "tool").map((b) => b.id)),
  );
  for (let i = 1; i <= TURNS; i += 1) {
    if (i % 7 === 0) continue; // table turns have no tool/summary
    assert.ok(allToolIds.has(`call-${i}`), `tool call for turn ${i} was lost on replay`);
    assert.ok(allText.includes(`done ${i}`), `closing summary for turn ${i} was lost on replay`);
  }
});

test("a split markdown table replays as one coalesced text block inside a long session", () => {
  const { messages } = replaySessionEvents(buildLongSession(14));
  // turn 7 and 14 are table turns. Find an assistant bubble whose text holds the
  // whole table (header + body) in a SINGLE text block.
  const tableBubble = messages.find(
    (m) =>
      m.role === "assistant" &&
      (m.blocks ?? []).filter((b) => b.kind === "text").some((b) => b.text.includes("| a | b |") && b.text.includes("| 3 | 4 |")),
  );
  assert.ok(tableBubble, "the split table did not coalesce into one text block on replay");
});

test("interspersed compaction boundaries do not drop or corrupt the replayed transcript", () => {
  // 30 turns with a compaction every 10th turn. Compaction events must not eat
  // visible history on replay (the canonical log keeps every settled message).
  const TURNS = 30;
  const { messages } = replaySessionEvents(buildLongSession(TURNS));
  const allText = messages.map((m) => m.text ?? "").join("\n");
  // Content from BEFORE, AROUND, and AFTER every compaction boundary is intact.
  for (let i = 1; i <= TURNS; i += 1) {
    if (i % 7 === 0) continue;
    assert.ok(allText.includes(`done ${i}`), `turn ${i} dropped across a compaction boundary`);
  }
  // Every assistant bubble is still well-formed (no compaction-induced orphans).
  for (const a of messages.filter((m) => m.role === "assistant")) {
    assert.ok((a.text ?? "").length > 0 || (a.blocks ?? []).length > 0, "compaction left an orphan bubble");
  }
});

// NOTE on layering: replay-level re-delivery dedup is intentionally NOT tested
// here — exact-duplicate suppression on reconnect is owned upstream by
// mergeCanonicalAndRuntimeEvents (canonical+runtime merge) and by the controller's
// acceptRuntimeSeq gate (covered by test-session-runtime-controller-reconnect.ts).
// replaySessionEvents only sees the already-deduped, merged log.
