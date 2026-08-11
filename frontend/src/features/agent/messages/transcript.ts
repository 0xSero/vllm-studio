import {
  blocksFromTurnSnapshots,
  messageTextFromBlocks,
} from "@/features/agent/messages/message-content";
import {
  asRecord,
  messageText,
  numberFromRecord,
  visibleUserTextFromPi,
} from "@/features/agent/messages/helpers";
import type {
  AssistantBlock,
  ChatMessage,
  QueuedMessage,
  TokenStats,
} from "@/features/agent/messages/types";

type TranscriptProjection = { messages: ChatMessage[]; tokenStats?: TokenStats };

const contentRecords = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.flatMap((part) => (asRecord(part) ? [asRecord(part)!] : [])) : [];

const timestamp = (value: unknown): string | undefined => {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
};

const messageId = (role: string, value: unknown, ordinal: number): string =>
  `${role}-${typeof value === "number" || typeof value === "string" ? value : ordinal}-${ordinal}`;

function priorUser(
  current: readonly ChatMessage[],
  used: Set<string>,
  text: string,
): ChatMessage | undefined {
  return current.find(
    (message) => message.role === "user" && message.text === text && !used.has(message.id),
  );
}

function priorAssistant(
  current: readonly ChatMessage[],
  userId: string | undefined,
): ChatMessage | undefined {
  const userIndex = userId ? current.findIndex((message) => message.id === userId) : -1;
  return current.slice(userIndex + 1).find((message) => message.role === "assistant");
}

function tokenStats(message: Record<string, unknown>): TokenStats | undefined {
  const usage = asRecord(message.usage);
  if (!usage) return undefined;
  const read = numberFromRecord(usage, ["input", "prompt_tokens", "input_tokens"]);
  const write = numberFromRecord(usage, ["output", "completion_tokens", "output_tokens"]);
  const current = numberFromRecord(usage, ["totalTokens", "total_tokens", "total"]);
  return read || write || current ? { read, write, current: current || read + write } : undefined;
}

function toolResult(blocks: AssistantBlock[], message: Record<string, unknown>): AssistantBlock[] {
  const id = typeof message.toolCallId === "string" ? message.toolCallId : "";
  if (!id) return blocks;
  const text = messageText(contentRecords(message.content));
  const index = blocks.findIndex((block) => block.kind === "tool" && block.id === id);
  const patch = {
    status: message.isError === true ? ("error" as const) : ("done" as const),
    resultText: text,
    text,
  };
  if (index < 0) {
    return [
      ...blocks,
      {
        kind: "tool",
        id,
        name: typeof message.toolName === "string" ? message.toolName : "tool",
        ...patch,
      },
    ];
  }
  const next = blocks.slice();
  next[index] = { ...next[index], ...patch } as AssistantBlock;
  return next;
}

export function projectTranscript(
  rawMessages: readonly unknown[],
  current: readonly ChatMessage[] = [],
): TranscriptProjection {
  const messages: ChatMessage[] = [];
  const usedUsers = new Set<string>();
  let assistantIndex = -1;
  let assistantCalls: unknown[][] = [];
  let latestUserId: string | undefined;
  let latestStats: TokenStats | undefined;

  for (const [ordinal, value] of rawMessages.entries()) {
    const raw = asRecord(value);
    if (!raw) continue;
    if (raw.role === "user") {
      const text = visibleUserTextFromPi(messageText(raw.content as never));
      if (!text) continue;
      const prior = priorUser(current, usedUsers, text);
      if (prior) usedUsers.add(prior.id);
      const user: ChatMessage = {
        ...(prior ?? {}),
        id: prior?.id ?? messageId("user", raw.timestamp, ordinal),
        role: "user",
        text,
        pending: false,
        awaitingEcho: false,
        timestamp: prior?.timestamp ?? timestamp(raw.timestamp),
      };
      messages.push(user);
      latestUserId = user.id;
      assistantIndex = -1;
      assistantCalls = [];
      continue;
    }
    if (raw.role === "assistant") {
      if (assistantIndex < 0) {
        const prior = priorAssistant(current, latestUserId);
        assistantIndex = messages.length;
        messages.push({
          id: prior?.id ?? messageId("assistant", raw.timestamp, ordinal),
          role: "assistant",
          text: "",
          blocks: [],
          timestamp: prior?.timestamp ?? timestamp(raw.timestamp),
        });
      }
      assistantCalls.push(contentRecords(raw.content));
      let blocks = blocksFromTurnSnapshots(assistantCalls);
      if (raw.stopReason === "error" && typeof raw.errorMessage === "string") {
        blocks = [
          ...blocks,
          { kind: "event", id: `${messages[assistantIndex].id}-error`, text: raw.errorMessage },
        ];
      }
      messages[assistantIndex] = {
        ...messages[assistantIndex],
        blocks,
        text: messageTextFromBlocks(blocks),
      };
      latestStats = tokenStats(raw) ?? latestStats;
      continue;
    }
    if (raw.role === "toolResult" && assistantIndex >= 0) {
      const assistant = messages[assistantIndex];
      const blocks = toolResult(assistant.blocks ?? [], raw);
      messages[assistantIndex] = { ...assistant, blocks, text: messageTextFromBlocks(blocks) };
    }
  }
  return { messages, tokenStats: latestStats };
}

const sameMessage = (left: ChatMessage, right: ChatMessage): boolean =>
  left.role === right.role && left.text.trim() === right.text.trim();

export function mergeLiveTranscript(
  current: readonly ChatMessage[],
  live: readonly ChatMessage[],
): ChatMessage[] {
  if (live.length === 0) return [...current];
  let currentStart = -1;
  let liveStart = -1;
  for (let right = live.length - 1; right >= 0 && currentStart < 0; right -= 1) {
    if (live[right].role !== "user") continue;
    for (let left = current.length - 1; left >= 0; left -= 1) {
      if (sameMessage(current[left], live[right])) {
        currentStart = left;
        liveStart = right;
        break;
      }
    }
  }
  const merged =
    currentStart < 0
      ? [...current, ...live]
      : [...current.slice(0, currentStart), ...live.slice(liveStart)];
  for (const message of current) {
    if (
      message.role === "user" &&
      (message.pending || message.awaitingEcho) &&
      !merged.some((candidate) => sameMessage(candidate, message))
    ) {
      merged.push(message);
    }
  }
  return merged;
}

export function projectQueue(
  followUp: readonly string[],
  current: readonly QueuedMessage[] = [],
): QueuedMessage[] {
  return followUp.map((raw, index) => {
    const text = visibleUserTextFromPi(raw) || raw.trim();
    const prior = current.find((message) => message.mode === "follow_up" && message.text === text);
    return prior ?? { id: `queue-${index}-${text}`, mode: "follow_up", text, sent: true };
  });
}
