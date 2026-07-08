import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import type { Project } from "@/features/agent/projects/types";
import type { PaneId, SessionId, WorkspaceAction } from "@/features/agent/workspace/types";

export type WorkspaceCommands = {
  bind(dispatch: (action: WorkspaceAction) => void): void;
  unbind(): void;
  isBound(): boolean;
  focusSession(paneId: PaneId, sessionId: SessionId): void;
  renameSession(paneId: PaneId, tabId: SessionId, title: string): void;
  newChat(project?: Project | null): void;
  openTerminal(project?: Project | null): void;
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
    isBound: () => dispatch !== null,
    focusSession: (paneId, sessionId) => {
      dispatch?.({ type: "focusPaneSession", paneId, sessionId });
    },
    renameSession: (paneId, tabId, title) => {
      if (!title.trim()) return;
      dispatch?.({ type: "renameTab", paneId, tabId, title });
    },
    newChat: (project) => {
      if (!dispatch) return;
      dispatch({
        type: "urlNavRequested",
        key: `cmd-new-${Date.now().toString(36)}`,
        project: project ?? null,
        sessionId: null,
        newSession: true,
        split: false,
        paneId: newPaneId(),
        tab: makeFreshTab(),
      });
    },
    openTerminal: (project) => {
      dispatch?.({
        type: "openProjectTerminal",
        cwd: project?.path ?? null,
        newPaneId: newPaneId(),
      });
    },
  };
}

let singleton: WorkspaceCommands | null = null;

export function workspaceCommands(): WorkspaceCommands {
  singleton ??= createWorkspaceCommands();
  return singleton;
}
