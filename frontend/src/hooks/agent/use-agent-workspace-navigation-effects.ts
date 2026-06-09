import { useCallback, useSyncExternalStore } from "react";
import { consumeAgentSessionNavTitle } from "@/ui/projects-nav-section";
import { makeFreshTab, newPaneId } from "@/lib/agent/session/helpers";
import type { ProjectsContextValue } from "@/lib/agent/projects/context";
import type { WorkspaceDispatch } from "@/lib/agent/workspace/effects";
import { loadPersistedActiveAgentSessions } from "@/lib/agent/workspace/store";

type SearchParamsReader = {
  get: (key: string) => string | null;
};

type WorkspaceNavigationDeps = {
  lastHandledNavKey: string;
  projects: ProjectsContextValue;
  searchParams: SearchParamsReader;
  dispatch: WorkspaceDispatch;
};

type PersistedSession = ReturnType<typeof loadPersistedActiveAgentSessions>[number];

function navigationKey(
  projectId: string | null,
  sessionId: string | null,
  newParam: string | null,
  openParam: string | null,
  splitParam: string | null,
): string {
  if (!(projectId || sessionId || newParam || openParam)) return "";
  return `${projectId ?? ""}|${sessionId ?? ""}|${newParam ?? ""}|${openParam ?? ""}|${splitParam ?? ""}`;
}

function persistedSessionFor(sessionId: string | null): PersistedSession | null {
  if (!sessionId) return null;
  return (
    loadPersistedActiveAgentSessions().find((session) => session.piSessionId === sessionId) ?? null
  );
}

function projectForNavigation(
  projects: ProjectsContextValue,
  projectId: string | null,
  persistedSession: PersistedSession | null,
) {
  if (projectId) return projects.findById(projectId);
  if (persistedSession?.projectId) return projects.findById(persistedSession.projectId);
  return null;
}

function replayTabFor(persistedSession: PersistedSession | null) {
  const tab = makeFreshTab();
  if (!persistedSession) return tab;
  return {
    ...tab,
    id: persistedSession.tabId || tab.id,
    runtimeSessionId: persistedSession.runtimeSessionId || tab.runtimeSessionId,
    piSessionId: persistedSession.piSessionId,
    projectId: persistedSession.projectId,
    cwd: persistedSession.cwd,
    modelId: persistedSession.modelId,
    title: persistedSession.title || tab.title,
    startedAt: persistedSession.startedAt ?? persistedSession.updatedAt,
  };
}

export function requestWorkspaceUrlNavigation({
  lastHandledNavKey,
  projects,
  searchParams,
  dispatch,
}: WorkspaceNavigationDeps): void {
  const projectId = searchParams.get("project");
  const sessionId = searchParams.get("session");
  const newParam = searchParams.get("new");
  const openParam = searchParams.get("open");
  const splitParam = searchParams.get("split");
  const key = navigationKey(projectId, sessionId, newParam, openParam, splitParam);
  if (!key || lastHandledNavKey === key) return;

  const persistedSession = persistedSessionFor(sessionId);
  const project = projectForNavigation(projects, projectId, persistedSession);
  if (projectId && !project) return;

  if (project) projects.selectProject(project);
  const sessionTitle = sessionId ? consumeAgentSessionNavTitle(sessionId) : undefined;

  dispatch({
    type: "urlNavRequested",
    key,
    project,
    sessionId,
    ...(sessionTitle ? { sessionTitle } : {}),
    newSession: newParam !== null,
    split: splitParam === "1",
    paneId: newPaneId(),
    tab: replayTabFor(persistedSession),
  });
}

export function useAgentWorkspaceNavigationEffects({
  lastHandledNavKey,
  projects,
  searchParams,
  dispatch,
}: WorkspaceNavigationDeps): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      requestWorkspaceUrlNavigation({ lastHandledNavKey, projects, searchParams, dispatch });
      return () => {};
    },
    [lastHandledNavKey, projects, searchParams, dispatch],
  );

  useSyncExternalStore(subscribe, getWorkspaceNavigationSnapshot, getWorkspaceNavigationSnapshot);
}

const getWorkspaceNavigationSnapshot = (): number => 0;
