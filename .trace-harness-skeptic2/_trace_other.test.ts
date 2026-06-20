import test from "node:test";
import { reduceSessionEvent } from "@/features/agent/runtime/pi-event-applier";
import { blocksFromTurnSnapshots, messageTextFromBlocks } from "@/features/agent/messages/message-content";
import type { Session, SessionId } from "@/features/agent/runtime/types";

const show = (s: string) => JSON.stringify(s);

function baseSession(): Session {
  return {
    id: "s1" as SessionId,
    messages: [{ id: "a1", role: "assistant", text: "", blocks: [], timestamp: "" }],
  } as unknown as Session;
}
const ctx = () => ({ liveAssistantIds: new Map<SessionId, string>() });
function aText(session: Session): string {
  const a = session.messages.find((m) => m.id === "a1");
  return (a?.blocks ?? [])
    .filter((b) => b.kind === "text")
    .map((b) => (b as { text: string }).text)
    .join("|");
}

// OTHER RISK 1: messageTextFromBlocks joins TEXT blocks with "\n". If a turn
// has two separate text blocks (split by a tool), the joined `text` field gets
// a phantom "\n" that was never in the model output.
test("OTHER 1: messageTextFromBlocks injects \\n between split text blocks", () => {
  const blocks = blocksFromTurnSnapshots([
    [
      { type: "text", text: "Part one." },
      { type: "toolCall", id: "t1", name: "x", arguments: "{}" },
      { type: "text", text: "Part two." },
    ],
  ]);
  console.log("\n=== OTHER 1 ===");
  console.log("blocks:", blocks.map((b) => `${b.kind}:${show((b as { text?: string }).text ?? "")}`).join("  "));
  console.log("messageTextFromBlocks:", show(messageTextFromBlocks(blocks)));
  // The two text blocks are real boundaries (tool between). Joined text gets a \n.
});

// OTHER RISK 2: message_end content shorter than streamed accumulation.
// nextStreamCalls REPLACES the last slot with message_end content. If the
// settled message_end omits content (e.g. only a toolCall, text moved), the
// streamed table could vanish.
test("OTHER 2: message_end with empty content replaces a streamed table", () => {
  let session = baseSession();
  session = reduceSessionEvent(session, ctx(), "a1", { type: "message_start", message: { role: "assistant", content: [] } });
  session = reduceSessionEvent(session, ctx(), "a1", {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "| A |\n| 1 |\n" }] },
    assistantMessageEvent: { type: "text_delta", delta: "x", contentIndex: 0, partial: { role: "assistant", content: [{ type: "text", text: "| A |\n| 1 |\n" }] } },
  });
  console.log("\n=== OTHER 2 ===");
  console.log("after stream:", show(aText(session)));
  // settled message_end with EMPTY content (pathological but possible if server
  // sends a bare stop frame)
  session = reduceSessionEvent(session, ctx(), "a1", {
    type: "message_end",
    message: { role: "assistant", content: [] },
  });
  console.log("after message_end (empty content):", show(aText(session)));
});

// OTHER RISK 3: message_end with the SAME full content (normal case) — no loss.
test("OTHER 3: normal message_end preserves the streamed table", () => {
  let session = baseSession();
  session = reduceSessionEvent(session, ctx(), "a1", { type: "message_start", message: { role: "assistant", content: [] } });
  session = reduceSessionEvent(session, ctx(), "a1", {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "| A |\n| 1 |\n" }] },
    assistantMessageEvent: { type: "text_delta", delta: "x", contentIndex: 0, partial: { role: "assistant", content: [{ type: "text", text: "| A |\n| 1 |\n" }] } },
  });
  session = reduceSessionEvent(session, ctx(), "a1", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "| A |\n| 1 |\n" }] },
  });
  console.log("\n=== OTHER 3 ===");
  console.log("after message_end (full):", show(aText(session)));
});

// OTHER RISK 4: reasoning_content + text in same part -> mergeAdjacentTextLike.
// A "text" part carrying both reasoning_content and text splits into a thinking
// block then a text block. Confirm the visible table text is intact and not
// merged into the thinking block.
test("OTHER 4: reasoning_content on a text part does not swallow the table", () => {
  const blocks = blocksFromTurnSnapshots([
    [{ type: "text", reasoning_content: "Let me build a table.", text: "| A |\n| 1 |\n" }],
  ]);
  console.log("\n=== OTHER 4 ===");
  console.log(blocks.map((b) => `${b.kind}:${show((b as { text?: string }).text ?? "")}`).join("\n"));
});
