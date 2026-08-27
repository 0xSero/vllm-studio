import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { OpenAgentSession } from "@/features/agent/session-index";
import type { RenderedWorkbenchTab } from "@/features/workbench/model";

export type WorkbenchNavigation = {
  focusedSession: OpenAgentSession | null;
  currentProjectId: string | null;
  requestedSessionId: string | null;
  wantsNewTask: boolean;
  navigationKey: string;
};

export type SearchParamsLike = {
  get(name: string): string | null;
};

export function sessionForTab(
  tab: RenderedWorkbenchTab,
  sessions: readonly OpenAgentSession[],
): OpenAgentSession | null {
  return (
    sessions.find(
      (session) =>
        tab.sessionId === session.id ||
        tab.resourceId === session.id ||
        Boolean(session.threadId && tab.threadId === session.threadId),
    ) ?? null
  );
}

export function resolveWorkbenchNavigation(
  searchParams: SearchParamsLike,
  openSessions: readonly OpenAgentSession[],
  selectedProjectId: string | null,
): WorkbenchNavigation {
  const requestedSessionId = searchParams.get("session");
  const requestedSession = requestedSessionId
    ? (openSessions.find(
        (session) => session.threadId === requestedSessionId || session.id === requestedSessionId,
      ) ?? null)
    : null;
  const wantsNewTask = searchParams.get("new") === "1";
  const focusedSession =
    requestedSessionId && !requestedSession
      ? null
      : (requestedSession ??
        openSessions.find((session) => session.focused) ??
        openSessions.at(-1) ??
        null);
  const currentProjectId =
    focusedSession?.projectId ?? searchParams.get("project") ?? selectedProjectId;
  return {
    focusedSession,
    currentProjectId,
    requestedSessionId,
    wantsNewTask,
    navigationKey: [
      searchParams.get("project"),
      searchParams.get("session"),
      searchParams.get("new"),
      searchParams.get("open"),
      wantsNewTask ? "new" : (focusedSession?.id ?? "pending"),
    ].join(":"),
  };
}

export function projectInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "W";
}

export function handleLauncherKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  onDismiss: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
    return;
  }
  if (event.target instanceof HTMLInputElement && event.key !== "ArrowDown") return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  if (items.length === 0) return;
  const currentIndex = items.findIndex((item) => item === document.activeElement);
  let nextIndex: number | null = null;
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1 + items.length) % items.length;
  if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = items.length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  items[nextIndex]?.focus();
}
