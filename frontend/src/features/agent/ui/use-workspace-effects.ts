import { useCallback, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
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
    .map((session) => `${session.id}:${session.runtimeSessionId}:${session.piSessionId ?? ""}`)
    .join("\n");
}

function runtimeRegistryKey(sessions: Session[]): string {
  return sessions
    .map(
      (session) =>
        `${session.id}:${session.runtimeSessionId}:${session.piSessionId ?? ""}:${session.status}`,
    )
    .join("\n");
}

// The useSyncExternalStore subscriptions below run their side effects purely
// for the mount/cleanup lifecycle (effect hooks are banned in this codebase).
// A constant snapshot guarantees they never trigger a re-render.
const getRuntimeSyncSnapshot = (): number => 0;

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
  const subscribeSessionsRef = useCallback(() => {
    sessionsRef.current = sessions;
    return () => undefined;
  }, [sessions]);
  useSyncExternalStore(subscribeSessionsRef, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  // Bind the controller's commit boundary to the workspace dispatcher.
  const subscribeBinding = useCallback(() => {
    sessionRuntimeController().bind({
      commit: (sessionId: SessionId, patch: (session: Session) => Session) => {
        dispatch({ type: "patchSession", sessionId, patch });
      },
      getSession: (sessionId) => sessionsRef.current.find((session) => session.id === sessionId),
      getSessions: () => sessionsRef.current,
    });
    return () => undefined;
  }, [dispatch]);
  useSyncExternalStore(subscribeBinding, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  const subscriptionKey = useMemo(() => runtimeSubscriptionKey(sessions), [sessions]);

  // Reconcile SSE attachments when the live membership (not content) changes.
  const subscribeResume = useCallback(() => {
    sessionRuntimeController().reconcile(sessionsRef.current);
    return () => undefined;
  }, [subscriptionKey]);
  useSyncExternalStore(subscribeResume, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  const registryKey = useMemo(() => runtimeRegistryKey(sessions), [sessions]);

  // Immediate runtime-list reconcile + steady poll restart whenever session
  // identity (membership / runtime id / pi id / status) changes.
  const subscribePoll = useCallback(() => {
    sessionRuntimeController().pollNow();
    return () => undefined;
  }, [registryKey]);
  useSyncExternalStore(subscribePoll, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  // Unmount cleanup: flush pending deltas, close every SSE attachment, stop
  // the poll, and release the dispatcher binding.
  const subscribeCleanup = useCallback(
    () => () => {
      sessionRuntimeController().closeAll();
      sessionRuntimeController().unbind();
    },
    [],
  );
  useSyncExternalStore(subscribeCleanup, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);
}
