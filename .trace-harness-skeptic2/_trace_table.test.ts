import test from "node:test";
import {
  applyAssistantPiEventToBlocks,
} from "@/features/agent/messages/block-event";
import { blocksFromTurnSnapshots, messageTextFromBlocks } from "@/features/agent/messages/message-content";
import type { AssistantBlock } from "@/features/agent/messages/types";

function textOf(blocks: AssistantBlock[] | null): string {
  if (!blocks) return "<null>";
  return blocks
    .filter((b) => b.kind === "text")
    .map((b) => (b as { text: string }).text)
    .join("|");
}

function show(s: string): string {
  return JSON.stringify(s);
}

// ---------------------------------------------------------------------------
// SCENARIO A: DELTA PATH (appendDelta -> appendToTextLikeBlock)
// This path is hit by replay.ts for message_update, and by the live applier
// whenever event.message is absent (snapshot path returns null).
//
// A realistic markdown table streamed as incremental text_delta chunks.
// Models commonly emit standalone "\n" deltas between rows.
// ---------------------------------------------------------------------------

function deltaEvent(delta: string) {
  return { type: "message_update", assistantMessageEvent: { type: "text_delta", delta } };
}

test("TRACE A: table streamed as incremental deltas through appendDelta", () => {
  const deltas = [
    "| Col A | Col B |",
    "\n",
    "| --- | --- |",
    "\n",
    "| 1 | 2 |",
    "\n",
    "| 1 | 4 |", // NOTE: row that re-emits a prefix-ish pattern
  ];
  let blocks: AssistantBlock[] = [];
  console.log("\n=== TRACE A (incremental deltas, delta path) ===");
  for (const d of deltas) {
    blocks = applyAssistantPiEventToBlocks(blocks, deltaEvent(d)) ?? blocks;
    console.log(`delta=${show(d).padEnd(20)} -> acc=${show(textOf(blocks))}`);
  }
  const expected = deltas.join("");
  console.log("EXPECTED:", show(expected));
  console.log("ACTUAL  :", show(textOf(blocks)));
  console.log("MATCH   :", textOf(blocks) === expected);
});

// ---------------------------------------------------------------------------
// SCENARIO B: the re-slice / startsWith trap.
// A delta whose value equals a prefix already present at the START of the
// accumulated block. block.text.startsWith(delta) with trimmed delta non-empty
// => the whole delta is dropped as a "replay".
// ---------------------------------------------------------------------------

test("TRACE B: a real content delta equal to an existing prefix line", () => {
  // Model emits a table where a later data delta exactly repeats the header
  // separator text that already sits at the front of the block.
  const deltas = [
    "| --- |", // first line
    "\n| a |",
    "\n",
    "| --- |", // a SECOND, legitimate "| --- |" (e.g. a nested/second table separator)
  ];
  let blocks: AssistantBlock[] = [];
  console.log("\n=== TRACE B (legit repeat of a leading line) ===");
  for (const d of deltas) {
    blocks = applyAssistantPiEventToBlocks(blocks, deltaEvent(d)) ?? blocks;
    console.log(`delta=${show(d).padEnd(14)} -> acc=${show(textOf(blocks))}`);
  }
  const expected = deltas.join("");
  console.log("EXPECTED:", show(expected));
  console.log("ACTUAL  :", show(textOf(blocks)));
  console.log("DROPPED? :", textOf(blocks) !== expected);
});

// ---------------------------------------------------------------------------
// SCENARIO B2: the FULL leading line repeated (block.text starts with delta).
// ---------------------------------------------------------------------------

test("TRACE B2: delta equals the entire current block prefix", () => {
  // Two-element table: header line, then the SAME header line appears later as
  // a content delta while it is still a prefix of the whole block.
  const deltas = [
    "Total",   // block.text = "Total"
    " = 5\n",  // block.text = "Total = 5\n"
    "Total",   // delta "Total" -> block.text.startsWith("Total") is TRUE -> dropped!
    " = 9",
  ];
  let blocks: AssistantBlock[] = [];
  console.log("\n=== TRACE B2 (delta is a prefix of accumulated block) ===");
  for (const d of deltas) {
    blocks = applyAssistantPiEventToBlocks(blocks, deltaEvent(d)) ?? blocks;
    console.log(`delta=${show(d).padEnd(10)} -> acc=${show(textOf(blocks))}`);
  }
  const expected = deltas.join("");
  console.log("EXPECTED:", show(expected));
  console.log("ACTUAL  :", show(textOf(blocks)));
  console.log("DROPPED? :", textOf(blocks) !== expected);
});

// ---------------------------------------------------------------------------
// SCENARIO C: SNAPSHOT vs DELTA mismatch through the re-slice branch.
// When a provider emits the delta as a CUMULATIVE snapshot (delta startsWith
// block.text) the re-slice branch slices. But if the snapshot is NOT an exact
// superstring (e.g. earlier whitespace normalized), append falls back to the
// whole delta and DUPLICATES.
// ---------------------------------------------------------------------------

test("TRACE C: cumulative-snapshot delta where re-slice mis-fires", () => {
  // Some upstreams (mis)send the FULL accumulated text each tick as `delta`.
  const snapshots = [
    "| A | B |\n",
    "| A | B |\n| - | - |\n",          // cumulative
    "| A | B |\n| - | - |\n| 1 | 2 |", // cumulative
  ];
  let blocks: AssistantBlock[] = [];
  console.log("\n=== TRACE C (cumulative deltas: re-slice path) ===");
  for (const d of snapshots) {
    blocks = applyAssistantPiEventToBlocks(blocks, deltaEvent(d)) ?? blocks;
    console.log(`acc=${show(textOf(blocks))}`);
  }
  console.log("FINAL   :", show(textOf(blocks)));
  console.log("EXPECTED:", show(snapshots[snapshots.length - 1]));
});

test("TRACE C2: cumulative deltas where a cell value changes mid-stream", () => {
  // Cumulative, but the model 'corrects' a cell: tick3 is NOT a superstring of tick2.
  const snapshots = [
    "| total |\n",
    "| total |\n| 100 |",   // block.text after = "| total |\n| 100 |"
    "| total |\n| 1000 |",  // NOT startsWith("...100"); whole delta appended -> dup
  ];
  let blocks: AssistantBlock[] = [];
  console.log("\n=== TRACE C2 (cumulative + corrected cell) ===");
  for (const d of snapshots) {
    blocks = applyAssistantPiEventToBlocks(blocks, deltaEvent(d)) ?? blocks;
    console.log(`delta=${show(d)}\n   -> acc=${show(textOf(blocks))}`);
  }
  console.log("FINAL   :", show(textOf(blocks)));
  console.log("EXPECTED:", show(snapshots[snapshots.length - 1]));
  console.log("DUPLICATED?:", textOf(blocks) !== snapshots[snapshots.length - 1]);
});

// ---------------------------------------------------------------------------
// SCENARIO D: SNAPSHOT PATH (blocksFromTurnSnapshots) for the same table.
// calls[i] = full accumulated content array of the i-th LLM call.
// Here a table spans a tool boundary across two calls.
// ---------------------------------------------------------------------------

test("TRACE D: table split across two LLM calls via snapshot path", () => {
  // call 0: text before tool, plus a tool call. call 1: rest of the table.
  const call0 = [
    { type: "text", text: "Here is the table:\n\n| A | B |\n| - | - |\n" },
    { type: "toolCall", id: "t1", name: "calc", arguments: "{}" },
  ];
  const call1 = [
    { type: "text", text: "| 1 | 2 |\n| 3 | 4 |\n" },
  ];
  const blocks = blocksFromTurnSnapshots([call0, call1]);
  console.log("\n=== TRACE D (snapshot path, table across tool boundary) ===");
  for (const b of blocks) {
    console.log(`${b.kind}: ${show((b as { text?: string }).text ?? "")}`);
  }
  console.log("messageTextFromBlocks:", show(messageTextFromBlocks(blocks)));
});
