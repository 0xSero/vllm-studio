import type {
  AssistantTranscriptItem,
  SessionSnapshot,
  ToolTranscriptItem,
  TranscriptItem,
  UserTranscriptItem,
} from "@earendil-works/pi-protocol";
import type {
  AssistantBlock,
  ChatMessage,
  ChatMessageAttachment,
  ToolBlock,
} from "@/features/agent/messages/types";
import { visibleUserTextFromPi } from "@/features/agent/messages/helpers";

/**
 * The one bridge from pi's transcript items to the timeline's `ChatMessage`
 * shape. Everything upstream of this file speaks pi's own vocabulary
 * (`SessionSnapshot` / `TranscriptItem` / `TranscriptProgress`); everything
 * downstream keeps rendering the blocks it always rendered. Message and block
 * ids are the deterministic item ids from the runtime projector
 * (`user:<ts>` / `assistant:<ts>` / `tool:<toolCallId>`), so live progress,
 * live snapshots and canonical replays all agree on identity and React never
 * remounts a bubble when the source of a transcript changes.
 */

/** Ids minted by the projector (vs. local optimistic ids from `newId`). */
const PROJECTED_ID = /^(user|assistant|tool|queued):/;

export function isProjectedMessageId(id: string): boolean {
  return PROJECTED_ID.test(id);
}

// One adapted message per transcript group, reused while its inputs are
// identical. The reducer clones only touched items, so ref-equality on the
// group's items is an exact "nothing changed" test — without this cache every
// streamed token would hand React a fresh identity for EVERY bubble.
export type AdapterCache = Map<
  string,
  {
    item: TranscriptItem;
    tools: readonly TranscriptItem[];
    settled: boolean;
    message: ChatMessage;
  }
>;

export type AdaptTranscriptOptions = {
  phase: SessionSnapshot["phase"];
  cache?: AdapterCache;
};

type Group =
  | { kind: "user"; item: UserTranscriptItem }
  | { kind: "assistant"; item: AssistantTranscriptItem; tools: ToolTranscriptItem[] }
  | { kind: "orphan-tool"; item: ToolTranscriptItem };

export function transcriptToMessages(
  items: readonly TranscriptItem[],
  options: AdaptTranscriptOptions,
): ChatMessage[] {
  // A turn that is over cannot execute more tools: settle still-"running" tool
  // badges instead of showing a perpetual spinner for calls that never ran.
  const settled =
    options.phase !== "turn" && options.phase !== "retry" && options.phase !== "compaction";
  const groups: Group[] = [];
  const ownerByToolCall = new Map<string, Extract<Group, { kind: "assistant" }>>();
  for (const item of items) {
    // Queued steer messages already have their own affordance (the queue chips
    // above the composer); rendering them as transcript bubbles too would show
    // every queued message twice.
    if (item.id.startsWith("queued:")) continue;
    if (item.role === "user") {
      groups.push({ kind: "user", item });
      continue;
    }
    if (item.role === "assistant") {
      const group: Extract<Group, { kind: "assistant" }> = { kind: "assistant", item, tools: [] };
      for (const part of item.content) {
        if (part.type === "toolCall") ownerByToolCall.set(part.toolCallId, group);
      }
      groups.push(group);
      continue;
    }
    const owner = ownerByToolCall.get(item.toolCallId);
    if (owner) owner.tools.push(item);
    else groups.push({ kind: "orphan-tool", item });
  }

  const cache = options.cache;
  const seen = new Set<string>();
  const messages: ChatMessage[] = [];
  for (const group of groups) {
    const key = group.item.id;
    const tools = group.kind === "assistant" ? group.tools : [];
    const cached = cache?.get(key);
    if (
      cached &&
      cached.item === group.item &&
      cached.settled === settled &&
      cached.tools.length === tools.length &&
      cached.tools.every((tool, index) => tool === tools[index])
    ) {
      seen.add(key);
      messages.push(cached.message);
      continue;
    }
    const message =
      group.kind === "user"
        ? userMessage(group.item)
        : group.kind === "assistant"
          ? assistantMessage(group.item, group.tools, settled)
          : orphanToolMessage(group.item, settled);
    if (!message) continue;
    seen.add(key);
    messages.push(message);
    cache?.set(key, { item: group.item, tools: [...tools], settled, message });
  }
  if (cache) {
    for (const key of cache.keys()) {
      if (!seen.has(key)) cache.delete(key);
    }
  }
  return messages;
}

/**
 * Fold freshly projected messages into the session's current transcript.
 * Projected messages are authoritative and replace wholesale; local optimistic
 * bubbles (a just-sent prompt or steer, recognizable by their non-projected
 * ids) survive at the tail until the transcript delivers them, at which point
 * the projected bubble absorbs their attachments/skills decoration and the
 * local copy drops.
 */
export function mergeProjectedMessages(
  current: readonly ChatMessage[],
  projected: readonly ChatMessage[],
): ChatMessage[] {
  const locals = current.filter((message) => !isProjectedMessageId(message.id));
  if (locals.length === 0) return [...projected];
  const out = [...projected];
  const consumed = new Set<number>();
  const tail: ChatMessage[] = [];
  for (const local of locals) {
    // Local assistant/system bubbles are transient scaffolding (there is no
    // optimistic assistant content any more) — the projection owns those roles.
    if (local.role !== "user") continue;
    const index = out.findIndex(
      (message, position) =>
        message.role === "user" &&
        !consumed.has(position) &&
        userTextMatches(message.text, local.text),
    );
    if (index >= 0) {
      consumed.add(index);
      const target = out[index];
      out[index] = {
        ...target,
        ...(target.attachments?.length || !local.attachments?.length
          ? {}
          : { attachments: local.attachments }),
        ...(local.skills?.length ? { skills: local.skills } : {}),
      };
    } else {
      tail.push(local);
    }
  }
  return tail.length > 0 ? [...out, ...tail] : out;
}

// A delivered prompt is the optimistic text plus machine context (attachment
// bodies, browser context) that the visible-text strip may not remove
// symmetrically — so "the same message" is containment either way, not
// equality.
function userTextMatches(projectedText: string, localText: string): boolean {
  const projected = projectedText.replace(/\s+/g, " ").trim();
  const local = localText.replace(/\s+/g, " ").trim();
  if (!projected || !local) return projected === local;
  return projected === local || projected.includes(local) || local.includes(projected);
}

/** Settle any still-"running" tool badge (an aborted turn leaves no result to
 *  do it). The projected transcript normally settles these itself; this is the
 *  local fallback used when a turn is torn down without a terminal event. */
export function finalizeRunningToolBlocks(
  blocks: AssistantBlock[],
  status: "done" | "error" = "done",
): AssistantBlock[] {
  if (!blocks.some((block) => block.kind === "tool" && block.status === "running")) return blocks;
  return blocks.map((block) =>
    block.kind === "tool" && block.status === "running" ? { ...block, status } : block,
  );
}

/* ── single-item adapters ─────────────────────────────────────────────────── */

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function timeLabel(timestamp: number): string | undefined {
  return timestamp > 0 ? timeFormatter.format(new Date(timestamp)) : undefined;
}

function userMessage(item: UserTranscriptItem): ChatMessage | null {
  const rawText = item.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
  // Machine steering (goal continuations, browser context) is delivered through
  // the user channel but is not the user's words: no visible text, no bubble.
  const text = visibleUserTextFromPi(rawText);
  const attachments = item.content.flatMap((part, index): ChatMessageAttachment[] =>
    part.type === "image"
      ? [
          {
            id: `${item.id}:image:${index}`,
            name: "image",
            type: part.mimeType,
            size: part.data.length,
            mode: "data-url",
            content: `data:${part.mimeType};base64,${part.data}`,
            previewKind: "image",
            previewUrl: `data:${part.mimeType};base64,${part.data}`,
          },
        ]
      : [],
  );
  if (!text && attachments.length === 0) return null;
  const timestamp = timeLabel(item.timestamp);
  return {
    id: item.id,
    role: "user",
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(timestamp ? { timestamp } : {}),
  };
}

function toolArgs(input: unknown): { argsText?: string; args?: Record<string, unknown> } {
  if (typeof input === "string") {
    return input.trim() ? { argsText: input } : {};
  }
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if (Object.keys(record).length === 0) return {};
    try {
      return { args: record, argsText: JSON.stringify(record, null, 2) };
    } catch {
      return { args: record };
    }
  }
  return {};
}

function toolBlockFromCall(toolCallId: string, toolName: string, input: unknown): ToolBlock {
  const { argsText, args } = toolArgs(input);
  return {
    kind: "tool",
    id: toolCallId,
    name: toolName || "tool",
    status: "running",
    ...(argsText ? { argsText } : {}),
    ...(args ? { args } : {}),
    text: argsText ?? "",
  };
}

function applyToolResult(block: ToolBlock, tool: ToolTranscriptItem): ToolBlock {
  const resultText = tool.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
  const details =
    tool.details && typeof tool.details === "object" && !Array.isArray(tool.details)
      ? (tool.details as Record<string, unknown>)
      : undefined;
  const status: ToolBlock["status"] =
    tool.status === "running" ? "running" : tool.status === "error" ? "error" : "done";
  const { argsText, args } = toolArgs(tool.input);
  return {
    ...block,
    name: tool.toolName || block.name,
    status,
    ...(resultText ? { resultText } : {}),
    ...(details ? { details } : {}),
    ...(argsText && !block.argsText ? { argsText } : {}),
    ...(args && !block.args ? { args } : {}),
    text: block.argsText || argsText || resultText || block.text,
  };
}

function assistantMessage(
  item: AssistantTranscriptItem,
  tools: readonly ToolTranscriptItem[],
  settled: boolean,
): ChatMessage {
  const toolByCall = new Map(tools.map((tool) => [tool.toolCallId, tool]));
  const blocks: AssistantBlock[] = [];
  const texts: string[] = [];
  item.content.forEach((part, index) => {
    if (part.type === "text") {
      if (part.text) texts.push(part.text);
      blocks.push({ kind: "text", id: `${item.id}:${index}`, text: part.text });
      return;
    }
    if (part.type === "thinking") {
      blocks.push({ kind: "thinking", id: `${item.id}:${index}`, text: part.thinking });
      return;
    }
    let block = toolBlockFromCall(part.toolCallId, part.toolName, part.input);
    const result = toolByCall.get(part.toolCallId);
    if (result) block = applyToolResult(block, result);
    blocks.push(block);
  });
  // A call that ended without executing its declared tools (error/abort), or a
  // turn that is over entirely, settles the remaining "running" badges.
  const finalized =
    item.status === "error"
      ? finalizeRunningToolBlocks(blocks, "error")
      : item.status === "aborted" || settled
        ? finalizeRunningToolBlocks(blocks, "done")
        : blocks;
  const withError =
    item.status === "error"
      ? [
          ...finalized,
          {
            kind: "event" as const,
            id: `${item.id}:error`,
            text: item.errorMessage || "Assistant turn failed.",
          },
        ]
      : finalized;
  const timestamp = timeLabel(item.timestamp);
  return {
    id: item.id,
    role: "assistant",
    text: texts.join("\n"),
    blocks: withError,
    ...(timestamp ? { timestamp } : {}),
  };
}

// A tool result whose owning assistant bubble is not in view (e.g. the tail
// slice starts mid-turn): render it as its own assistant segment — the
// timeline's run-merge folds consecutive assistant messages together anyway.
function orphanToolMessage(item: ToolTranscriptItem, settled: boolean): ChatMessage {
  let block = applyToolResult(toolBlockFromCall(item.toolCallId, item.toolName, item.input), item);
  if (settled && block.status === "running") block = { ...block, status: "done" };
  const timestamp = timeLabel(item.timestamp);
  return {
    id: item.id,
    role: "assistant",
    text: "",
    blocks: [block],
    ...(timestamp ? { timestamp } : {}),
  };
}
