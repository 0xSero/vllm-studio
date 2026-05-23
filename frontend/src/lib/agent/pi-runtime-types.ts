import type { AgentImageInput } from "@/lib/agent/contracts/turn";
import type { RuntimeStartOptions } from "./pi-runtime-helpers";

type PiEvent = Record<string, unknown> & { type?: string };

export type LoggedPiEvent = {
  seq: number;
  event: PiEvent;
  timestamp: string;
};

export type PiAgentStatus = {
  running: boolean;
  active: boolean;
  modelId: string;
  cwd: string;
  piSessionId: string | null;
  agentDir: string;
  eventSeq: number;
  lastError: string | null;
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
    options?: { streamingBehavior?: "steer" | "followUp"; images?: AgentImageInput[] },
  ): Promise<void>;
  steer(message: string, images?: AgentImageInput[]): Promise<void>;
  followUp(message: string, images?: AgentImageInput[]): Promise<void>;
  abort(): Promise<void>;
  compact(customInstructions?: string): Promise<unknown>;
  stop(): Promise<void>;
  readonly status: PiAgentStatus;
  getEventsAfter(seq: number): LoggedPiEvent[];
  onLoggedEvent(listener: (event: LoggedPiEvent) => void): () => void;
  adoptPiSessionId(piSessionId: string | null | undefined): void;
}

export type { RuntimeStartOptions };
