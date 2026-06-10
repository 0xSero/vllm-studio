import type { PaneId, SessionId, WorkspaceAction } from "@/features/agent/workspace/types";

// Direct command surface for UI that lives outside the workspace component
// tree (the sidebar renders on every route; the workspace only mounts under
// /agent). The workspace binds its dispatcher on mount; while unbound,
// commands no-op silently — the same semantics the old window-event bus had
// when no listener was attached. Persisted-session opening stays URL
// navigation; these cover only same-page actions on live sessions.
export type WorkspaceCommands = {
  bind(dispatch: (action: WorkspaceAction) => void): void;
  unbind(): void;
  /** Focus an open pane/session (sidebar click on an active local session). */
  focusSession(paneId: PaneId, sessionId: SessionId): void;
  /** Rename an open session inline from the sidebar. */
  renameSession(paneId: PaneId, tabId: SessionId, title: string): void;
};

function createWorkspaceCommands(): WorkspaceCommands {
  let dispatch: ((action: WorkspaceAction) => void) | null = null;
  return {
    bind: (next) => {
      dispatch = next;
    },
    unbind: () => {
      dispatch = null;
    },
    focusSession: (paneId, sessionId) => {
      dispatch?.({ type: "focusPaneSession", paneId, sessionId });
    },
    renameSession: (paneId, tabId, title) => {
      if (!title.trim()) return;
      dispatch?.({ type: "renameTab", paneId, tabId, title });
    },
  };
}

let singleton: WorkspaceCommands | null = null;

export function workspaceCommands(): WorkspaceCommands {
  singleton ??= createWorkspaceCommands();
  return singleton;
}
