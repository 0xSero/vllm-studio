import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentImageInput } from "../../../shared/agent/agent-image-input";
import type { AgentQueueAction } from "../../../shared/agent/agent-turn";
import type { RuntimeStatus } from "../../../shared/agent/runtime-status";
import type { ChatMessage } from "../../../shared/agent/session-view";
import type { RuntimeStartOptions } from "./pi-runtime-helpers";

// Pi event surface seen by the rest of the app. Upstream consumers
// (`sessions/engine.ts`, `pane-controller.ts`, etc.) duck-type on string event
// names, so we keep the loose index signature for back-compat while widening
// the type to include the SDK's typed union so newer call sites get
// autocompletion and discriminated narrowing where they ask for it.
type PiEvent = (Record<string, unknown> & { type?: string }) | AgentSessionEvent;

export type { AgentSessionEvent };

export type LoggedPiEvent = {
  seq: number;
  event: PiEvent;
  timestamp: string;
};

export type PiPromptOptions = {
  streamingBehavior?: "steer" | "followUp";
  images?: AgentImageInput[];
  expandPromptTemplates?: boolean;
  source?: "interactive" | "rpc" | "extension";
  preflightResult?: (success: boolean) => void;
  restartOnContinuationError?: boolean;
};

// Re-exported from the canonical Effect-schema-derived type in runtime-schema.ts
// so all context-usage shapes resolve to one source of truth.
export type { RuntimeContextUsage as PiContextUsage } from "../../../shared/agent/context-usage";

export type PiAgentStatus = Required<
  Omit<
    RuntimeStatus,
    "historyCursor" | "messages" | "modelId" | "startedAt" | "title" | "tokenStats" | "usageTotals"
  >
> & {
  modelId: string;
  cwd: string;
  agentDir: string;
  lastError: string | null;
  messages: ChatMessage[];
  tokenStats?: RuntimeStatus["tokenStats"];
  historyCursor?: number | null;
  startedAt?: string | null;
  title?: string | null;
  usageTotals?: RuntimeStatus["usageTotals"];
};

export interface PiAgentSession {
  ensureStarted(
    modelId: string,
    cwd?: string,
    piSessionId?: string | null,
    options?: RuntimeStartOptions,
  ): Promise<void>;
  prompt(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    options?: PiPromptOptions,
  ): Promise<void>;
  steer(message: string, images?: AgentImageInput[]): Promise<void>;
  mutateQueuedFollowUp(
    message: string,
    action: AgentQueueAction,
    replacement?: string,
    images?: AgentImageInput[],
  ): Promise<void>;
  followUp(message: string, images?: AgentImageInput[]): Promise<void>;
  /** Resolves with the messages that were still queued, so the caller can
   *  restore them rather than losing them to the stop. */
  abort(): Promise<{ steering: string[]; followUp: string[] }>;
  compact(customInstructions?: string): Promise<unknown>;
  stop(): Promise<void>;
  readonly status: PiAgentStatus;
  refreshExternalChanges(): Promise<void>;
  onLoggedEvent(listener: (event: LoggedPiEvent) => void): () => void;
  onStatus(listener: (status: PiAgentStatus) => void): () => void;
  adoptPiSessionId(piSessionId: string | null | undefined): void;
  respondExtensionUi(
    requestId: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): boolean;
}

export type { RuntimeStartOptions };
