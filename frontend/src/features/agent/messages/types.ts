import type { ComposerSkillRef } from "@/features/agent/composer-context";

export type ChatPaneHandle = {
  sessionId: string;
  loadAndReplay: (piSessionId: string) => Promise<void>;
  compact: () => Promise<void>;
};

export type ToolBlock = {
  kind: "tool";
  id: string;
  name: string;
  status: "running" | "done" | "error";
  argsText?: string;
  args?: Record<string, unknown>;
  resultText?: string;
  text: string;
};

export type TextBlock = { kind: "text"; id: string; text: string };
export type ThinkingBlock = { kind: "thinking"; id: string; text: string };
export type EventBlock = { kind: "event"; id: string; text: string };
export type AssistantBlock = TextBlock | ThinkingBlock | ToolBlock | EventBlock;

export type ChatMessageAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path?: string;
  mode: "text" | "data-url" | "metadata";
  content: string;
  previewKind?: "image" | "video" | "audio" | "pdf" | "file";
  previewUrl?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatMessageAttachment[];
  skills?: ComposerSkillRef[];
  blocks?: AssistantBlock[];
  streamCalls?: Array<Array<Record<string, unknown>>>;
  pending?: boolean;
  awaitingEcho?: boolean;
  timestamp?: string;
};

export type TokenStats = {
  read: number;
  write: number;
  current: number;
};

export type QueuedMessage = {
  id: string;
  mode: "steer" | "follow_up";
  text: string;
  sent?: boolean;
};

export type SessionTab = import("@/features/agent/runtime/types").Session;
