import { drainQueueAfterAgentEnd } from "@/lib/agent/session";
import type { Session, SessionId } from "./types";

type ReadonlyRef<T> = { readonly current: T };
type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

export type QueuedTurnSubmitArgs = {
  text: string;
  prompt: string;
  displayText: string;
  userText: string;
  targetSessionId: SessionId;
};

export type QueueDrainDeps = {
  schedule?: (callback: () => void) => void;
  submitPromptRef: ReadonlyRef<(args: QueuedTurnSubmitArgs) => Promise<void>>;
  tabsRef: ReadonlyRef<Session[]>;
  updateSession: UpdateSession;
};

export function drainQueuedTurnAfterAgentEnd(deps: QueueDrainDeps, sessionId: SessionId): void {
  const queued = (deps.tabsRef.current.find((tab) => tab.id === sessionId)?.queue ?? []).slice();
  const { next, remaining } = drainQueueAfterAgentEnd(queued);

  if (next) {
    deps.updateSession(sessionId, (session) => ({ ...session, queue: remaining }));
    const schedule = deps.schedule ?? ((callback: () => void) => setTimeout(callback, 0));
    schedule(() => {
      void deps.submitPromptRef.current({
        text: next.text,
        prompt: next.text,
        displayText: next.text,
        userText: next.text,
        targetSessionId: sessionId,
      });
    });
    return;
  }

  if (queued.length > 0) {
    deps.updateSession(sessionId, (session) => ({ ...session, queue: remaining }));
  }
}
