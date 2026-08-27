import type { AgentSessionEvent, CompactionResult } from "@earendil-works/pi-coding-agent";
import type { UnknownRecord } from "../../../shared/agent/guards";
import type { AgentImageInput } from "../../../shared/agent/agent-image-input";
import type { AgentQueueAction } from "../../../shared/agent/agent-turn";
import type { RuntimeStartOptions } from "./pi-runtime-helpers";

type PiEvent = (UnknownRecord & { type?: string }) | AgentSessionEvent;

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

export type { RuntimeContextUsage as PiContextUsage } from "../../../shared/agent/context-usage";

export type PiAgentStatus = {
  running: boolean;
  active: boolean;
  modelId: string;
  cwd: string;
  piSessionId: string | null;
  agentDir: string;
  eventSeq: number;
  lastError: string | null;
  contextUsage: import("../../../shared/agent/context-usage").RuntimeContextUsage | null;
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
  abort(): Promise<{ steering: string[]; followUp: string[] }>;
  compact(customInstructions?: string): Promise<CompactionResult>;
  stop(): Promise<void>;
  readonly status: PiAgentStatus;
  getEventsAfter(seq: number): LoggedPiEvent[];
  onLoggedEvent(listener: (event: LoggedPiEvent) => void): () => void;
  adoptPiSessionId(piSessionId: string | null | undefined): void;
  respondExtensionUi(
    requestId: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): boolean;
}

export type { RuntimeStartOptions };
