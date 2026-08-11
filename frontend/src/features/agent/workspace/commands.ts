import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import { applyUrlNavigation, focusPaneSession, renameTab } from "./pane-controller";
import type { PaneId, SessionId, WorkspaceNavigation } from "@/features/agent/workspace/types";

export type WorkspaceCommands = {
  bind(dispatch: WorkspaceDispatch): void;
  unbind(): void;
  focusSession(
    paneId: PaneId,
    sessionId: SessionId,
    options?: { replaceWorkspace?: boolean },
  ): void;
  renameSession(paneId: PaneId, tabId: SessionId, title: string): void;
  navigate(navigation: WorkspaceNavigation): boolean;
};

function createWorkspaceCommands(): WorkspaceCommands {
  let dispatch: WorkspaceDispatch | null = null;
  return {
    bind: (next) => {
      dispatch = next;
    },
    unbind: () => {
      dispatch = null;
    },
    focusSession: (paneId, sessionId, options) => {
      dispatch?.((state) =>
        focusPaneSession(state, { paneId, sessionId, replaceWorkspace: options?.replaceWorkspace }),
      );
    },
    renameSession: (paneId, tabId, title) => {
      if (!title.trim()) return;
      dispatch?.((state) => renameTab(state, { paneId, tabId, title }));
    },
    navigate: (navigation) => {
      if (!dispatch) return false;
      dispatch((state) => applyUrlNavigation(state, navigation));
      return true;
    },
  };
}

let singleton: WorkspaceCommands | null = null;

export function workspaceCommands(): WorkspaceCommands {
  singleton ??= createWorkspaceCommands();
  return singleton;
}
