// Pure pi-runtime state derivation. This module must stay free of runtime
// imports of @earendil-works/pi-coding-agent (ESM-only) so the node test
// runner can load it; pi-runtime-types only contributes erased type imports.
import type {
  LoggedPiEvent,
  PiAgentStatus,
  PiContextUsage,
} from "./pi-runtime-types";

type RuntimeLookupEntry<TSession> = {
  sessionId: string;
  session: TSession;
};

export function findRuntimeSessionForLookup<
  TSession extends { status: { piSessionId?: string | null } },
>(
  entries: Iterable<RuntimeLookupEntry<TSession>>,
  sessionId: string,
  piSessionId?: string | null,
): RuntimeLookupEntry<TSession> | null {
  const snapshot = [...entries];
  const target = piSessionId?.trim();
  if (target) {
    const piMatch = snapshot.find((entry) => entry.session.status.piSessionId === target);
    if (piMatch) return piMatch;
  }
  return snapshot.find((entry) => entry.sessionId === sessionId) ?? null;
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
  eventLog: LoggedPiEvent[];
  contextUsage?: PiContextUsage | null;
}): PiAgentStatus {
  return {
    running: input.running,
    active: input.activePromptCount > 0 || input.sdkActive === true,
    modelId: input.modelId,
    cwd: input.cwd,
    piSessionId: input.piSessionId,
    agentDir: input.agentDir,
    eventSeq: input.eventSeq,
    lastError: input.lastError,
    contextUsage: input.contextUsage ?? null,
  };
}

// isAgentEndEvent lives in shared/agent/pi-events.ts because the frontend's
// client-side event pipeline needs it too; re-exported here so runtime
// callers keep their import surface.
export { isAgentEndEvent } from "../../../shared/agent/pi-events";
