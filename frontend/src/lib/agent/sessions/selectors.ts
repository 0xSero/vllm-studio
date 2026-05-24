// Read-side helpers for code that needs to peek at sessions through the
// workspace state. The `sessions` map is the source of truth — panes only
// store the visible session id — so all "give me the session of pane X" reads
// go through these.

import type { PaneId, WorkspaceState } from "@/lib/agent/workspace/types";
import type { Session, SessionId } from "./types";

export function paneSessions(state: WorkspaceState, paneId: PaneId): Session[] {
  const session = activeSession(state, paneId);
  return session ? [session] : [];
}

export function activeSession(state: WorkspaceState, paneId: PaneId): Session | null {
  const pane = state.panesById.get(paneId);
  if (!pane) return null;
  return state.sessions.get(pane.sessionId) ?? null;
}

export function focusedSession(state: WorkspaceState): Session | null {
  return activeSession(state, state.focusedPaneId);
}

export function findPaneByPiSessionId(
  state: WorkspaceState,
  piSessionId: string,
): { paneId: PaneId; session: Session } | null {
  for (const [paneId, pane] of state.panesById.entries()) {
    const session = state.sessions.get(pane.sessionId);
    if (session?.piSessionId === piSessionId) return { paneId, session };
  }
  return null;
}

/** All session ids referenced by any pane. Useful for pruning the sessions map. */
export function referencedSessionIds(state: WorkspaceState): Set<SessionId> {
  const ids = new Set<SessionId>();
  for (const pane of state.panesById.values()) {
    ids.add(pane.sessionId);
  }
  return ids;
}
