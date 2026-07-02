import { useMemo, useRef, type RefObject } from "react";
import {
  subscribeWorkspaceWindowEvents,
  type WorkspaceDispatch,
} from "@/features/agent/workspace/effects";
import { workspaceCommands } from "@/features/agent/workspace/commands";
import { loadInitialFromStorage } from "@/features/agent/workspace/persistence";
import { loadPersistedActiveAgentSessions } from "@/features/agent/workspace/store";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import { shouldSubscribeRuntimeEvents } from "@/features/agent/runtime/runtime-cursor";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

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
  useMountSubscription(() => {
    const params = currentSearchParams();
    const restoreWorkspace = shouldRestoreWorkspace(params);
    const { workspace, selections, legacyRuntimeKeys } = restoreWorkspace
      ? loadInitialFromStorage(window.localStorage)
      : { workspace: {}, selections: new Map(), legacyRuntimeKeys: new Map() };
    // Legacy upgrade seed: a session persisted while RUNNING under a pre-alias
    // rt-* runtime key must reattach to that key, not the session id.
    for (const [sessionId, runtimeKey] of legacyRuntimeKeys) {
      sessionRuntimeController().seedConnectionKey(sessionId, runtimeKey);
    }
    dispatch({ type: "hydrate", state: workspace, hydrated: !restoreWorkspace });
    if (selections.size > 0) toolsRef.current.hydrateSelections(selections);

    if (projectsRef.current.loaded) {
      const snapshots = restoreWorkspace ? loadPersistedActiveAgentSessions() : [];
      for (const snapshot of snapshots) {
        // Same legacy seed for old active-session entries (see above).
        if (snapshot.tabId && snapshot.runtimeSessionId) {
          sessionRuntimeController().seedConnectionKey(snapshot.tabId, snapshot.runtimeSessionId);
        }
      }
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
  }, [dispatch, projectsRef, toolsRef]);
}

type UseWorkspaceRuntimeSyncDeps = {
  dispatch: WorkspaceDispatch;
  sessions: Session[];
};

// Membership key for the resume subscriptions. Deliberately excludes the raw
// status string beyond the live/idle boundary. A prompt's optimistic
// "starting" phase deliberately does not subscribe yet: the runtime can still
// be idle from the previous turn, and subscribing too early can receive a final
// idle status before `/turn` has restarted Pi. Once the command endpoint
// returns, "running" opens the stream and replays any early events from the
// runtime log.
function runtimeSubscriptionKey(sessions: Session[]): string {
  return sessions
    .filter((session) => shouldSubscribeRuntimeEvents(session.status))
    .map((session) => `${session.id}:${session.piSessionId ?? ""}`)
    .join("\n");
}

function runtimeRegistryKey(sessions: Session[]): string {
  return sessions
    .map((session) => `${session.id}:${session.piSessionId ?? ""}:${session.status}`)
    .join("\n");
}

// React adapter for the session runtime controller: binds the workspace
// dispatcher as the controller's commit boundary, reconciles SSE attachments
// against the live session set, and retriggers the controller's status poll
// when session identity changes. All ordering and status-arbitration
// decisions live in the controller, not here.
export function useWorkspaceRuntimeSync({ dispatch, sessions }: UseWorkspaceRuntimeSyncDeps): void {
  const sessionsRef = useRef(sessions);

  // Mirror the latest sessions into a ref in the commit phase (never during
  // render) so the long-lived subscriptions below read the current value
  // without re-subscribing on every content update.
  useMountSubscription(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useMountSubscription(() => {
    sessionRuntimeController().bind({
      commit: (sessionId: SessionId, patch: (session: Session) => Session) => {
        dispatch({ type: "patchSession", sessionId, patch });
      },
      getSession: (sessionId) => sessionsRef.current.find((session) => session.id === sessionId),
      getSessions: () => sessionsRef.current,
    });
  }, [dispatch]);

  const subscriptionKey = useMemo(() => runtimeSubscriptionKey(sessions), [sessions]);

  // Reconcile SSE attachments when the live membership (not content) changes.
  useMountSubscription(() => {
    sessionRuntimeController().reconcile(sessionsRef.current);
  }, [subscriptionKey]);

  const registryKey = useMemo(() => runtimeRegistryKey(sessions), [sessions]);

  // Immediate runtime-list reconcile + steady poll restart whenever session
  // identity (membership / pi id / status) changes.
  useMountSubscription(() => {
    sessionRuntimeController().pollNow();
  }, [registryKey]);

  useMountSubscription(
    () => () => {
      sessionRuntimeController().closeAll();
      sessionRuntimeController().unbind();
    },
    [],
  );
}
