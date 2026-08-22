import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
import * as defaultApi from "@/features/agent/projects/api";
import type { GitSummary, Project, ProjectId } from "@/features/agent/projects/types";

export type ProjectsSnapshot = {
  projects: Project[];
  loaded: boolean;
  selectedId: ProjectId | null;
  gitSummaries: ReadonlyMap<string, GitSummary>;
};

type ProjectsApi = Pick<
  typeof defaultApi,
  "initGit" | "loadGitSummary" | "loadProjects" | "removeProject"
>;

type BrowserWindowLike = Pick<Window, "addEventListener" | "dispatchEvent" | "removeEventListener">;

export type ProjectsStoreDependencies = {
  api?: ProjectsApi;
  readSelectedProjectId?: () => ProjectId | null;
  writeSelectedProjectId?: (id: ProjectId | null) => void;
  getWindow?: () => BrowserWindowLike | null;
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

export function createProjectsStore(dependencies: ProjectsStoreDependencies = {}): ProjectsStore {
  const api = dependencies.api ?? defaultApi;
  const readSelection = dependencies.readSelectedProjectId ?? readSelectedProjectId;
  const writeSelection = dependencies.writeSelectedProjectId ?? writeSelectedProjectId;
  const getWindow =
    dependencies.getWindow ??
    ((): BrowserWindowLike | null => (typeof window === "undefined" ? null : window));
  const listeners = new Set<() => void>();
  let started = false;
  let lastGitFetch: string | null = null;
  let snapshot: ProjectsSnapshot = {
    projects: applyProjectOrder(readCachedProjects()),
    loaded: false,
    selectedId: readSelection(),
    gitSummaries: new Map(),
  };

  const update = (next: ProjectsSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const loadGitSummary = async (cwd: string): Promise<GitSummary | null> => {
    if (!cwd) return null;
    let summary: GitSummary | null = null;
    try {
      summary = await api.loadGitSummary(cwd);
    } catch {
      // Nothing cached to invalidate: leave the snapshot untouched.
      if (!snapshot.gitSummaries.has(cwd)) return null;
    }
    const next = new Map(snapshot.gitSummaries);
    if (summary) next.set(cwd, summary);
    else next.delete(cwd);
    update({ ...snapshot, gitSummaries: next });
    return summary;
  };

  const loadGitSummaryOnce = (cwd: string): void => {
    if (!cwd || lastGitFetch === cwd) return;
    lastGitFetch = cwd;
    void loadGitSummary(cwd);
  };

  const refresh = async (): Promise<void> => {
    let projects: Project[] = [];
    try {
      projects = applyProjectOrder(await api.loadProjects());
      writeCachedProjects(projects);
    } catch {
      projects = snapshot.projects;
    }
    const previousSelectedId = snapshot.selectedId;
    const selectedId = resolveSelectedProjectId(previousSelectedId, projects);
    update({ ...snapshot, projects, loaded: true, selectedId });
    if (selectedId !== previousSelectedId) writeSelection(selectedId);
    void loadGitSummary(projectPathById(projects, selectedId));
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      if (!started) {
        started = true;
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) started = false;
      };
    },
    refresh,
    selectProject: (project) => {
      const selectedId = project?.id ?? null;
      if (selectedId !== snapshot.selectedId) writeSelection(selectedId);
      update({ ...snapshot, selectedId });
      loadGitSummaryOnce(project?.path ?? "");
    },
    upsertProject: (project) => {
      const kept = snapshot.projects.filter((entry) => entry.id !== project.id);
      update({ ...snapshot, projects: [project, ...kept] });
      void refresh();
    },
    removeProject: async (id) => {
      await api.removeProject(id);
      const previousSelectedId = snapshot.selectedId;
      const projects = snapshot.projects.filter((entry) => entry.id !== id);
      const selectedId = previousSelectedId === id ? null : previousSelectedId;
      update({ ...snapshot, projects, selectedId });
      if (selectedId !== previousSelectedId) writeSelection(selectedId);
      void refresh();
    },
    moveProjectBefore: (dragId, targetId) => {
      if (dragId === targetId) return;
      const projects = [...snapshot.projects];
      const fromIndex = projects.findIndex((entry) => entry.id === dragId);
      if (fromIndex === -1) return;
      const [moved] = projects.splice(fromIndex, 1);
      const toIndex = targetId ? projects.findIndex((entry) => entry.id === targetId) : -1;
      if (toIndex === -1) projects.push(moved);
      else projects.splice(toIndex, 0, moved);
      writeStored(PROJECTS_ORDER_KEY, JSON.stringify(projects.map((entry) => entry.id)));
      writeCachedProjects(projects);
      update({ ...snapshot, projects });
    },
    loadGitSummary,
    initGitForActiveProject: async () => {
      const cwd = projectPathById(snapshot.projects, snapshot.selectedId);
      if (!cwd) return;
      await api.initGit(cwd);
      await loadGitSummary(cwd);
      void refresh();
      getWindow()?.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
    },
  };
}

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

const SELECTED_PROJECT_KEY = "local-studio.agent.selectedProjectId";
const PROJECTS_CACHE_KEY = "local-studio.agent.projects.cache.v1";
const PROJECTS_ORDER_KEY = "local-studio.agent.projects.order.v1";

function readStoredJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {}
}

/** Apply the user's saved manual order; projects without a saved position keep
 * their load order and sort after the ordered ones. */
function applyProjectOrder(projects: Project[]): Project[] {
  const stored = readStoredJson(PROJECTS_ORDER_KEY);
  const order = Array.isArray(stored)
    ? stored.filter((id): id is string => typeof id === "string")
    : [];
  if (order.length === 0) return projects;
  const position = new Map(order.map((id, index) => [id, index] as const));
  const rank = (project: Project) => position.get(project.id) ?? Number.MAX_SAFE_INTEGER;
  return [...projects].sort((a, b) => rank(a) - rank(b));
}

function readCachedProjects(): Project[] {
  const parsed = readStoredJson(PROJECTS_CACHE_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is Project =>
      Boolean(entry) &&
      typeof (entry as Project).id === "string" &&
      typeof (entry as Project).path === "string",
  );
}

const writeCachedProjects = (projects: Project[]) =>
  writeStored(PROJECTS_CACHE_KEY, JSON.stringify(projects));

const writeSelectedProjectId = (id: string | null) => writeStored(SELECTED_PROJECT_KEY, id);

function readSelectedProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_PROJECT_KEY);
  } catch {
    return null;
  }
}
