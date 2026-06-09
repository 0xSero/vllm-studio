import { PiSdkSession } from "./pi-sdk-runtime";
import { findRuntimeSessionForLookup } from "./pi-runtime-lookup";
import type { PiAgentSession } from "./pi-runtime-types";

export { refreshPiModels } from "./pi-runtime-models";

const DEFAULT_SESSION_ID = "default";

class PiRuntimeManager {
  private sessions = new Map<string, PiAgentSession>();

  getSession(sessionId = DEFAULT_SESSION_ID): PiAgentSession {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const created = new PiSdkSession();
    this.sessions.set(sessionId, created);
    return created;
  }

  getSessionForLookup(
    sessionId = DEFAULT_SESSION_ID,
    piSessionId?: string | null,
  ): { sessionId: string; session: PiAgentSession } {
    return (
      this.findSessionForLookup(sessionId, piSessionId) ?? {
        sessionId,
        session: this.getSession(sessionId),
      }
    );
  }

  findSessionForLookup(
    sessionId = DEFAULT_SESSION_ID,
    piSessionId?: string | null,
  ): { sessionId: string; session: PiAgentSession } | null {
    return findRuntimeSessionForLookup(this.listSessions(), sessionId, piSessionId);
  }

  listSessions(): Array<{ sessionId: string; session: PiAgentSession }> {
    return [...this.sessions.entries()].map(([sessionId, session]) => ({ sessionId, session }));
  }
}

const globalForPi = globalThis as typeof globalThis & {
  __vllmStudioPiRuntimeManager?: PiRuntimeManager;
};

export const piRuntimeManager = globalForPi.__vllmStudioPiRuntimeManager ?? new PiRuntimeManager();

globalForPi.__vllmStudioPiRuntimeManager = piRuntimeManager;
