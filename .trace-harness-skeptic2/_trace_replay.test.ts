import test from "node:test";
import { replaySessionEvents } from "@/features/agent/messages/replay";

function show(s: string): string {
  return JSON.stringify(s);
}

// Reproduce the REPLAY path (reattach to a mid-stream turn): runtime eventLog
// contains message_update events with INCREMENTAL deltas. replaySessionEvents
// routes them through applyAssistantPiEventToBlocks -> appendDelta because
// replayMessageFromEvent only matches "message"/"message_end".
//
// Each runtime message_update from the SDK looks like:
//   { type: "message_update",
//     message: { role:"assistant", content:[{type:"text", text:<accumulated>}] },
//     assistantMessageEvent: { type:"text_delta", delta:<incremental>, partial:{...} } }
//
// The delta path uses assistantMessageEvent.delta (incremental) and IGNORES
// event.message. So a legit content delta equal to an earlier leading line is
// dropped by the startsWith guard.

function mu(delta: string, accumulated: string) {
  return {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: accumulated }] },
    assistantMessageEvent: {
      type: "text_delta",
      delta,
      contentIndex: 0,
      partial: { role: "assistant", content: [{ type: "text", text: accumulated }] },
    },
  };
}

test("REPLAY TRACE 1: a markdown table whose row repeats a leading line", () => {
  // A 2-table answer. Both tables share the separator "| --- |".
  // The SECOND "| --- |" exactly repeats the FIRST line of the accumulated block.
  const incremental = [
    "| --- |",            // first separator (also the block's leading line)
    "\n| 1 |",
    "\n\n",
    "| --- |",            // second table's separator == leading line -> DROPPED
    "\n| 2 |",
  ];
  let acc = "";
  const events: Record<string, unknown>[] = [
    { type: "message", message: { role: "user", content: "two tables please" } },
  ];
  for (const d of incremental) {
    acc += d;
    events.push(mu(d, acc));
  }
  const { messages } = replaySessionEvents(events);
  const assistant = messages.find((m) => m.role === "assistant");
  const textBlock = (assistant?.blocks ?? []).find((b) => b.kind === "text") as
    | { text: string }
    | undefined;
  const got = textBlock?.text ?? "";
  const expected = incremental.join("");
  console.log("\n=== REPLAY TRACE 1 ===");
  console.log("EXPECTED:", show(expected));
  console.log("GOT     :", show(got));
  console.log("DROPPED?:", got !== expected);
});

test("REPLAY TRACE 2: a delta that is a prefix of the whole accumulated block", () => {
  // First cell value "Total" later recurs as the first token of a new line
  // while it is still a prefix of the entire accumulated block text.
  const incremental = [
    "Total",     // block = "Total"
    " sales\n",  // block = "Total sales\n"
    "Total",     // delta "Total": block.startsWith("Total") -> DROPPED
    " = 9",
  ];
  let acc = "";
  const events: Record<string, unknown>[] = [
    { type: "message", message: { role: "user", content: "summary" } },
  ];
  for (const d of incremental) {
    acc += d;
    events.push(mu(d, acc));
  }
  const { messages } = replaySessionEvents(events);
  const assistant = messages.find((m) => m.role === "assistant");
  const textBlock = (assistant?.blocks ?? []).find((b) => b.kind === "text") as
    | { text: string }
    | undefined;
  const got = textBlock?.text ?? "";
  const expected = incremental.join("");
  console.log("\n=== REPLAY TRACE 2 ===");
  console.log("EXPECTED:", show(expected));
  console.log("GOT     :", show(got));
  console.log("DROPPED?:", got !== expected);
});

test("REPLAY TRACE 3: ordinary table (no repeated leading line) is fine", () => {
  const incremental = [
    "| A | B |", "\n", "| - | - |", "\n", "| 1 | 2 |", "\n", "| 3 | 4 |",
  ];
  let acc = "";
  const events: Record<string, unknown>[] = [
    { type: "message", message: { role: "user", content: "table" } },
  ];
  for (const d of incremental) {
    acc += d;
    events.push(mu(d, acc));
  }
  const { messages } = replaySessionEvents(events);
  const assistant = messages.find((m) => m.role === "assistant");
  const textBlock = (assistant?.blocks ?? []).find((b) => b.kind === "text") as
    | { text: string }
    | undefined;
  const got = textBlock?.text ?? "";
  const expected = incremental.join("");
  console.log("\n=== REPLAY TRACE 3 (control) ===");
  console.log("EXPECTED:", show(expected));
  console.log("GOT     :", show(got));
  console.log("MATCH   :", got === expected);
});
