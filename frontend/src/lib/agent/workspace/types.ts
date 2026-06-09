import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import type { AgentModel } from "@/lib/agent/models";
import type { Project } from "@/lib/agent/projects/types";
import type { Session, SessionId, SessionsMap } from "@/lib/agent/sessions/types";
import type { Layout, PaneId } from "@/lib/agent/workspace/layout";

export type { PaneId } from "@/lib/agent/workspace/layout";
export type { SessionId } from "@/lib/agent/sessions/types";
export type { AgentModel } from "@/lib/agent/models";

export type WorkspaceLayout = Layout;

export type { GitSummary } from "@/lib/agent/projects/types";

/**
 * A pane is a layout slot pointing at one visible session — it carries no
 * session content. Runtime identity (`runtimeSessionId`) lives on the Session
 * only.
 */
export type PaneState = {
  sessionId: SessionId;
};

export type WorkspaceState = {
  /** Flat collection of all sessions referenced by any pane. */
  sessions: SessionsMap;
  models: AgentModel[];
  selectedModel: string;
  modelsLoading: boolean;
  layout: WorkspaceLayout;
  panesById: ReadonlyMap<PaneId, PaneState>;
  focusedPaneId: PaneId;
  setupWarning: string;
  error: string;
  hydrated: boolean;
  lastHandledNavKey: string;
};

export type WorkspaceSessionPayload = {
  piSessionId?: string | null;
  projectId?: string;
  cwd?: string;
  paneId?: PaneId;
  tabId?: string;
  title?: string;
};

export type WorkspaceHydration = Partial<WorkspaceState>;

export type WorkspaceAction =
  | { type: "hydrate"; state: WorkspaceHydration; hydrated?: boolean }
  | { type: "workspaceUnmounted" }
  | { type: "setModelsLoading"; loading: boolean }
  | { type: "setModels"; models: AgentModel[]; preferredModelId?: string }
  | { type: "setSelectedModel"; modelId: string }
  | { type: "setSetupWarning"; warning: string }
  | { type: "setError"; error: string }
  | { type: "setSplitRatio"; path: number[]; ratio: number }
  | {
      type: "openSessionPayloadInPane";
      paneId: PaneId;
      payload: WorkspaceSessionPayload;
      tab: Session;
    }
  | {
      type: "splitPaneWithPayload";
      paneId: PaneId;
      direction: "vertical" | "horizontal";
      side: "a" | "b";
      payload: WorkspaceSessionPayload;
      newPaneId: PaneId;
      tab: Session;
    }
  | { type: "focusPane"; paneId: PaneId }
  | { type: "focusPaneSession"; paneId: PaneId; sessionId: SessionId }
  | { type: "renameTab"; paneId: PaneId; tabId: SessionId; title: string }
  | {
      type: "splitTab";
      sourcePaneId: PaneId;
      sourceTabId: SessionId;
      newPaneId: PaneId;
      tab: Session;
    }
  | { type: "closePane"; paneId: PaneId }
  /**
   * Replace the visible session of a pane and write it into the flat sessions map.
   */
  | { type: "setPaneSession"; paneId: PaneId; session: Session }
  | {
      type: "patchSession";
      sessionId: SessionId;
      patch: Partial<Session> | ((session: Session) => Session);
    }
  | { type: "patchActiveTab"; paneId: PaneId; patch: Partial<Session> }
  | { type: "notifySessionsChanged" }
  | {
      type: "urlNavRequested";
      key: string;
      project: Project | null;
      sessionId?: string | null;
      sessionTitle?: string;
      newSession?: boolean;
      split?: boolean;
      paneId: PaneId;
      tab: Session;
    }
  | {
      type: "hydrateActiveSessions";
      snapshots: ActiveAgentSessionSnapshot[];
      projects: Project[];
      hasExplicitSessionNav?: boolean;
    };
