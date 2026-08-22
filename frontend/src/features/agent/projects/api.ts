import { safeJson } from "@/features/agent/safe-json";
import type { GitAction, GitBranch, GitState, GitWorktree } from "@/features/agent/contracts";
import type { GitSummary, Project } from "@/features/agent/projects/types";

type DesktopBridge = {
  openDirectory?: () => Promise<Project | null>;
  listProjects?: () => Promise<Project[]>;
  removeProject?: (id: string) => Promise<{ ok: true }>;
};

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { localStudioDesktop?: Partial<DesktopBridge> })
    .localStudioDesktop;
  const usable =
    typeof candidate?.openDirectory === "function" ||
    typeof candidate?.listProjects === "function" ||
    typeof candidate?.removeProject === "function";
  return usable ? (candidate as DesktopBridge) : null;
}

export async function loadProjects(): Promise<Project[]> {
  const bridge = getDesktopBridge();
  if (bridge?.listProjects) return bridge.listProjects();
  const response = await fetch("/api/agent/projects", { cache: "no-store" });
  const payload = (await response.json()) as { projects?: Project[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "Failed to load projects");
  return payload.projects ?? [];
}

export type OpenProjectDirectoryResult =
  | { source: "desktop"; project: Project | null }
  | { source: "fallback" };

export async function openProjectDirectory(): Promise<OpenProjectDirectoryResult> {
  const bridge = getDesktopBridge();
  if (!bridge?.openDirectory) return { source: "fallback" };
  return { source: "desktop", project: await bridge.openDirectory() };
}

export async function addProjectFromPath(path: string): Promise<Project> {
  const response = await fetch("/api/agent/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const payload = (await response.json()) as { project?: Project; error?: string };
  if (!response.ok || !payload.project) {
    throw new Error(payload.error || "Failed to add project");
  }
  return payload.project;
}

export async function removeProject(id: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge?.removeProject) {
    await bridge.removeProject(id);
    return;
  }
  const response = await fetch(`/api/agent/projects?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Failed to remove project");
  }
}

export async function loadGitSummary(cwd: string): Promise<GitSummary | null> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<GitState>(response);
  return {
    isRepo: payload.isRepo === true,
    branch: payload.branch ?? null,
    additions: payload.additions ?? 0,
    deletions: payload.deletions ?? 0,
    statusCount: payload.status?.length ?? 0,
  };
}

async function listGitEntities<T>(resource: "branches" | "worktrees", cwd: string): Promise<T[]> {
  const response = await fetch(`/api/agent/git/${resource}?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<{ branches?: T[]; worktrees?: T[]; error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || `Failed to list ${resource}`);
  return payload[resource] ?? [];
}

export const listBranches = (cwd: string) => listGitEntities<GitBranch>("branches", cwd);
export const listWorktrees = (cwd: string) => listGitEntities<GitWorktree>("worktrees", cwd);

export async function runGitAction(
  cwd: string,
  action: GitAction,
  errorMessage = "Git operation failed",
): Promise<void> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    const payload = await safeJson<{ error?: string }>(response);
    throw new Error(payload.error || errorMessage);
  }
}

export const initGit = (cwd: string) =>
  runGitAction(cwd, { action: "init" }, "Failed to initialize git repository");
export const switchBranch = (cwd: string, branch: string) =>
  runGitAction(cwd, { action: "switch_branch", branch });
export const createBranch = (cwd: string, branch: string) =>
  runGitAction(cwd, { action: "create_branch", branch });
export const addWorktree = (cwd: string, branch: string, path: string) =>
  runGitAction(cwd, { action: "add_worktree", branch, path });
export const removeWorktree = (cwd: string, path: string) =>
  runGitAction(cwd, { action: "remove_worktree", path });
