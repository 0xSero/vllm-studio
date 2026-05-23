import { PiSdkSession } from "./pi-sdk-runtime";
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
}

const globalForPi = globalThis as typeof globalThis & {
  __vllmStudioPiRuntimeManager?: PiRuntimeManager;
};

export const piRuntimeManager = globalForPi.__vllmStudioPiRuntimeManager ?? new PiRuntimeManager();

globalForPi.__vllmStudioPiRuntimeManager = piRuntimeManager;
