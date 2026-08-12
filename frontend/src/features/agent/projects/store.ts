import { create } from "zustand";
import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
import * as api from "@/features/agent/projects/api";
import type { GitSummary, Project, ProjectId } from "@/features/agent/projects/types";
import { readStored, readStoredJson, removeStored, writeStored } from "@/lib/storage";

export type ProjectsStore = {
  projects: Project[];
  loaded: boolean;
  selectedId: ProjectId | null;
  gitSummaries: ReadonlyMap<string, GitSummary>;
  initialize: () => void;
  refresh: () => Promise<void>;
  selectProject: (project: Project | null) => void;
  upsertProject: (project: Project) => void;
  removeProject: (id: string) => Promise<void>;
  moveProjectBefore: (dragId: string, targetId: string | null) => void;
  loadGitSummary: (cwd: string) => Promise<GitSummary | null>;
  initGitForActiveProject: () => Promise<void>;
};

let lastGitFetch: string | null = null;
let refreshInFlight: Promise<void> | null = null;
const SELECTED_PROJECT_KEY = "local-studio.agent.selectedProjectId";
const PROJECTS_CACHE_KEY = "local-studio.agent.projects.cache.v1";
const PROJECTS_ORDER_KEY = "local-studio.agent.projects.order.v1";
const readSelectedProjectId = (): string | null => readStored(SELECTED_PROJECT_KEY);

export const useProjectsStore = create<ProjectsStore>((set, get) => {
  const loadGitSummary = async (cwd: string): Promise<GitSummary | null> => {
    if (!cwd) return null;
    try {
      const summary = await api.loadGitSummary(cwd);
      set((state) => {
        const gitSummaries = new Map(state.gitSummaries);
        if (summary) gitSummaries.set(cwd, summary);
        else gitSummaries.delete(cwd);
        return { gitSummaries };
      });
      return summary;
    } catch {
      if (!get().gitSummaries.has(cwd)) return null;
      set((state) => {
        const gitSummaries = new Map(state.gitSummaries);
        gitSummaries.delete(cwd);
        return { gitSummaries };
      });
      return null;
    }
  };

  const loadGitSummaryOnce = (cwd: string): void => {
    if (!cwd || lastGitFetch === cwd) return;
    lastGitFetch = cwd;
    void loadGitSummary(cwd);
  };

  const refresh = async (): Promise<void> => {
    let projects = get().projects;
    try {
      projects = applyProjectOrder(await api.loadProjects());
      writeCachedProjects(projects);
    } catch {}
    const previousSelectedId = get().selectedId;
    const selectedId = resolveSelectedProjectId(previousSelectedId, projects);
    set({ projects, loaded: true, selectedId });
    if (selectedId !== previousSelectedId) writeSelectedProjectId(selectedId);
    void loadGitSummary(projectPathById(projects, selectedId));
  };

  return {
    projects: applyProjectOrder(readCachedProjects()),
    loaded: false,
    selectedId: readSelectedProjectId(),
    gitSummaries: new Map(),
    initialize: () => {
      refreshInFlight ??= refresh().finally(() => {
        refreshInFlight = null;
      });
    },
    refresh,
    selectProject: (project) => {
      const selectedId = project?.id ?? null;
      if (selectedId !== get().selectedId) writeSelectedProjectId(selectedId);
      set({ selectedId });
      loadGitSummaryOnce(project?.path ?? "");
    },
    upsertProject: (project) => {
      set((state) => ({
        projects: [project, ...state.projects.filter((entry) => entry.id !== project.id)],
      }));
      void refresh();
    },
    removeProject: async (id) => {
      await api.removeProject(id);
      const previousSelectedId = get().selectedId;
      const projects = get().projects.filter((entry) => entry.id !== id);
      const selectedId = previousSelectedId === id ? null : previousSelectedId;
      set({ projects, selectedId });
      if (selectedId !== previousSelectedId) writeSelectedProjectId(selectedId);
      void refresh();
    },
    moveProjectBefore: (dragId, targetId) => {
      if (dragId === targetId) return;
      const projects = [...get().projects];
      const fromIndex = projects.findIndex((entry) => entry.id === dragId);
      if (fromIndex === -1) return;
      const [moved] = projects.splice(fromIndex, 1);
      const toIndex = targetId ? projects.findIndex((entry) => entry.id === targetId) : -1;
      if (toIndex === -1) projects.push(moved);
      else projects.splice(toIndex, 0, moved);
      writeProjectOrder(projects.map((entry) => entry.id));
      writeCachedProjects(projects);
      set({ projects });
    },
    loadGitSummary,
    initGitForActiveProject: async () => {
      const cwd = projectPathById(get().projects, get().selectedId);
      if (!cwd) return;
      await api.initGit(cwd);
      await loadGitSummary(cwd);
      void refresh();
      if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
    },
  };
});

function resolveSelectedProjectId(
  current: ProjectId | null,
  projects: readonly Project[],
): ProjectId | null {
  if (current && projects.some((project) => project.id === current)) return current;
  return projects[0]?.id ?? null;
}

function projectPathById(projects: readonly Project[], projectId: ProjectId | null): string {
  return projects.find((project) => project.id === projectId)?.path ?? "";
}

function readProjectOrder(): string[] {
  return readStoredJson(PROJECTS_ORDER_KEY, [], (value) =>
    Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : null,
  );
}

function writeProjectOrder(ids: string[]): void {
  writeStored(PROJECTS_ORDER_KEY, JSON.stringify(ids));
}

function applyProjectOrder(projects: Project[]): Project[] {
  const order = readProjectOrder();
  if (order.length === 0) return projects;
  const position = new Map(order.map((id, index) => [id, index] as const));
  return [...projects].sort(
    (left, right) =>
      (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function readCachedProjects(): Project[] {
  return readStoredJson(PROJECTS_CACHE_KEY, [], (value) =>
    Array.isArray(value)
      ? value.filter(
          (entry): entry is Project =>
            Boolean(entry) &&
            typeof (entry as Project).id === "string" &&
            typeof (entry as Project).path === "string",
        )
      : null,
  );
}

function writeCachedProjects(projects: Project[]): void {
  writeStored(PROJECTS_CACHE_KEY, JSON.stringify(projects));
}

function writeSelectedProjectId(id: string | null): void {
  if (id) writeStored(SELECTED_PROJECT_KEY, id);
  else removeStored(SELECTED_PROJECT_KEY);
}
