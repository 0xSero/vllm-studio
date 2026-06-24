import {
  applyAssistantPiEventToBlocks,
  assistantPiEventAffectsBlocks,
  asRecord,
  blocksFromMessageContent,
  blocksFromTurnSnapshots,
  finalizeRunningToolBlocks,
  mergeExistingToolState,
  messageTextFromBlocks,
  toolCallSnapshotFromUpdate,
  usefulToolArgsText,
  type AssistantBlock,
  type ChatMessage,
  messageText,
  newId,
  nowLabel,
  reconcileQueueWithPiEvent,
  removeDeliveredQueuedMessage,
  usageFromEvent,
  visibleUserTextFromPi,
} from "@/features/agent/messages";
import { isAgentEndEvent } from "@/features/agent/pi-runtime-state";
import { piEventIsSuccessfulCompaction } from "@/features/agent/pi-runtime-compaction";
import { traceAgentReasoning } from "@/features/agent/trace-reasoning";
import type { Session, SessionId } from "@/features/agent/runtime/types";

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
  // transient per-call snapshots. Also un-dim any steer bubble still marked
  // pending — once the turn is over there is no further echo coming, so a
  // delivered-or-not steer must read as normal rather than stuck dimmed.
  if (isAgentEndEvent(event)) {
    const settled = patchAssistantMessage(next, targetId, (msg) => ({
      ...msg,
      blocks: finalizeRunningToolBlocks(msg.blocks ?? []),
      streamCalls: undefined,
    }));
    return clearPendingUserMessages(settled);
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
  const content = assistantSnapshotContent(event, message);

  const stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
  // An aborted turn is a deliberate stop (user pressed Stop, navigated away) —
  // NOT an error. It must settle cleanly: keep whatever streamed, settle tool
  // badges, and never surface an error block or session error. Only a genuine
  // "error" stopReason is a failure.
  const callErrored = type === "message_end" && stopReason === "error";
  const callAborted = type === "message_end" && stopReason === "aborted";
  const failureText = callErrored ? assistantFailureText(message, stopReason) : "";

  let next = patchAssistantMessage(session, targetId, (current) => {
    const streamCalls = nextStreamCalls(current.streamCalls, type, content);
    const existingBlocks = current.blocks ?? [];
    let blocks = mergeExistingToolState(existingBlocks, blocksFromTurnSnapshots(streamCalls));
    blocks = applyLegacyToolCallDeltaIfSnapshotMissedIt(blocks, existingBlocks, event, content);
    // Carry over any tool block created from tool_execution_*/toolcall_* events
    // that the latest content snapshot doesn't list — for EVERY update, not just
    // toolcall_* ones. Without this, the model's closing text-only summary after
    // a tool-heavy turn rebuilds blocks from a tool-free snapshot and
    // mergeExistingToolState silently drops the completed tools (they vanish from
    // the bubble). Mirrors the replay path, which preserves them unconditionally.
    blocks = preserveMissingToolBlocks(blocks, existingBlocks);
    // A call that ended (errored or aborted) won't execute its declared tools —
    // settle them so they don't show a perpetual "running" badge. An error marks
    // them errored; an abort just settles them done.
    if (callErrored) blocks = finalizeRunningToolBlocks(blocks, "error");
    else if (callAborted) blocks = finalizeRunningToolBlocks(blocks, "done");
    if (failureText) blocks = appendFailureBlock(blocks, failureText);
    return { ...current, streamCalls, blocks, text: messageTextFromBlocks(blocks) };
  });
  if (failureText) next = { ...next, error: failureText };
  return next;
}

function assistantSnapshotContent(
  event: Record<string, unknown>,
  message: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const messageContent = recordArray(message.content);
  if (event.type !== "message_update") return messageContent;

  const partial = asRecord(asRecord(event.assistantMessageEvent)?.partial);
  const partialContent = partial?.role === "assistant" ? recordArray(partial.content) : [];
  if (partialContent.length === 0) return messageContent;

  const messageHasTool = hasToolCallPart(messageContent);
  const partialHasTool = hasToolCallPart(partialContent);
  if (messageContent.length === 0) return partialContent;
  if (partialHasTool && !messageHasTool) return partialContent;
  if (
    partialHasTool &&
    messageHasTool &&
    partialContent.length >= messageContent.length &&
    contentPayloadLength(partialContent) > contentPayloadLength(messageContent)
  ) {
    return partialContent;
  }
  return messageContent;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((part): Array<Record<string, unknown>> => {
    const record = asRecord(part);
    return record ? [record] : [];
  });
}

function hasToolCallPart(content: Array<Record<string, unknown>>): boolean {
  return content.some((part) => part.type === "toolCall");
}

function contentPayloadLength(content: Array<Record<string, unknown>>): number {
  try {
    return JSON.stringify(content).length;
  } catch {
    return content.length;
  }
}

function snapshotToolArgsText(
  content: Array<Record<string, unknown>>,
  toolCallId: string,
): string | null {
  for (const part of content) {
    if (part.type !== "toolCall" || part.id !== toolCallId) continue;
    const args = part.arguments;
    if (typeof args === "string") {
      const text = usefulToolArgsText(args);
      if (text) return text;
      continue;
    }
    if (args && typeof args === "object" && Object.keys(args).length > 0) {
      try {
        return JSON.stringify(args, null, 2);
      } catch {
        return String(args);
      }
    }
  }
  return null;
}

function applyLegacyToolCallDeltaIfSnapshotMissedIt(
  blocks: AssistantBlock[],
  existingBlocks: AssistantBlock[],
  event: Record<string, unknown>,
  content: Array<Record<string, unknown>>,
): AssistantBlock[] {
  if (event.type !== "message_update") return blocks;
  const assistantMessageEvent = asRecord(event.assistantMessageEvent);
  const eventType = assistantMessageEvent?.type;
  if (
    eventType !== "toolcall_start" &&
    eventType !== "toolcall_delta" &&
    eventType !== "toolcall_end"
  ) {
    return blocks;
  }
  const snapshot = toolCallSnapshotFromUpdate(assistantMessageEvent ?? undefined, event.message);
  if (snapshot?.id) {
    const snapshotArgsText = snapshotToolArgsText(content, snapshot.id);
    const existingTool = existingBlocks.find(
      (block): block is Extract<AssistantBlock, { kind: "tool" }> =>
        block.kind === "tool" && block.id === snapshot.id,
    );
    const existingArgsText = usefulToolArgsText(existingTool?.argsText);
    if (snapshotArgsText && snapshotArgsText.length > existingArgsText.length) return blocks;
  }
  const blocksWithPreviousTools = preserveMissingToolBlocks(blocks, existingBlocks);
  return applyAssistantPiEventToBlocks(blocksWithPreviousTools, event) ?? blocksWithPreviousTools;
}

function preserveMissingToolBlocks(
  blocks: AssistantBlock[],
  existingBlocks: AssistantBlock[],
): AssistantBlock[] {
  const ids = new Set(blocks.filter((block) => block.kind === "tool").map((block) => block.id));
  const missingTools = existingBlocks.filter(
    (block) => block.kind === "tool" && !ids.has(block.id),
  );
  return missingTools.length ? [...blocks, ...missingTools] : blocks;
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
    return calls;
  }
  if (type === "message_update") {
    // Monotonic slot: a message_update may carry a snapshot that momentarily LAGS
    // the previous frame (assistantSnapshotContent flips between message.content
    // and assistantMessageEvent.partial.content, which don't advance in lockstep).
    // Overwriting the current call with a shorter snapshot shrinks the rendered
    // bubble for one frame — a visible flicker — before the next update re-grows
    // it. Keep whichever snapshot has the larger payload so the slot never regresses.
    const existing = calls[calls.length - 1];
    calls[calls.length - 1] =
      contentPayloadLength(content) >= contentPayloadLength(existing) ? content : existing;
    return calls;
  }
  // message_end carries the call's settled, authoritative content.
  calls[calls.length - 1] = content;
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

  // This echo is Pi showing a steer message to the model. If the UI already
  // dropped it into the transcript optimistically (dimmed), clear `pending` so
  // it brightens to normal, and open the assistant bubble for the steered reply
  // — same as a freshly echoed mid-stream message, just without duplicating it.
  const pending = findPendingUserMessage(session.messages, text);
  if (pending) {
    const nextAssistantId = newId("assistant");
    ctx.liveAssistantIds.set(session.id, nextAssistantId);
    return {
      ...session,
      queue,
      activeAssistantId: nextAssistantId,
      messages: [
        ...session.messages.map((message) =>
          message.id === pending.id ? { ...message, pending: false } : message,
        ),
        { id: nextAssistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
      ],
    };
  }

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

// The optimistic steer bubble awaiting its runtime echo: a still-pending user
// message whose text matches what Pi just delivered to the model.
function findPendingUserMessage(messages: ChatMessage[], text: string): ChatMessage | undefined {
  const target = text.trim();
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "user" && message.pending === true && message.text.trim() === target,
    );
}

function clearPendingUserMessages(session: Session): Session {
  if (!session.messages.some((message) => message.pending)) return session;
  return {
    ...session,
    messages: session.messages.map((message) =>
      message.pending ? { ...message, pending: false } : message,
    ),
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
  // Only a genuine error is a failure. "aborted" (Stop pressed / navigated away)
  // is a clean stop and must produce no error text.
  if (stopReason !== "error") return "";
  const raw = [message.errorMessage, message.error]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim();
  if (!raw) return "Assistant turn failed.";
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
  if (finalMessageCoversExistingBlocks(existingBlocks, incomingBlocks)) {
    return { ...current, text, blocks: mergeExistingToolState(existingBlocks, incomingBlocks) };
  }
  // A tool-free settled message that does NOT "cover" the bubble is the model's
  // closing summary arriving as its own LLM call after a tool-heavy turn (some
  // backends emit it as a bare `message`, not a streamed snapshot). Replacing
  // the bubble would drop the accumulated tool blocks; rejecting it — as this
  // used to — drops the summary, so the turn renders a trailing tool call and
  // no final words. Append the unseen text/thinking instead, tools untouched.
  if (incomingBlocks.some((block) => block.kind === "tool")) return current;
  const appended = appendUnseenTextBlocks(existingBlocks, incomingBlocks);
  return appended === existingBlocks
    ? current
    : { ...current, blocks: appended, text: messageTextFromBlocks(appended) };
}

function appendUnseenTextBlocks(
  existingBlocks: AssistantBlock[],
  incomingBlocks: AssistantBlock[],
): AssistantBlock[] {
  const shown = existingBlocks
    .filter((block) => block.kind === "text" || block.kind === "thinking")
    .map((block) => block.text.trim())
    .filter(Boolean);
  const alreadyShown = (value: string) =>
    shown.some((existing) => existing === value || existing.includes(value));
  const additions = incomingBlocks.filter(
    (block) =>
      (block.kind === "text" || block.kind === "thinking") &&
      isMeaningfulAssistantText(block.text) &&
      !alreadyShown(block.text.trim()),
  );
  return additions.length ? [...existingBlocks, ...additions] : existingBlocks;
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
