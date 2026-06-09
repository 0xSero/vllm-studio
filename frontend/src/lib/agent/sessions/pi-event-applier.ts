import {
  applyAssistantPiEventToBlocks,
  assistantPiEventAffectsBlocks,
  asRecord,
  blocksFromMessageContent,
  blocksFromTurnSnapshots,
  finalizeRunningToolBlocks,
  messageTextFromBlocks,
  type AssistantBlock,
  type ChatMessage,
  messageText,
  newId,
  nowLabel,
  reconcileQueueWithPiEvent,
  removeDeliveredQueuedMessage,
  usageFromEvent,
  visibleUserTextFromPi,
} from "@/lib/agent/session";
import { isAgentEndEvent } from "@/lib/agent/pi-events";
import { piEventIsSuccessfulCompaction } from "@/lib/agent/pi-runtime-compaction";
import { traceAgentReasoning } from "@/lib/agent/trace-reasoning";
import type { Session, SessionId } from "./types";

export type SessionStreamContext = {
  // Sync channel for the live assistant id. React state commits lag the event
  // stream within a tick, so when a mid-stream user message opens the next
  // assistant bubble, later events in the same tick must find that id here
  // rather than on the (possibly stale) session snapshot.
  liveAssistantIds: Map<SessionId, string>;
};

/**
 * Pure live-event reducer: fold one runtime pi event into a session. The only
 * side channel is `ctx.liveAssistantIds` (see above). Callers dispatch the
 * returned session in a single state commit.
 */
export function reduceSessionEvent(
  session: Session,
  ctx: SessionStreamContext,
  assistantId: string,
  event: Record<string, unknown>,
): Session {
  if (event.type === "queue_update") {
    return { ...session, queue: reconcileQueueWithPiEvent(session.queue ?? [], event) };
  }

  const afterUserMessage = reduceUserMessageEvent(session, ctx, event);
  if (afterUserMessage) return afterUserMessage;

  let next = session;
  if (piEventIsSuccessfulCompaction(event)) {
    next = { ...next, contextUsage: null, tokenStats: undefined };
  }

  const usage = usageFromEvent(event);
  if (usage) next = { ...next, tokenStats: usage };

  const targetId = ctx.liveAssistantIds.get(session.id) ?? assistantId;

  // Assistant message lifecycle -> rebuild blocks from accumulated per-call
  // snapshots (NOT from token deltas). This owns message_start/update/end.
  const afterSnapshot = reduceAssistantSnapshotEvent(next, targetId, event);
  if (afterSnapshot) return afterSnapshot;

  // Turn finished: settle any still-"running" tool badges and drop the
  // transient per-call snapshots.
  if (isAgentEndEvent(event)) {
    return patchAssistantMessage(next, targetId, (msg) => ({
      ...msg,
      blocks: finalizeRunningToolBlocks(msg.blocks ?? []),
      streamCalls: undefined,
    }));
  }

  const afterFinalMessage = reduceFinalAssistantMessageEvent(next, targetId, event);
  if (afterFinalMessage) return afterFinalMessage;

  if (!assistantPiEventAffectsBlocks(event)) return next;
  traceAgentReasoning("pi-event-applier.before", { sessionId: session.id, assistantId, event });
  return patchAssistantMessage(next, targetId, (msg) => {
    const blocks = applyAssistantPiEventToBlocks(msg.blocks ?? [], event);
    traceAgentReasoning("pi-event-applier.after", {
      sessionId: session.id,
      assistantId,
      event,
      beforeBlocks: msg.blocks ?? [],
      afterBlocks: blocks,
    });
    return blocks ? { ...msg, blocks } : msg;
  });
}

function patchAssistantMessage(
  session: Session,
  assistantId: string,
  patch: (msg: ChatMessage) => ChatMessage,
): Session {
  let changed = false;
  const messages = session.messages.map((message) => {
    if (message.id !== assistantId) return message;
    const next = patch(message);
    if (next !== message) changed = true;
    return next;
  });
  return changed ? { ...session, messages } : session;
}

// Accumulate one content snapshot per LLM call and rebuild the bubble's blocks
// from all of them. `message_start` opens a new call slot; `message_update` /
// `message_end` replace the current slot with the call's full accumulated
// content. Tool results (from tool_execution_* events) are preserved across
// rebuilds via mergeExistingToolState.
function reduceAssistantSnapshotEvent(
  session: Session,
  targetId: string,
  event: Record<string, unknown>,
): Session | null {
  const type = event.type;
  if (type !== "message_start" && type !== "message_update" && type !== "message_end") return null;
  const message = asRecord(event.message);
  if (message?.role !== "assistant") return null;
  const content = Array.isArray(message.content)
    ? (message.content as Array<Record<string, unknown>>)
    : [];

  const stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
  const callFailed = type === "message_end" && (stopReason === "error" || stopReason === "aborted");
  const failureText = callFailed ? assistantFailureText(message, stopReason) : "";

  let next = patchAssistantMessage(session, targetId, (current) => {
    const streamCalls = nextStreamCalls(current.streamCalls, type, content);
    let blocks = mergeExistingToolState(current.blocks ?? [], blocksFromTurnSnapshots(streamCalls));
    // An LLM call that errored/aborted will never execute the tools it declared
    // — settle them now instead of leaving a perpetual "running" badge.
    if (callFailed) blocks = finalizeRunningToolBlocks(blocks, "error");
    if (failureText) blocks = appendFailureBlock(blocks, failureText);
    return { ...current, streamCalls, blocks, text: messageTextFromBlocks(blocks) };
  });
  if (failureText) next = { ...next, error: failureText };
  return next;
}

function nextStreamCalls(
  prev: Array<Array<Record<string, unknown>>> | undefined,
  type: string,
  content: Array<Record<string, unknown>>,
): Array<Array<Record<string, unknown>>> {
  const calls = prev ? prev.slice() : [];
  if (type === "message_start") {
    calls.push(content);
    return calls;
  }
  if (calls.length === 0) {
    calls.push(content);
  } else {
    calls[calls.length - 1] = content;
  }
  return calls;
}

function reduceUserMessageEvent(
  session: Session,
  ctx: SessionStreamContext,
  event: Record<string, unknown>,
): Session | null {
  if (event.type !== "message_start" && event.type !== "message_end") return null;
  const msg = event.message as { role?: string; content?: string | Record<string, unknown>[] };
  if (msg?.role !== "user") return null;
  const text = visibleUserTextFromPi(messageText(msg.content));
  if (!text) return session;
  const queue = removeDeliveredQueuedMessage(session.queue ?? [], text);
  if (hasMatchingLastUserMessage(session.messages, text)) {
    return { ...session, queue };
  }
  // A mid-stream user message (steer/follow-up) opens the next assistant
  // bubble; later events in this turn target it via ctx.liveAssistantIds.
  const nextAssistantId = newId("assistant");
  ctx.liveAssistantIds.set(session.id, nextAssistantId);
  return {
    ...session,
    queue,
    activeAssistantId: nextAssistantId,
    messages: [
      ...session.messages,
      { id: newId("user"), role: "user", text, timestamp: nowLabel() },
      { id: nextAssistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
    ],
  };
}

function reduceFinalAssistantMessageEvent(
  session: Session,
  targetId: string,
  event: Record<string, unknown>,
): Session | null {
  // `message_end` is owned by the snapshot path; this only handles the canonical
  // `message` event shape (replayed/settled messages).
  if (event.type !== "message") return null;
  const msg = asRecord(event.message);
  if (msg?.role !== "assistant") return null;
  const content = finalMessageContent(msg.content);
  const stopReason = typeof msg.stopReason === "string" ? msg.stopReason : undefined;
  const errorMessage = assistantFailureText(msg, stopReason);
  const blocks = blocksFromMessageContent(content, { stopReason, errorMessage });
  const text = messageTextFromBlocks(blocks);
  let next = patchAssistantMessage(session, targetId, (current) =>
    reconcileFinalAssistantMessage(current, text, blocks),
  );
  if (errorMessage) next = { ...next, error: errorMessage };
  return next;
}

function assistantFailureText(
  message: Record<string, unknown>,
  stopReason: string | undefined,
): string {
  if (stopReason !== "error" && stopReason !== "aborted") return "";
  const raw = [message.errorMessage, message.error, message.stopReason]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();
  if (!raw) return stopReason === "aborted" ? "Assistant turn aborted." : "Assistant turn failed.";
  return raw;
}

function appendFailureBlock(blocks: AssistantBlock[], text: string): AssistantBlock[] {
  if (blocks.some((block) => block.kind === "event" && block.text === text)) return blocks;
  return [...blocks, { kind: "event", id: newId("error"), text }];
}

function finalMessageContent(value: unknown): string | Array<Record<string, unknown>> | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((part) => {
    const record = asRecord(part);
    return record ? [record] : [];
  });
}

function assistantHasGeneratedBlocks(blocks: AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === "event") return false;
    if (block.kind === "tool") {
      return Boolean(block.text || block.argsText || block.resultText || block.name);
    }
    return isMeaningfulAssistantText(block.text);
  });
}

function reconcileFinalAssistantMessage(
  current: ChatMessage,
  text: string,
  incomingBlocks: AssistantBlock[],
): ChatMessage {
  const existingBlocks = current.blocks ?? [];
  if (!assistantHasGeneratedBlocks(existingBlocks)) {
    return { ...current, text, blocks: incomingBlocks };
  }
  if (!finalMessageCoversExistingBlocks(existingBlocks, incomingBlocks)) return current;
  return { ...current, text, blocks: mergeExistingToolState(existingBlocks, incomingBlocks) };
}

function finalMessageCoversExistingBlocks(
  existingBlocks: AssistantBlock[],
  incomingBlocks: AssistantBlock[],
): boolean {
  if (incomingBlocks.length === 0) return false;
  const existingHasTool = existingBlocks.some((block) => block.kind === "tool");
  const incomingHasTool = incomingBlocks.some((block) => block.kind === "tool");
  if (existingHasTool && !incomingHasTool) return false;

  return (
    blockTextCoversExisting(existingBlocks, incomingBlocks, "text") ||
    blockTextCoversExisting(existingBlocks, incomingBlocks, "thinking")
  );
}

function blockTextCoversExisting(
  existingBlocks: AssistantBlock[],
  incomingBlocks: AssistantBlock[],
  kind: "text" | "thinking",
): boolean {
  const existing = joinedBlockText(existingBlocks, kind);
  const incoming = joinedBlockText(incomingBlocks, kind);
  return Boolean(existing && incoming && (incoming === existing || incoming.startsWith(existing)));
}

function joinedBlockText(blocks: AssistantBlock[], kind: "text" | "thinking"): string {
  return blocks
    .filter((block) => block.kind === kind)
    .map((block) => block.text)
    .filter(isMeaningfulAssistantText)
    .join("");
}

function isMeaningfulAssistantText(text: string): boolean {
  const trimmed = text.trim();
  return Boolean(trimmed && !/^(?:\.{3}|…)+$/.test(trimmed));
}

function mergeExistingToolState(
  existingBlocks: AssistantBlock[],
  incomingBlocks: AssistantBlock[],
): AssistantBlock[] {
  const existingTools = new Map(
    existingBlocks
      .filter((block) => block.kind === "tool")
      .map((block) => [block.id, block] as const),
  );
  return incomingBlocks.map((block) => {
    if (block.kind !== "tool") return block;
    const existing = existingTools.get(block.id);
    if (!existing) return block;
    return {
      ...block,
      args: block.args ?? existing.args,
      argsText: block.argsText ?? existing.argsText,
      resultText: existing.resultText ?? block.resultText,
      status: existing.status,
      text: block.text || existing.text,
    };
  });
}

function hasMatchingLastUserMessage(messages: ChatMessage[], text: string): boolean {
  const lastUser = [...messages].reverse().find((entry) => entry.role === "user");
  return Boolean(
    lastUser &&
    (lastUser.text === text ||
      text.includes(lastUser.text) ||
      Boolean(text && lastUser.text.includes(text)) ||
      Boolean(!text && lastUser.attachments?.length)),
  );
}
