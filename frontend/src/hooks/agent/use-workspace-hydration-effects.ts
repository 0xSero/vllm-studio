import { useCallback, useSyncExternalStore, type RefObject } from "react";

import type { ProjectsContextValue } from "@/lib/agent/projects/context";
import type { ToolsContextValue } from "@/lib/agent/tools/context";
import {
  subscribeWorkspaceWindowEvents,
  type WorkspaceDispatch,
} from "@/lib/agent/workspace/effects";
import { loadInitialFromStorage } from "@/lib/agent/workspace/persistence";
import { loadPersistedActiveAgentSessions } from "@/lib/agent/workspace/store";

function currentSearchParams(): URLSearchParams {
  return typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
}

function shouldRestoreWorkspace(params: URLSearchParams): boolean {
  return params.get("restore") === "1";
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
        });
      }

      return subscribeWorkspaceWindowEvents(window, dispatch, (id) =>
        projectsRef.current.findById(id),
      );
    },
    [dispatch, projectsRef, toolsRef],
  );

  useSyncExternalStore(subscribe, getWorkspaceHydrationSnapshot, getWorkspaceHydrationSnapshot);
}

const getWorkspaceHydrationSnapshot = (): number => 0;
