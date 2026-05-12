// Read-side helpers for code that needs to peek at sessions through the
// workspace state. The `sessions` map is the source of truth — panes only
// store ids — so all "give me the sessions of pane X" reads go through these.

import type { PaneId, PaneState, WorkspaceState } from "@/lib/agent/workspace/types";
import type { Session, SessionId } from "./types";

export function paneSessions(state: WorkspaceState, paneId: PaneId): Session[] {
  const pane = state.panesById.get(paneId);
  if (!pane) return [];
  return materializePaneSessions(state, pane);
}

export function materializePaneSessions(state: WorkspaceState, pane: PaneState): Session[] {
  const out: Session[] = [];
  for (const id of pane.sessionIds) {
    const session = state.sessions.get(id);
    if (session) out.push(session);
  }
  return out;
}

export function activeSession(state: WorkspaceState, paneId: PaneId): Session | null {
  const pane = state.panesById.get(paneId);
  if (!pane) return null;
  return state.sessions.get(pane.activeSessionId) ?? null;
}

export function focusedSession(state: WorkspaceState): Session | null {
  return activeSession(state, state.focusedPaneId);
}

export function findPaneByPiSessionId(
  state: WorkspaceState,
  piSessionId: string,
): { paneId: PaneId; session: Session } | null {
  for (const [paneId, pane] of state.panesById.entries()) {
    for (const id of pane.sessionIds) {
      const session = state.sessions.get(id);
      if (session?.piSessionId === piSessionId) return { paneId, session };
    }
  }
  return null;
}

/** All session ids referenced by any pane. Useful for pruning the sessions map. */
export function referencedSessionIds(state: WorkspaceState): Set<SessionId> {
  const ids = new Set<SessionId>();
  for (const pane of state.panesById.values()) {
    for (const id of pane.sessionIds) ids.add(id);
  }
  return ids;
}
