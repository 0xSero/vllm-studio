import type { RuntimeExtensionUiRequest } from "../../../shared/agent/runtime-status";
import type { ChatMessage, TokenStats } from "../../../shared/agent/session-view";
import type { SessionUsageTotals } from "../../../shared/agent/session-summary";
import type { PiAgentStatus, PiContextUsage } from "./pi-runtime-types";
import { projectAgentQueue, settleAgentMessages } from "./session-view";

type RuntimeLookupEntry<TSession> = {
  sessionId: string;
  session: TSession;
};

type RuntimeLookupStatus = {
  piSessionId?: string | null;
  active?: boolean;
  running?: boolean;
  eventSeq?: number;
};

type RuntimeLookupSession = { status: RuntimeLookupStatus };

export function findRuntimeSessionForLookup<TSession extends RuntimeLookupSession>(
  entries: Iterable<RuntimeLookupEntry<TSession>>,
  sessionId: string,
  piSessionId?: string | null,
): RuntimeLookupEntry<TSession> | null {
  const snapshot = [...entries];
  const exact = snapshot.find((entry) => entry.sessionId === sessionId);
  const target = piSessionId?.trim();
  if (!target) return exact ?? null;
  const matches = snapshot.filter(
    (entry) =>
      entry.session.status.piSessionId === target ||
      (entry.sessionId === sessionId && !entry.session.status.piSessionId),
  );
  return matches.reduce<RuntimeLookupEntry<TSession> | null>(
    (best, candidate) =>
      !best || runtimeLookupOutranks(candidate, best, sessionId) ? candidate : best,
    null,
  );
}

function runtimeLookupOutranks<TSession extends RuntimeLookupSession>(
  candidate: RuntimeLookupEntry<TSession>,
  current: RuntimeLookupEntry<TSession>,
  requestedSessionId: string,
): boolean {
  const candidateRank = runtimeLookupRank(candidate, requestedSessionId);
  const currentRank = runtimeLookupRank(current, requestedSessionId);
  for (let index = 0; index < candidateRank.length; index += 1) {
    if (candidateRank[index] !== currentRank[index]) {
      return candidateRank[index] > currentRank[index];
    }
  }
  return false;
}

function runtimeLookupRank<TSession extends RuntimeLookupSession>(
  entry: RuntimeLookupEntry<TSession>,
  requestedSessionId: string,
): [number, number, number, number] {
  return [
    entry.session.status.active === true ? 1 : 0,
    entry.session.status.running === true ? 1 : 0,
    entry.sessionId === requestedSessionId ? 1 : 0,
    entry.session.status.eventSeq ?? 0,
  ];
}

export function piStatusFromEvents(input: {
  running: boolean;
  activePromptCount: number;
  sdkActive?: boolean;
  modelId: string;
  cwd: string;
  piSessionId: string | null;
  agentDir: string;
  eventSeq: number;
  lastError: string | null;
  contextUsage?: PiContextUsage | null;
  messages?: ChatMessage[];
  tokenStats?: TokenStats;
  historyCursor?: number | null;
  title?: string | null;
  startedAt?: string | null;
  usageTotals?: SessionUsageTotals | null;
  queue?: { steering: readonly string[]; followUp: readonly string[] };
  extensionUiRequest?: RuntimeExtensionUiRequest | null;
}): PiAgentStatus {
  const active = input.activePromptCount > 0 || input.sdkActive === true;
  return {
    running: input.running,
    active,
    modelId: input.modelId,
    cwd: input.cwd,
    piSessionId: input.piSessionId,
    agentDir: input.agentDir,
    eventSeq: input.eventSeq,
    lastError: input.lastError,
    contextUsage: input.contextUsage ?? null,
    messages: active ? (input.messages ?? []) : settleAgentMessages(input.messages ?? []),
    tokenStats: input.tokenStats,
    historyCursor: input.historyCursor,
    title: input.title ?? null,
    startedAt: input.startedAt ?? null,
    usageTotals: input.usageTotals ?? null,
    error: input.lastError,
    queue: {
      steering: [...(input.queue?.steering ?? [])],
      followUp: projectAgentQueue(input.queue?.followUp ?? []),
    },
    extensionUiRequest: input.extensionUiRequest ?? null,
  };
}

export function lastAssistantResult(messages: readonly ChatMessage[]): {
  text: string;
  error: string | null;
} {
  let text = "";
  let error: string | null = null;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.text.trim()) {
      text = message.text.trim();
      error = null;
    } else {
      const event = message.blocks?.find((block) => block.kind === "event");
      if (event?.text.trim()) error = event.text.trim();
    }
  }
  return { text, error };
}

export { isAgentEndEvent, isAgentSettledEvent } from "../../../shared/agent/pi-events";
