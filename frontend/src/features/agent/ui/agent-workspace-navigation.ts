import { consumeAgentSessionNavTitle } from "@/features/agent/ui/projects-nav/helpers";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import { newPaneId } from "@/features/agent/messages/helpers";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import {
  loadPersistedActiveAgentSessions,
  persistedActiveSessionFor,
  replayTabForPersisted,
} from "@/features/agent/workspace/store";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type SearchParamsReader = {
  get: (key: string) => string | null;
};

type WorkspaceNavigationDeps = {
  lastHandledNavKey: string;
  projects: ProjectsContextValue;
  searchParams: SearchParamsReader;
  dispatch: WorkspaceDispatch;
};

type PersistedSession = ReturnType<typeof loadPersistedActiveAgentSessions>[number];

type NavigationParams = {
  projectId: string | null;
  sessionId: string | null;
  newParam: string | null;
  openParam: string | null;
  splitParam: string | null;
  replaceParam: string | null;
};

function navigationKey(params: NavigationParams): string {
  const { projectId, sessionId, newParam, openParam, splitParam, replaceParam } = params;
  if (!(projectId || sessionId || newParam || openParam)) return "";
  return `${projectId ?? ""}|${sessionId ?? ""}|${newParam ?? ""}|${openParam ?? ""}|${splitParam ?? ""}|${replaceParam ?? ""}`;
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

function requestWorkspaceUrlNavigation({
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
  const replaceParam = searchParams.get("replace");
  const key = navigationKey({
    projectId,
    sessionId,
    newParam,
    openParam,
    splitParam,
    replaceParam,
  });
  if (!key || lastHandledNavKey === key) return;

  const persistedSession = persistedActiveSessionFor(sessionId);
  const project = projectForNavigation(projects, projectId, persistedSession);
  if (projectId && !project) return;

  if (project) projects.selectProject(project);
  const sessionTitle = sessionId ? consumeAgentSessionNavTitle(sessionId) : undefined;

  const tab = replayTabForPersisted(persistedSession);
  // Legacy upgrade seed: an entry persisted while running under a pre-alias
  // rt-* runtime key must reattach to that key (see active-sessions.ts).
  if (persistedSession?.runtimeSessionId) {
    sessionRuntimeController().seedConnectionKey(tab.id, persistedSession.runtimeSessionId);
  }
  dispatch({
    type: "urlNavRequested",
    key,
    project,
    sessionId,
    ...(sessionTitle ? { sessionTitle } : {}),
    newSession: newParam !== null,
    split: splitParam === "1",
    replaceWorkspace: replaceParam === "1",
    paneId: newPaneId(),
    tab,
  });
  consumeOneShotNavParams();
}

function consumeOneShotNavParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const param of ["new", "terminal", "split", "open", "replace"]) {
    if (!url.searchParams.has(param)) continue;
    url.searchParams.delete(param);
    changed = true;
  }
  if (changed) window.history.replaceState(window.history.state, "", url);
}

export function useAgentWorkspaceNavigationEffects({
  lastHandledNavKey,
  projects,
  searchParams,
  dispatch,
}: WorkspaceNavigationDeps): void {
  useMountSubscription(() => {
    requestWorkspaceUrlNavigation({ lastHandledNavKey, projects, searchParams, dispatch });
  }, [lastHandledNavKey, projects, searchParams, dispatch]);
}
