import type {
  AssistantBlock,
  ChatMessage,
  QueuedMessage,
  TextBlock,
  TokenStats,
} from "../../../shared/agent/session-view";
import type { SessionEvent } from "./sessions-store";

export type TranscriptProjection = { messages: ChatMessage[]; tokenStats?: TokenStats };
type PiContentPart = Record<string, unknown> & { type?: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function contentRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((part) => (record(part) ? [record(part)!] : [])) : [];
}

function messageText(content: unknown, separator = "\n"): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const value = record(part);
      return value?.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join(separator);
}

function visibleUserText(text: string): string {
  const marker = "\n\nUser prompt:\n";
  const markerIndex = text.lastIndexOf(marker);
  const body = markerIndex === -1 ? text : text.slice(markerIndex + marker.length);
  const withoutBrowser = body.replace(/^\s*<browser_context>[\s\S]*?<\/browser_context>\s*/i, "");
  const attachmentStart = withoutBrowser.search(/(?:^|\n\n)Attachment \d+:/);
  return (
    attachmentStart === -1 ? withoutBrowser : withoutBrowser.slice(0, attachmentStart)
  ).trim();
}

function positiveNumber(message: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = message[key];
    const parsed =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function tokenStats(message: Record<string, unknown>): TokenStats | undefined {
  const usage = record(message.usage);
  if (!usage) return undefined;
  const read = positiveNumber(usage, ["input", "prompt_tokens", "input_tokens"]);
  const write = positiveNumber(usage, ["output", "completion_tokens", "output_tokens"]);
  const current = positiveNumber(usage, ["totalTokens", "total_tokens", "total"]);
  return read || write || current ? { read, write, current: current || read + write } : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function blockText(blocks: AssistantBlock[]): string {
  return blocks
    .filter((block): block is TextBlock => block.kind === "text")
    .map((block) => block.text)
    .join("\n");
}

function toolArgs(part: PiContentPart): Record<string, unknown> | undefined {
  if (part.arguments && typeof part.arguments === "object" && !Array.isArray(part.arguments)) {
    return part.arguments as Record<string, unknown>;
  }
  if (typeof part.arguments !== "string" || !part.arguments.trim()) return undefined;
  try {
    const parsed = JSON.parse(part.arguments) as unknown;
    return record(parsed) ?? undefined;
  } catch {
    return undefined;
  }
}

function partBlocks(part: PiContentPart, call: number, index: number): AssistantBlock[] {
  const id = `${call}:${index}`;
  if (part.type === "toolCall") {
    const args = toolArgs(part);
    const argsText = args
      ? JSON.stringify(args, null, 2)
      : typeof part.arguments === "string" && part.arguments.trim()
        ? part.arguments
        : "{}";
    return [
      {
        kind: "tool",
        id: typeof part.id === "string" && part.id ? part.id : `${id}:tool`,
        name: typeof part.name === "string" && part.name ? part.name : "tool",
        status: "running",
        argsText,
        args,
        text: argsText,
      },
    ];
  }
  if (part.type === "thinking" || part.type === "reasoning") {
    const text = [part.thinking, part.reasoning, part.text].find(
      (value): value is string => typeof value === "string" && Boolean(value),
    );
    return text ? [{ kind: "thinking", id: `${id}:thinking`, text }] : [];
  }
  if (part.type !== "text") return [];
  const blocks: AssistantBlock[] = [];
  if (typeof part.reasoning_content === "string" && part.reasoning_content) {
    blocks.push({ kind: "thinking", id: `${id}:rthinking`, text: part.reasoning_content });
  }
  if (typeof part.text === "string" && part.text) {
    blocks.push({ kind: "text", id: `${id}:text`, text: part.text });
  }
  return blocks;
}

function mergeAdjacentBlocks(blocks: AssistantBlock[]): AssistantBlock[] {
  const merged: AssistantBlock[] = [];
  for (const block of blocks) {
    const previous = merged.at(-1);
    if (
      previous &&
      (previous.kind === "text" || previous.kind === "thinking") &&
      previous.kind === block.kind &&
      (block.kind === "text" || block.kind === "thinking")
    ) {
      merged[merged.length - 1] = { ...previous, text: previous.text + block.text };
    } else {
      merged.push(block);
    }
  }
  return merged;
}

function blocksFromCalls(calls: unknown[][]): AssistantBlock[] {
  return mergeAdjacentBlocks(
    calls.flatMap((content, call) =>
      Array.isArray(content)
        ? content.flatMap((part, index) => {
            const value = record(part);
            return value ? partBlocks(value, call, index) : [];
          })
        : [],
    ),
  );
}

function applyToolResult(
  blocks: AssistantBlock[],
  message: Record<string, unknown>,
): AssistantBlock[] {
  const id = typeof message.toolCallId === "string" ? message.toolCallId : "";
  if (!id) return blocks;
  const text = messageText(message.content);
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

export function projectAgentTranscript(rawMessages: readonly unknown[]): TranscriptProjection {
  const messages: ChatMessage[] = [];
  let assistantIndex = -1;
  let assistantCalls: unknown[][] = [];
  let latestStats: TokenStats | undefined;
  for (const [ordinal, value] of rawMessages.entries()) {
    const raw = record(value);
    if (!raw) continue;
    if (raw.role === "user") {
      const text = visibleUserText(messageText(raw.content));
      if (!text) continue;
      messages.push({
        id: `user-${String(raw.timestamp ?? ordinal)}-${ordinal}`,
        role: "user",
        text,
        timestamp: timestamp(raw.timestamp),
      });
      assistantIndex = -1;
      assistantCalls = [];
      continue;
    }
    if (raw.role === "assistant") {
      if (assistantIndex < 0) {
        assistantIndex = messages.length;
        messages.push({
          id: `assistant-${String(raw.timestamp ?? ordinal)}-${ordinal}`,
          role: "assistant",
          text: "",
          blocks: [],
          timestamp: timestamp(raw.timestamp),
        });
      }
      assistantCalls.push(contentRecords(raw.content));
      let blocks = blocksFromCalls(assistantCalls);
      if (raw.stopReason === "error" && typeof raw.errorMessage === "string") {
        blocks = [
          ...blocks,
          {
            kind: "event",
            id: `${messages[assistantIndex].id}-error`,
            text: raw.errorMessage,
          },
        ];
      }
      messages[assistantIndex] = {
        ...messages[assistantIndex],
        blocks,
        text: blockText(blocks),
      };
      latestStats = tokenStats(raw) ?? latestStats;
      continue;
    }
    if (raw.role === "toolResult" && assistantIndex >= 0) {
      const assistant = messages[assistantIndex];
      const blocks = applyToolResult(assistant.blocks ?? [], raw);
      messages[assistantIndex] = { ...assistant, blocks, text: blockText(blocks) };
    }
  }
  return { messages, tokenStats: latestStats };
}

export function projectAgentSessionEvents(events: readonly SessionEvent[]): TranscriptProjection {
  return projectAgentTranscript(
    events.flatMap((event) =>
      (event.type === "message" || event.type === "message_end") &&
      event.message &&
      typeof event.message === "object"
        ? [event.message]
        : [],
    ),
  );
}

export function mergeAgentTranscript(
  current: TranscriptProjection,
  live: TranscriptProjection,
): TranscriptProjection {
  return {
    messages: mergeTranscriptMessages(current.messages, live.messages),
    tokenStats: live.tokenStats ?? current.tokenStats,
  };
}

export function settleAgentMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((message) =>
    message.role === "assistant" &&
    message.blocks?.some((block) => block.kind === "tool" && block.status === "running")
      ? {
          ...message,
          blocks: message.blocks.map((block) =>
            block.kind === "tool" && block.status === "running"
              ? { ...block, status: "done" as const }
              : block,
          ),
        }
      : message,
  );
}

function mergeTranscriptMessages(
  current: readonly ChatMessage[],
  live: readonly ChatMessage[],
): ChatMessage[] {
  if (live.length === 0) return [...current];
  let currentStart = -1;
  let liveStart = -1;
  for (let right = live.length - 1; right >= 0 && currentStart < 0; right -= 1) {
    if (live[right].role !== "user") continue;
    currentStart = current.findLastIndex(
      (message) =>
        message.role === live[right].role && message.text.trim() === live[right].text.trim(),
    );
    if (currentStart >= 0) liveStart = right;
  }
  return currentStart < 0
    ? [...current, ...live]
    : [...current.slice(0, currentStart), ...live.slice(liveStart)];
}

export function projectAgentQueue(followUp: readonly string[]): QueuedMessage[] {
  return followUp.flatMap((raw, index) => {
    const text = visibleUserText(raw) || raw.trim();
    return text ? [{ id: `queue-${index}-${text}`, mode: "follow_up", text, sent: true }] : [];
  });
}
