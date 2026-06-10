import type { PaneId, WorkspaceState } from "@/features/agent/workspace/types";
import type { Session, SessionId } from "@/features/agent/runtime/types";

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

export function referencedSessionIds(state: WorkspaceState): Set<SessionId> {
  const ids = new Set<SessionId>();
  for (const pane of state.panesById.values()) {
    ids.add(pane.sessionId);
  }
  return ids;
}

export type SessionSubmitGuard = Set<SessionId>;

export function beginSessionSubmit(
  guard: SessionSubmitGuard,
  sessionId: SessionId | null | undefined,
): boolean {
  if (!sessionId || guard.has(sessionId)) return false;
  guard.add(sessionId);
  return true;
}

export function endSessionSubmit(
  guard: SessionSubmitGuard,
  sessionId: SessionId | null | undefined,
): void {
  if (!sessionId) return;
  guard.delete(sessionId);
}

export function controlTargetHasActiveTurn(
  status: { active?: boolean; running?: boolean } | null | undefined,
): boolean {
  return status?.active === true;
}
