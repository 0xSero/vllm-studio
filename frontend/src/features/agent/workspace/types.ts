import type { AgentModel } from "@shared/agent/models";
import type { Project } from "@/features/agent/projects/types";
import type { Session, SessionId, SessionsMap } from "@/features/agent/runtime/types";
import type { Layout, PaneId } from "@/features/agent/workspace/layout";

export type { PaneId } from "@/features/agent/workspace/layout";
export type { SessionId } from "@/features/agent/runtime/types";
export type { AgentModel } from "@shared/agent/models";

export type WorkspaceLayout = Layout;

export type { GitSummary } from "@/features/agent/projects/types";

export type ChatPaneState = {
  kind?: "chat";
  sessionId: SessionId;
};

export type PaneState = ChatPaneState;

export type WorkspaceState = {
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
  lastHandledNavIntent: string;
};

export type WorkspaceSessionPayload = {
  piSessionId?: string | null;
  projectId?: string;
  cwd?: string;
  paneId?: PaneId;
  tabId?: string;
  title?: string;
};

export type WorkspaceNavigation = {
  key: string;
  intent?: string;
  project: Project | null;
  sessionId?: string | null;
  sessionTitle?: string;
  newSession?: boolean;
  split?: boolean;
  paneId: PaneId;
  replaceWorkspace?: boolean;
  tab: Session;
};
