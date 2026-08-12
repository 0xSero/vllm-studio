import { useMemo, useRef, type RefObject } from "react";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import { workspaceCommands } from "@/features/agent/workspace/commands";
import { loadInitialFromStorage } from "@/features/agent/workspace/persistence";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import { patchWorkspaceSession } from "@/features/agent/workspace/pane-controller";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

function currentSearchParams(): URLSearchParams {
  return typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
}

function shouldRestoreWorkspace(params: URLSearchParams): boolean {
  return params.get("restore") !== "0";
}

export function useWorkspaceHydrationEffects({
  dispatch,
  hydrated,
  toolsRef,
  skipRestore = false,
}: {
  dispatch: WorkspaceDispatch;
  hydrated: boolean;
  toolsRef: RefObject<ToolsContextValue>;
  skipRestore?: boolean;
}): void {
  useMountSubscription(() => {
    if (!hydrated) {
      const params = currentSearchParams();
      const restoreWorkspace = !skipRestore && shouldRestoreWorkspace(params);
      const { workspace, selections } = restoreWorkspace
        ? loadInitialFromStorage(window.localStorage)
        : { workspace: {}, selections: new Map() };
      dispatch((state) => ({ ...state, ...workspace, hydrated: true }));
      if (selections.size > 0) toolsRef.current.hydrateSelections(selections);
    }

    workspaceCommands().bind(dispatch);
    return () => {
      workspaceCommands().unbind();
    };
  }, [dispatch, hydrated, toolsRef, skipRestore]);
}

type UseWorkspaceRuntimeSyncDeps = {
  dispatch: WorkspaceDispatch;
  sessions: Session[];
};

function runtimeRegistryKey(sessions: Session[]): string {
  return sessions
    .map((session) => `${session.id}:${session.piSessionId ?? ""}:${session.status}`)
    .join("\n");
}

export function useWorkspaceRuntimeSync({ dispatch, sessions }: UseWorkspaceRuntimeSyncDeps): void {
  const sessionsRef = useRef(sessions);

  useMountSubscription(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useMountSubscription(() => {
    sessionRuntimeController().bind({
      commit: (sessionId: SessionId, patch: (session: Session) => Session) => {
        dispatch((state) => patchWorkspaceSession(state, sessionId, patch));
      },
      getSessions: () => sessionsRef.current,
    });
  }, [dispatch]);

  const registryKey = useMemo(() => runtimeRegistryKey(sessions), [sessions]);

  useMountSubscription(() => {
    sessionRuntimeController().reconcile(sessionsRef.current);
  }, [registryKey]);

  useMountSubscription(
    () => () => {
      sessionRuntimeController().closeAll();
      sessionRuntimeController().unbind();
    },
    [],
  );
}
