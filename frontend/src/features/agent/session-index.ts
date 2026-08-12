"use client";

import { useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { isWorkingStatus } from "@/features/agent/runtime/session-status";
import type { SessionId } from "@/features/agent/runtime/types";
import { paneSessionId } from "@/features/agent/runtime/selectors";
import {
  sessionRuntimeController,
  type RuntimeSessionActivitySnapshot,
} from "@/features/agent/runtime/session-runtime-controller";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { workspaceStore } from "@/features/agent/workspace/store";
import type { WorkspaceState } from "@/features/agent/workspace/types";
import type { SessionSummary } from "@shared/agent/session-summary";

export type OpenAgentSession = {
  id: string;
  threadId: string | null;
  projectId: string;
  cwd: string;
  paneId: string;
  modelId?: string;
  title: string;
  status: string;
  focused: boolean;
  startedAt?: string;
  updatedAt: string;
};

export type SessionIndexRow =
  | {
      kind: "open";
      key: string;
      threadId: string | null;
      sortAt: number;
      session: OpenAgentSession;
      activity: SessionActivity;
    }
  | {
      kind: "history";
      key: string;
      threadId: string;
      sortAt: number;
      session: SessionSummary;
      activity: SessionActivity;
    };

export type SessionActivity = "idle" | "running" | "unseen" | "finished";

export type SessionActivitySnapshot = RuntimeSessionActivitySnapshot;

const EMPTY_ACTIVITY: SessionActivitySnapshot = new Map();

function timestamp(value?: string | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasActivity(
  snapshot: SessionActivitySnapshot,
  identity: readonly (string | null)[],
  activity: Exclude<SessionActivity, "idle">,
): boolean {
  return identity.some((id) => Boolean(id && snapshot.get(id) === activity));
}

export function sessionActivity(
  identity: readonly (string | null)[],
  snapshot: SessionActivitySnapshot,
  optimisticStatus = "idle",
  focused = false,
): SessionActivity {
  if (isWorkingStatus(optimisticStatus) || hasActivity(snapshot, identity, "running"))
    return "running";
  if (!focused && hasActivity(snapshot, identity, "finished")) return "finished";
  if (!focused && hasActivity(snapshot, identity, "unseen")) return "unseen";
  return "idle";
}

export function uniqueOpenSessions(sessions: readonly OpenAgentSession[]): OpenAgentSession[] {
  const byKey = new Map<string, OpenAgentSession>();
  for (const session of sessions) {
    const key = session.threadId ?? session.id;
    const previous = byKey.get(key);
    if (
      !previous ||
      session.focused ||
      (!previous.focused && timestamp(session.updatedAt) > timestamp(previous.updatedAt))
    ) {
      byKey.set(key, session);
    }
  }
  return [...byKey.values()];
}

export function sessionRows(
  openSessions: readonly OpenAgentSession[],
  historySessions: readonly SessionSummary[],
  activity: SessionActivitySnapshot = EMPTY_ACTIVITY,
): SessionIndexRow[] {
  const historyById = new Map(historySessions.map((session) => [session.id, session]));
  const openThreadIds = new Set<string>();
  const rows: SessionIndexRow[] = [];
  for (const session of uniqueOpenSessions(openSessions)) {
    const history = session.threadId ? historyById.get(session.threadId) : undefined;
    if (session.threadId) openThreadIds.add(session.threadId);
    rows.push({
      kind: "open",
      key: session.threadId ?? session.id,
      threadId: session.threadId,
      sortAt: timestamp(history?.startedAt ?? session.startedAt ?? session.updatedAt),
      session,
      activity: sessionActivity(
        [session.id, session.threadId],
        activity,
        session.status,
        session.focused,
      ),
    });
  }
  for (const session of historySessions) {
    if (openThreadIds.has(session.id)) continue;
    rows.push({
      kind: "history",
      key: session.id,
      threadId: session.id,
      sortAt: timestamp(session.startedAt),
      session,
      activity: sessionActivity([session.id], activity),
    });
  }
  return rows.sort((left, right) => right.sortAt - left.sortAt);
}

function openSession(
  state: WorkspaceState,
  sessionId: SessionId,
  paneId: string,
  focused: boolean,
): OpenAgentSession | null {
  const session = state.sessions.get(sessionId);
  if (!session) return null;
  return {
    id: session.id,
    threadId: session.piSessionId,
    projectId: session.projectId ?? "",
    cwd: session.cwd ?? "",
    paneId,
    modelId: session.modelId ?? state.selectedModel,
    title: cleanSessionTitle(session.title) || (paneId ? "Current session" : "Background session"),
    status: session.status,
    focused,
    startedAt: session.startedAt,
    updatedAt: session.startedAt ?? "",
  };
}

function openSessions(state: WorkspaceState): OpenAgentSession[] {
  if (!state.hydrated) return [];
  const sessions: OpenAgentSession[] = [];
  const inPane = new Set<SessionId>();
  for (const [paneId, pane] of state.panesById) {
    const sessionId = paneSessionId(pane);
    const session = sessionId ? state.sessions.get(sessionId) : undefined;
    if (!session) continue;
    inPane.add(session.id);
    if (!(session.piSessionId || session.messages.length > 0) || session.status === "loading")
      continue;
    const projected = openSession(state, session.id, paneId, paneId === state.focusedPaneId);
    if (projected) sessions.push(projected);
  }
  for (const session of state.sessions.values()) {
    if (inPane.has(session.id) || !(session.piSessionId || session.messages.length > 0)) continue;
    const projected = openSession(state, session.id, "", false);
    if (projected) sessions.push(projected);
  }
  return sessions;
}

export const useOpenSessions = () => openSessions(useStore(workspaceStore));
export const useSessionActivity = () => {
  const controller = sessionRuntimeController();
  return useSyncExternalStore(
    controller.subscribeActivity,
    controller.activitySnapshot,
    controller.activitySnapshot,
  );
};

export function markSessionActivitySeen(...ids: readonly (string | null | undefined)[]): void {
  sessionRuntimeController().markActivitySeen(ids);
}
