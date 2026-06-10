import { useCallback, useSyncExternalStore, type RefObject } from "react";

import type { ProjectsContextValue } from "@/features/agent/projects/context";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import { workspaceCommands } from "@/features/agent/workspace/commands";
import {
  subscribeWorkspaceWindowEvents,
  type WorkspaceDispatch,
} from "@/features/agent/workspace/effects";
import { loadInitialFromStorage } from "@/features/agent/workspace/persistence";
import { loadPersistedActiveAgentSessions } from "@/features/agent/workspace/store";

function currentSearchParams(): URLSearchParams {
  return typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
}

function shouldRestoreWorkspace(params: URLSearchParams): boolean {
  return params.get("restore") !== "0";
}

export function hasExplicitSessionNavigation(params: URLSearchParams): boolean {
  return Boolean(params.get("session") || params.get("new"));
}

export function useWorkspaceHydrationEffects({
  dispatch,
  projectsRef,
  toolsRef,
}: {
  dispatch: WorkspaceDispatch;
  projectsRef: RefObject<ProjectsContextValue>;
  toolsRef: RefObject<ToolsContextValue>;
}): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      const params = currentSearchParams();
      const restoreWorkspace = shouldRestoreWorkspace(params);
      const { workspace, selections } = restoreWorkspace
        ? loadInitialFromStorage(window.localStorage)
        : { workspace: {}, selections: new Map() };
      dispatch({ type: "hydrate", state: workspace, hydrated: !restoreWorkspace });
      if (selections.size > 0) toolsRef.current.hydrateSelections(selections);

      if (projectsRef.current.loaded) {
        const snapshots = restoreWorkspace ? loadPersistedActiveAgentSessions() : [];
        dispatch({
          type: "hydrateActiveSessions",
          snapshots,
          projects: projectsRef.current.projects,
          hasExplicitSessionNav: !restoreWorkspace || hasExplicitSessionNavigation(params),
        });
      }

      workspaceCommands().bind(dispatch);
      const unsubscribe = subscribeWorkspaceWindowEvents(window, dispatch);
      return () => {
        workspaceCommands().unbind();
        unsubscribe();
      };
    },
    [dispatch, projectsRef, toolsRef],
  );

  useSyncExternalStore(subscribe, getWorkspaceHydrationSnapshot, getWorkspaceHydrationSnapshot);
}

const getWorkspaceHydrationSnapshot = (): number => 0;
