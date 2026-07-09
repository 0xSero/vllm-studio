import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import type { Project } from "@/features/agent/projects/types";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import { persistedActiveSessionFor, replayTabForPersisted } from "@/features/agent/workspace/store";
import type { PaneId, SessionId, WorkspaceAction } from "@/features/agent/workspace/types";

export type WorkspaceCommands = {
  bind(dispatch: (action: WorkspaceAction) => void): void;
  unbind(): void;
  isBound(): boolean;
  focusSession(paneId: PaneId, sessionId: SessionId): void;
  renameSession(paneId: PaneId, tabId: SessionId, title: string): void;
  newChat(project?: Project | null): void;
  openTerminal(project?: Project | null): void;
  /** Focus the pane holding this terminal, or recreate it (PTY reattach). */
  focusTerminal(terminal: {
    mountKey: string;
    cwd?: string | null;
    title?: string;
    projectId?: string | null;
  }): void;
  openSession(project: Project | null, piSessionId: string, sessionTitle?: string): void;
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
        projectId: project?.id ?? null,
      });
    },
    focusTerminal: (terminal) => {
      dispatch?.({
        type: "focusTerminalPane",
        mountKey: terminal.mountKey,
        cwd: terminal.cwd ?? null,
        title: terminal.title,
        projectId: terminal.projectId ?? null,
        newPaneId: newPaneId(),
      });
    },
    openSession: (project, piSessionId, sessionTitle) => {
      if (!dispatch) return;
      const persisted = persistedActiveSessionFor(piSessionId);
      const tab = persisted
        ? replayTabForPersisted(persisted)
        : {
            ...makeFreshTab(),
            piSessionId,
            projectId: project?.id,
            cwd: project?.path,
            ...(sessionTitle ? { title: sessionTitle } : {}),
          };
      if (persisted?.runtimeSessionId) {
        sessionRuntimeController().seedConnectionKey(tab.id, persisted.runtimeSessionId);
      }
      dispatch({
        type: "urlNavRequested",
        key: `cmd-session-${piSessionId}-${Date.now().toString(36)}`,
        project: project ?? null,
        sessionId: piSessionId,
        ...(sessionTitle ? { sessionTitle } : {}),
        newSession: false,
        split: false,
        replaceWorkspace: true,
        paneId: newPaneId(),
        tab,
      });
    },
  };
}

let singleton: WorkspaceCommands | null = null;

export function workspaceCommands(): WorkspaceCommands {
  singleton ??= createWorkspaceCommands();
  return singleton;
}
