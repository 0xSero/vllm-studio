import { Effect } from "effect";
import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
import * as api from "@/features/agent/projects/api";
import {
  dispatchWorkbenchCommand,
  getWorkbenchProjection,
  refreshWorkbench,
  subscribeWorkbench,
} from "@/features/workbench/controller-state";
import {
  CHATS_PROJECT_ID,
  type GitSummary,
  type Project,
  type ProjectId,
} from "@/features/agent/projects/types";

export type ProjectsSnapshot = {
  projects: Project[];
  loaded: boolean;
  selectedId: ProjectId | null;
  gitSummaries: ReadonlyMap<string, GitSummary>;
};

export type ProjectsStore = {
  getSnapshot: () => ProjectsSnapshot;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  selectProject: (project: Project | null) => void;
  upsertProject: (project: Project) => void;
  removeProject: (id: string) => Promise<void>;
  moveProjectBefore: (dragId: string, targetId: string | null) => void;
  loadGitSummary: (cwd: string) => Promise<GitSummary | null>;
  initGitForActiveProject: () => Promise<void>;
};

function projectsFromController(): Project[] {
  return getWorkbenchProjection().projects.map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
    addedAt: "",
    exists: true,
    hasGit: false,
    branch: null,
    accountId: project.accountId,
    organization: project.organization,
    repository: project.repository,
    repositoryUrl: project.repositoryUrl,
    defaultBranch: project.defaultBranch,
  }));
}

function selectedProjectId(): ProjectId | null {
  return getWorkbenchProjection().selectedProjectId ?? null;
}

function projectPathById(projects: readonly Project[], projectId: ProjectId | null): string {
  if (projectId === CHATS_PROJECT_ID) return "";
  return projects.find((project) => project.id === projectId)?.path ?? "";
}

export function createProjectsStore(): ProjectsStore {
  const listeners = new Set<() => void>();
  let controllerUnsubscribe: (() => void) | null = null;
  let lastGitFetch: string | null = null;
  let snapshot: ProjectsSnapshot = {
    projects: projectsFromController(),
    loaded: false,
    selectedId: selectedProjectId(),
    gitSummaries: new Map(),
  };

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const update = (next: ProjectsSnapshot): void => {
    snapshot = next;
    emit();
  };

  const syncController = (): void => {
    update({
      ...snapshot,
      projects: projectsFromController(),
      selectedId: selectedProjectId(),
      loaded: true,
    });
  };

  const loadGitSummary = async (cwd: string): Promise<GitSummary | null> => {
    if (!cwd) return null;
    try {
      const summary = await api.loadGitSummary(cwd);
      const next = new Map(snapshot.gitSummaries);
      if (summary) next.set(cwd, summary);
      else next.delete(cwd);
      update({ ...snapshot, gitSummaries: next });
      return summary;
    } catch {
      if (!snapshot.gitSummaries.has(cwd)) return null;
      const next = new Map(snapshot.gitSummaries);
      next.delete(cwd);
      update({ ...snapshot, gitSummaries: next });
      return null;
    }
  };

  const refresh = async (): Promise<void> => {
    await Effect.runPromise(refreshWorkbench());
    syncController();
    void loadGitSummary(projectPathById(snapshot.projects, snapshot.selectedId));
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      if (!controllerUnsubscribe) {
        controllerUnsubscribe = subscribeWorkbench(syncController);
        void refresh().catch(() => update({ ...snapshot, loaded: true }));
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          controllerUnsubscribe?.();
          controllerUnsubscribe = null;
        }
      };
    },
    refresh,
    selectProject: (project) => {
      void Effect.runPromise(
        dispatchWorkbenchCommand({
          kind: "select_project",
          ...(project ? { projectId: project.id } : {}),
        }),
      );
      const cwd = project?.id === CHATS_PROJECT_ID ? "" : (project?.path ?? "");
      if (cwd && lastGitFetch !== cwd) {
        lastGitFetch = cwd;
        void loadGitSummary(cwd);
      }
    },
    upsertProject: (project) => {
      update({
        ...snapshot,
        projects: [project, ...snapshot.projects.filter((entry) => entry.id !== project.id)],
      });
      void refresh();
    },
    removeProject: async (id) => {
      await api.removeProject(id);
      await refresh();
    },
    moveProjectBefore: (projectId, targetId) => {
      void Effect.runPromise(
        dispatchWorkbenchCommand({
          kind: "move_project",
          projectId,
          ...(targetId ? { targetId } : {}),
        }),
      );
    },
    loadGitSummary,
    initGitForActiveProject: async () => {
      const cwd = projectPathById(snapshot.projects, snapshot.selectedId);
      if (!cwd) return;
      await api.initGit(cwd);
      await loadGitSummary(cwd);
      await refresh();
      window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
    },
  };
}
