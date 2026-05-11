import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import type { SessionTab } from "@/app/agent/_components/chat-pane";
import type { Layout, PaneId } from "@/app/agent/_components/pane-layout";

export type { PaneId } from "@/app/agent/_components/pane-layout";

export type WorkspaceLayout = Layout;

export type AgentModel = {
  id: string;
  name: string;
  provider: "vllm-studio";
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  active: boolean;
};

export type ProjectEntry = {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
};

export type GitSummary = {
  isRepo: boolean;
  branch: string | null;
  additions: number;
  deletions: number;
  statusCount: number;
};

export type PaneState = {
  tabs: SessionTab[];
  activeTabId: string;
  runtimeSessionId: string;
};

export type ComputerTab = "browser" | "files" | "diff";

export type WorkspaceState = {
  projects: ProjectEntry[];
  projectsLoaded: boolean;
  selectedProjectId: string | null;
  agentCwd: string;
  models: AgentModel[];
  selectedModel: string;
  modelsLoading: boolean;
  layout: WorkspaceLayout;
  panesById: ReadonlyMap<PaneId, PaneState>;
  focusedPaneId: PaneId;
  setupWarning: string;
  error: string;
  gitSummaries: ReadonlyMap<string, GitSummary>;
  computer: { open: boolean; tab: ComputerTab; width: number };
  browserToolEnabled: boolean;
  browserUrl: string;
  browserInput: string;
  hydrated: boolean;
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
  | { type: "setProjects"; projects: ProjectEntry[]; storedProjectId?: string | null }
  | { type: "setProjectsLoaded"; loaded: boolean }
  | { type: "selectProject"; project: ProjectEntry | null }
  | { type: "setAgentCwd"; cwd: string }
  | { type: "setModelsLoading"; loading: boolean }
  | { type: "setModels"; models: AgentModel[]; preferredModelId?: string }
  | { type: "setSelectedModel"; modelId: string }
  | { type: "setSetupWarning"; warning: string }
  | { type: "setError"; error: string }
  | { type: "setLayout"; layout: WorkspaceLayout }
  | { type: "setSplitRatio"; path: number[]; ratio: number }
  | {
      type: "restorePaneState";
      layout: WorkspaceLayout;
      panesById: ReadonlyMap<PaneId, PaneState>;
      focusedPaneId: PaneId;
    }
  | { type: "openNewSession"; project?: ProjectEntry; tab?: SessionTab }
  | { type: "replaySession"; piSessionId: string; tab?: SessionTab }
  | {
      type: "replaySessionInSplit";
      piSessionId: string;
      paneId?: PaneId;
      runtimeSessionId?: string;
      tab?: SessionTab;
    }
  | {
      type: "openSessionPayloadInPane";
      paneId: PaneId;
      payload: WorkspaceSessionPayload;
      tab?: SessionTab;
    }
  | {
      type: "splitPaneWithPayload";
      paneId: PaneId;
      direction: "vertical" | "horizontal";
      side: "a" | "b";
      payload: WorkspaceSessionPayload;
      newPaneId?: PaneId;
      runtimeSessionId?: string;
      tab?: SessionTab;
    }
  | { type: "focusPane"; paneId: PaneId }
  | { type: "focusTab"; paneId: PaneId; tabId: string }
  | { type: "renameTab"; paneId: PaneId; tabId: string; title: string }
  | {
      type: "splitTab";
      sourcePaneId: PaneId;
      sourceTabId: string;
      newPaneId?: PaneId;
      runtimeSessionId?: string;
      tab?: SessionTab;
    }
  | { type: "closePane"; paneId: PaneId }
  | { type: "setPaneTabs"; paneId: PaneId; tabs: SessionTab[] }
  | { type: "patchActiveTab"; paneId: PaneId; patch: Partial<SessionTab> }
  | { type: "setComputerOpen"; open: boolean }
  | { type: "toggleComputerOpen" }
  | { type: "setComputerTab"; tab: ComputerTab }
  | { type: "setComputerWidth"; width: number }
  | { type: "setBrowserToolEnabled"; enabled: boolean }
  | { type: "toggleBrowserTool" }
  | { type: "setBrowserUrl"; url: string; input?: string }
  | { type: "setBrowserInput"; input: string }
  | { type: "setGitSummary"; cwd: string; summary: GitSummary | null }
  | { type: "deleteGitSummary"; cwd: string }
  | {
      type: "hydrateActiveSessions";
      snapshots: ActiveAgentSessionSnapshot[];
      hasExplicitSessionNav?: boolean;
    };
