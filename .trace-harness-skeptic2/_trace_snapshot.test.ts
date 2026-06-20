import test from "node:test";
import { reduceSessionEvent } from "@/features/agent/runtime/pi-event-applier";
import type { Session, SessionId } from "@/features/agent/runtime/types";

function show(s: string): string {
  return JSON.stringify(s);
}

function baseSession(): Session {
  return {
    id: "s1" as SessionId,
    messages: [{ id: "a1", role: "assistant", text: "", blocks: [], timestamp: "" }],
  } as unknown as Session;
}

function ctx() {
  return { liveAssistantIds: new Map<SessionId, string>() };
}

function assistantText(session: Session): string {
  const a = session.messages.find((m) => m.id === "a1");
  return (a?.blocks ?? [])
    .filter((b) => b.kind === "text")
    .map((b) => (b as { text: string }).text)
    .join("|");
}

// Live snapshot path. message_update carries event.message = full accumulated
// AssistantMessage AND assistantMessageEvent.partial. assistantSnapshotContent
// chooses between them. nextStreamCalls accumulates one snapshot per LLM call.

function mu(accumulated: string, partialAccumulated?: string) {
  const ev: Record<string, unknown> = {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: accumulated }] },
    assistantMessageEvent: {
      type: "text_delta",
      delta: "x",
      contentIndex: 0,
      partial: {
        role: "assistant",
        content: [{ type: "text", text: partialAccumulated ?? accumulated }],
      },
    },
  };
  return ev;
}

test("SNAPSHOT TRACE 1: single-call table grows monotonically", () => {
  let session = baseSession();
  const snapshots = [
    "| A | B |\n",
    "| A | B |\n| - | - |\n",
    "| A | B |\n| - | - |\n| 1 | 2 |\n",
  ];
  console.log("\n=== SNAPSHOT TRACE 1 ===");
  session = reduceSessionEvent(session, ctx(), "a1", { type: "message_start", message: { role: "assistant", content: [] } });
  for (const s of snapshots) {
    session = reduceSessionEvent(session, ctx(), "a1", mu(s));
    console.log("acc=", show(assistantText(session)));
  }
  console.log("FINAL:", show(assistantText(session)));
  console.log("EXPECT:", show(snapshots[snapshots.length - 1]));
});

test("SNAPSHOT TRACE 2: message.content vs partial.content disagree (partial shorter)", () => {
  // assistantSnapshotContent: for message_update, if partialContent has no tool
  // and messageContent has no tool, it returns messageContent (the else branch).
  // So message.content wins. Feed a case where partial is STALE/short but
  // message is full — verify no truncation.
  let session = baseSession();
  session = reduceSessionEvent(session, ctx(), "a1", { type: "message_start", message: { role: "assistant", content: [] } });
  console.log("\n=== SNAPSHOT TRACE 2 (message full, partial short) ===");
  // message has full table, partial only has first row.
  session = reduceSessionEvent(
    session,
    ctx(),
    "a1",
    mu("| A | B |\n| 1 | 2 |\n| 3 | 4 |\n", "| A | B |\n"),
  );
  console.log("GOT  :", show(assistantText(session)));
  console.log("EXPECT full message content:", show("| A | B |\n| 1 | 2 |\n| 3 | 4 |\n"));
});

test("SNAPSHOT TRACE 3: second LLM call appends a new snapshot slot", () => {
  // Turn spans two LLM calls. message_start opens slot 1. The table continues.
  let session = baseSession();
  session = reduceSessionEvent(session, ctx(), "a1", { type: "message_start", message: { role: "assistant", content: [] } });
  session = reduceSessionEvent(session, ctx(), "a1", mu("Here is the table:\n\n| A | B |\n| - | - |\n"));
  // message_end settles call 0
  session = reduceSessionEvent(session, ctx(), "a1", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "Here is the table:\n\n| A | B |\n| - | - |\n" }] },
  });
  // call 1 begins
  session = reduceSessionEvent(session, ctx(), "a1", { type: "message_start", message: { role: "assistant", content: [] } });
  session = reduceSessionEvent(session, ctx(), "a1", mu("| 1 | 2 |\n| 3 | 4 |\n"));
  console.log("\n=== SNAPSHOT TRACE 3 (two LLM calls) ===");
  console.log("GOT  :", show(assistantText(session)));
  console.log("Both calls' text should be present and joined.");
});
