export type {
  AssistantBlock,
  ChatMessage,
  ChatMessageAttachment,
  EventBlock,
  QueuedMessage,
  TextBlock,
  ThinkingBlock,
  TokenStats,
  ToolBlock,
} from "@shared/agent/session-view";

export type ChatPaneHandle = {
  sessionId: string;
  loadAndReplay: (piSessionId: string) => Promise<void>;
  compact: () => Promise<void>;
};

export type SessionTab = import("@/features/agent/runtime/types").Session;
