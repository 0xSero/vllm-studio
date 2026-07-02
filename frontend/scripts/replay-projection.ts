// Shared normalized projection used by the replay/live-fold golden tests.
//
// The one-reducer consolidation (messages/replay.ts folded into
// runtime/pi-event-applier.ts reduceSessionEvent) was verified by running the
// OLD and NEW paths through this SAME projection and comparing outputs — so
// the projection deliberately depends only on OUTPUT SHAPES (roles, texts,
// block kinds/names/statuses), never on generated ids, wall-clock timestamps,
// or internal function identities.
import type { AssistantBlock, ChatMessage } from "../src/features/agent/messages/types";

export type ProjectedBlock = {
  kind: AssistantBlock["kind"];
  text: string;
  // Tool-only fields; omitted (undefined) for text/thinking/event blocks.
  name?: string;
  status?: string;
  argsText?: string;
  args?: Record<string, unknown>;
  resultText?: string;
};

export type ProjectedMessage = {
  role: ChatMessage["role"];
  text: string;
  blocks: ProjectedBlock[];
};

export type ProjectedReplay = {
  messages: ProjectedMessage[];
  title: string | null;
  startedAt: string | null;
  modelId: string | null;
};

export function projectBlock(block: AssistantBlock): ProjectedBlock {
  if (block.kind === "tool") {
    return {
      kind: block.kind,
      text: block.text,
      name: block.name,
      status: block.status,
      ...(block.argsText !== undefined ? { argsText: block.argsText } : {}),
      ...(block.args !== undefined ? { args: block.args } : {}),
      ...(block.resultText !== undefined ? { resultText: block.resultText } : {}),
    };
  }
  return { kind: block.kind, text: block.text };
}

export function projectMessages(messages: ChatMessage[]): ProjectedMessage[] {
  return messages.map((message) => ({
    role: message.role,
    text: message.text,
    blocks: (message.blocks ?? []).map(projectBlock),
  }));
}

export function projectReplayResult(result: {
  messages: ChatMessage[];
  title: string | null;
  startedAt: string | null;
  modelId: string | null;
}): ProjectedReplay {
  return {
    messages: projectMessages(result.messages),
    title: result.title,
    startedAt: result.startedAt,
    modelId: result.modelId,
  };
}
