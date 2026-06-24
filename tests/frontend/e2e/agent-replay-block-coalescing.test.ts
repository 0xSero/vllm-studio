import assert from "node:assert/strict";
import test from "node:test";

import {
  blocksFromMessageContent,
  blocksFromTurnSnapshots,
} from "@/features/agent/messages/message-content";

// A markdown table whose boundary falls mid-table across two adjacent text
// parts of one settled message — the empirically-observed shape that rendered
// correctly live but mangled into raw GFM fragments after replay/reload.
const HEAD = "Here is the result:\n\n| col a | col b |\n| --- | --- |\n";
const TAIL = "| a1 | b1 |\n| a2 | b2 |\n";

test("replay coalesces adjacent text parts so a split table becomes one block (matches live)", () => {
  const replayBlocks = blocksFromMessageContent([
    { type: "text", text: HEAD },
    { type: "text", text: TAIL },
  ]);
  const textBlocks = replayBlocks.filter((b) => b.kind === "text");
  assert.equal(textBlocks.length, 1, "adjacent text parts must merge into a single text block");
  assert.equal((textBlocks[0] as { text: string }).text, HEAD + TAIL);

  // The live snapshot path already merges; assert replay now yields the same
  // single-block, same-text result so a turn renders identically either way.
  const liveBlocks = blocksFromTurnSnapshots([
    [
      { type: "text", text: HEAD },
      { type: "text", text: TAIL },
    ],
  ]);
  const liveText = liveBlocks.filter((b) => b.kind === "text");
  assert.equal(liveText.length, 1);
  assert.equal((liveText[0] as { text: string }).text, (textBlocks[0] as { text: string }).text);
});

test("a tool call between two text parts still splits the bubble (no over-merge)", () => {
  const blocks = blocksFromMessageContent(
    [
      { type: "text", text: "before" },
      { type: "toolCall", id: "tc1", name: "run", arguments: "{}" },
      { type: "text", text: "after" },
    ],
    { stopReason: "toolUse" },
  );
  const text = blocks.filter((b) => b.kind === "text");
  const tools = blocks.filter((b) => b.kind === "tool");
  assert.equal(tools.length, 1, "tool block preserved");
  // "before" precedes the tool call and is reclassified as thinking under
  // toolUse; "after" stays text. The point: text is NOT merged across the tool.
  assert.ok(text.every((b) => (b as { text: string }).text !== "beforeafter"), "no cross-tool merge");
});
