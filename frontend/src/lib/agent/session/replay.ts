import {
  applyAssistantPiEventToBlocks,
  assistantPiEventAffectsBlocks,
  upsertTool,
} from "./block-event";
import {
  messageText,
  newId,
  nowLabel,
  sessionTitleFromPrompt,
  visibleUserTextFromPi,
} from "./helpers";
import type { AssistantBlock, ChatMessage, TextBlock } from "./types";

type ReplayPiMessage = {
  role?: string;
  content?: string | Array<Record<string, unknown>>;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

type ReplayState = {
  messages: ChatMessage[];
  pendingAssistantId: string | null;
  title: string | null;
  startedAt: string | null;
  modelId: string | null;
};

const isRecordArray = (value: unknown): value is Array<Record<string, unknown>> =>
  Array.isArray(value);

const toolArgs = (part: Record<string, unknown>): Record<string, unknown> | undefined =>
  part.arguments && typeof part.arguments === "object"
    ? (part.arguments as Record<string, unknown>)
    : undefined;

function blockFromContentPart(part: Record<string, unknown>): AssistantBlock | null {
  if (part.type === "text" && typeof part.text === "string") {
    return { kind: "text", id: newId("text"), text: part.text };
  }
  if (part.type === "thinking" && typeof part.thinking === "string") {
    return { kind: "thinking", id: newId("thinking"), text: part.thinking };
  }
  if (part.type === "reasoning") {
    const text = [part.reasoning, part.thinking, part.text].find(
      (value): value is string => typeof value === "string",
    );
    return text ? { kind: "thinking", id: newId("thinking"), text } : null;
  }
  if (part.type !== "toolCall") return null;

  const args = toolArgs(part);
  const argsText = JSON.stringify(part.arguments ?? {}, null, 2);
  return {
    kind: "tool",
    id: typeof part.id === "string" ? part.id : newId("tool"),
    name: typeof part.name === "string" ? part.name : "tool",
    status: "running",
    argsText,
    args,
    text: argsText,
  };
}

function blocksFromMessageContent(
  content: string | Array<Record<string, unknown>> | undefined,
): AssistantBlock[] {
  if (typeof content === "string") {
    return content ? [{ kind: "text", id: newId("text"), text: content }] : [];
  }
  if (!isRecordArray(content)) return [];
  return content.flatMap((part) => {
    const block = blockFromContentPart(part);
    return block ? [block] : [];
  });
}

const messageTextFromBlocks = (blocks: AssistantBlock[]): string =>
  blocks
    .filter((block): block is TextBlock => block.kind === "text")
    .map((block) => block.text)
    .join("\n");

const replayMessageFromEvent = (event: Record<string, unknown>): ReplayPiMessage | null => {
  if (event.type !== "message" && event.type !== "message_end") return null;
  const message = event.message;
  return message && typeof message === "object" && !Array.isArray(message)
    ? (message as ReplayPiMessage)
    : null;
};

const eventToolCallId = (event: Record<string, unknown>, message: ReplayPiMessage): string =>
  message.toolCallId || String(event.toolCallId || "");

const patchMessage = (
  state: ReplayState,
  messageId: string,
  patch: (message: ChatMessage) => ChatMessage,
): void => {
  const index = state.messages.findIndex((message) => message.id === messageId);
  if (index !== -1) state.messages[index] = patch(state.messages[index]);
};

const ensureAssistantMessage = (state: ReplayState): string => {
  if (state.pendingAssistantId) return state.pendingAssistantId;
  const id = newId("assistant");
  state.messages.push({ id, role: "assistant", text: "", blocks: [], timestamp: nowLabel() });
  state.pendingAssistantId = id;
  return id;
};

const assistantWithTool = (state: ReplayState, toolCallId: string): string | null => {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    const hasTool = (message.blocks ?? []).some(
      (block) => block.kind === "tool" && block.id === toolCallId,
    );
    if (message.role === "assistant" && hasTool) return message.id;
  }
  return null;
};

const pendingAssistantCanReceive = (
  state: ReplayState,
  eventType: unknown,
  incomingBlocks: AssistantBlock[],
): boolean => {
  if (!state.pendingAssistantId) return false;
  const pending = state.messages.find((message) => message.id === state.pendingAssistantId);
  const pendingHasTools = (pending?.blocks ?? []).some((block) => block.kind === "tool");
  const incomingHasTools = incomingBlocks.some((block) => block.kind === "tool");
  return eventType === "message_end" || (!pendingHasTools && !incomingHasTools);
};

const appendUserMessage = (state: ReplayState, message: ReplayPiMessage): boolean => {
  if (message.role !== "user") return false;

  state.pendingAssistantId = null;
  const text = visibleUserTextFromPi(messageText(message.content));
  if (!text) return true;
  state.title ??= sessionTitleFromPrompt(text);
  state.messages.push({ id: newId("user"), role: "user", text, timestamp: nowLabel() });
  return true;
};

const appendAssistantMessage = (
  state: ReplayState,
  eventType: unknown,
  message: ReplayPiMessage,
): boolean => {
  if (message.role !== "assistant") return false;

  const blocks = blocksFromMessageContent(message.content);
  const text = messageTextFromBlocks(blocks);
  if (pendingAssistantCanReceive(state, eventType, blocks) && state.pendingAssistantId) {
    patchMessage(state, state.pendingAssistantId, (current) => ({ ...current, text, blocks }));
    state.pendingAssistantId = null;
    return true;
  }

  state.pendingAssistantId = null;
  state.messages.push({
    id: newId("assistant"),
    role: "assistant",
    text,
    blocks,
    timestamp: nowLabel(),
  });
  return true;
};

const appendToolResult = (
  state: ReplayState,
  event: Record<string, unknown>,
  message: ReplayPiMessage,
): boolean => {
  if (message.role !== "toolResult") return false;

  const id = eventToolCallId(event, message);
  if (!id) return true;
  const resultText = messageText(message.content);
  const assistantId = assistantWithTool(state, id) ?? ensureAssistantMessage(state);
  patchMessage(state, assistantId, (current) => ({
    ...current,
    blocks: upsertTool(
      current.blocks ?? [],
      id,
      (existing) => ({
        ...existing,
        status: message.isError ? "error" : "done",
        text: resultText || existing.text,
      }),
      () => ({
        kind: "tool",
        id,
        name: message.toolName || "tool",
        status: message.isError ? "error" : "done",
        text: resultText,
      }),
    ),
  }));
  return true;
};

const applyReplayMessage = (state: ReplayState, event: Record<string, unknown>): boolean => {
  const message = replayMessageFromEvent(event);
  if (!message) return false;
  return (
    appendUserMessage(state, message) ||
    appendAssistantMessage(state, event.type, message) ||
    appendToolResult(state, event, message)
  );
};

const applyAssistantPiEvent = (state: ReplayState, event: Record<string, unknown>): void => {
  if (!assistantPiEventAffectsBlocks(event)) return;
  const assistantId = ensureAssistantMessage(state);
  patchMessage(state, assistantId, (message) => {
    const blocks = applyAssistantPiEventToBlocks(message.blocks ?? [], event);
    return blocks ? { ...message, blocks } : message;
  });
};

const applySessionStart = (state: ReplayState, event: Record<string, unknown>): void => {
  if (event.type === "session") {
    if (!state.startedAt && typeof event.timestamp === "string") state.startedAt = event.timestamp;
    if (!state.modelId && typeof event.modelId === "string") state.modelId = event.modelId;
    if (!state.modelId && typeof event.model === "string") state.modelId = event.model;
    if (!state.modelId && typeof event.model_id === "string") state.modelId = event.model_id;
    return;
  }

  if (event.type === "model_change") {
    if (typeof event.modelId === "string") state.modelId = event.modelId;
    if (typeof event.model === "string") state.modelId = event.model;
  }
};

// ----- full session replay -----

export function replaySessionEvents(events: Record<string, unknown>[]): {
  messages: ChatMessage[];
  title: string | null;
  startedAt: string | null;
  modelId: string | null;
} {
  const state: ReplayState = {
    messages: [],
    pendingAssistantId: null,
    title: null,
    startedAt: null,
    modelId: null,
  };

  for (const event of events) {
    applySessionStart(state, event);
    if (applyReplayMessage(state, event)) continue;
    applyAssistantPiEvent(state, event);
  }

  return {
    messages: state.messages,
    title: state.title,
    startedAt: state.startedAt,
    modelId: state.modelId,
  };
}
