// Sessions are the flat collection of conversations the workspace orchestrates.
// Identity is `SessionId` — the same string a pane stores as `sessionId`. A
// session lives independently of any pane (panes can hold the same session id
// in different layouts; closing a pane doesn't drop session content).

import type { ChatMessage, QueuedMessage, TokenStats } from "@/features/agent/messages/types";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type { RuntimeContextUsage } from "@/features/agent/runtime/api";
import type { AgentThinkingLevel } from "@/features/agent/contracts";
import type { AgentHarness } from "@shared/agent/harness-id";
import type { AgentSessionKind } from "@shared/agent/execution-contract";

export type { AgentHarness } from "@shared/agent/harness-id";

// The session identity string — the same value a pane stores as `sessionId`.
export type SessionId = string;

export function isMessagingSessionId(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith("message:telegram:") || value?.startsWith("message:discord:"));
}

export type SessionStatus = "idle" | "starting" | "running" | "stopping" | "loading";

export type ExtensionUiRequest = {
  requestId: string;
  method: "select" | "confirm" | "input" | "editor";
  title: string;
  message?: string;
  placeholder?: string;
  prefill?: string;
  options?: string[];
};

/**
 * A `Session` is a conversation record — domain content and runtime status,
 * with no tool-selection state. Per-session skills/templates live in the tools
 * subsystem (`useTools().selectionFor(id)`) keyed by the session id below.
 */
export type Session = {
  // Pane/client identity AND the opaque runtime key sent to the server. One
  // per tab so tabs run independent agent sessions.
  id: SessionId;
  // Pi session UUID (null = unstarted, will be assigned by pi when the first
  // turn runs).
  piSessionId: string | null;
  executionKind?: AgentSessionKind;
  placement?: "local" | "sandbox";
  sandboxAccountId?: string;
  harness?: AgentHarness;
  projectId?: string;
  cwd?: string;
  managedProject?: boolean;
  baseRef?: string;
  branchName?: string;
  detached?: boolean;
  modelId?: string;
  modelRouteId?: string;
  thinkingLevel?: AgentThinkingLevel;
  title: string;
  messages: ChatMessage[];
  status: SessionStatus;
  error: string;
  startedAt?: string;
  input: string;
  tokenStats?: TokenStats;
  /** Lifetime token spend for the whole session, compaction included.
   *  Computed server-side from the rollout; not derived from the visible
   *  transcript, which a tail load truncates. */
  usageTotals?: import("@/features/agent/runtime/api").SessionUsageTotals | null;
  usedSkills?: ComposerSkillRef[];
  contextUsage?: RuntimeContextUsage | null;
  activeAssistantId?: string;
  lastEventSeq?: number;
  // Outgoing pending follow-up messages. Drawn as chips above the input until
  // Pi `queue_update` reconciles the canonical queue. Steering messages are
  // sent as immediate control messages and are not surfaced in this queue UI.
  queue?: QueuedMessage[];
  extensionUiRequest?: ExtensionUiRequest;
  // Byte-offset cursor into the canonical log for paging older history into
  // view ("load earlier"). Set when a tail load left earlier events unread;
  // null/undefined once the whole log is loaded.
  historyCursor?: number | null;
};

export type SessionsMap = ReadonlyMap<SessionId, Session>;

/** Callback used by the runtime engine to commit a patch to a session. */
export type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;
