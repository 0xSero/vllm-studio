import { safeJson } from "@/features/agent/safe-json";
import { Schema } from "effect";
import type { GitAction, GitBranch, GitState } from "@/features/agent/contracts";
import type { GitSummary, Project, RepositoryOption } from "@/features/agent/projects/types";

const RepositoryOptionSchema = Schema.Struct({
  accountId: Schema.String,
  accountLabel: Schema.String,
  organization: Schema.String,
  name: Schema.String,
  repository: Schema.String,
  url: Schema.String,
  defaultBranch: Schema.String,
});

const RepositoriesPayloadSchema = Schema.Struct({
  repositories: Schema.Array(RepositoryOptionSchema),
  accounts: Schema.Number,
  defaultAccountId: Schema.optional(Schema.String),
});

const PreparedWorkspaceSchema = Schema.Struct({
  path: Schema.String,
  ref: Schema.String,
  detached: Schema.Boolean,
});

const ProjectRefsSchema = Schema.Struct({ refs: Schema.Array(Schema.String) });

type DesktopBridge = {
  openDirectory?: () => Promise<string | null>;
};

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { localStudioDesktop?: Partial<DesktopBridge> })
    .localStudioDesktop;
  if (!candidate) return null;
  const hasBridgeMethod = typeof candidate.openDirectory === "function";
  return hasBridgeMethod ? (candidate as DesktopBridge) : null;
}

export type OpenProjectDirectoryResult =
  | { source: "desktop"; project: Project | null }
  | { source: "fallback" };

export async function openProjectDirectory(accountId: string): Promise<OpenProjectDirectoryResult> {
  const bridge = getDesktopBridge();
  if (!bridge?.openDirectory) return { source: "fallback" };
  const path = await bridge.openDirectory();
  return { source: "desktop", project: path ? await addProjectFromPath(path, accountId) : null };
}

export async function addProjectFromPath(path: string, accountId: string): Promise<Project> {
  const folder = path
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]/u)
    .at(-1)
    ?.trim();
  const repository = folder?.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!repository || repository === "." || repository === "..")
    throw new Error("Choose a project folder");
  const response = await fetch("/api/agent/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ import: true, path, accountId, repository }),
  });
  const payload = (await response.json()) as { project?: Project; error?: string; detail?: string };
  if (!response.ok || !payload.project) {
    throw new Error(payload.error || payload.detail || "Failed to add project");
  }
  return payload.project;
}

export async function listRepositoryOptions(): Promise<{
  repositories: readonly RepositoryOption[];
  accounts: number;
  defaultAccountId?: string;
}> {
  const response = await fetch("/api/agent/projects/repositories", { cache: "no-store" });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const failure = payload as { error?: string };
    throw new Error(failure.error || "Failed to load repositories");
  }
  return Schema.decodeUnknownSync(RepositoriesPayloadSchema)(payload);
}

export async function createRepositoryProject(
  accountId: string,
  repository: string,
): Promise<Project> {
  const response = await fetch("/api/agent/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ create: true, accountId, repository }),
  });
  const payload = (await response.json()) as { project?: Project; error?: string };
  if (!response.ok || !payload.project)
    throw new Error(payload.error || "Failed to create project");
  return payload.project;
}

export async function addRepositoryProject(repository: RepositoryOption): Promise<Project> {
  const response = await fetch("/api/agent/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: repository.accountId,
      repository: repository.repository,
      repositoryUrl: repository.url,
      defaultBranch: repository.defaultBranch,
    }),
  });
  const payload = (await response.json()) as { project?: Project; error?: string };
  if (!response.ok || !payload.project) throw new Error(payload.error || "Failed to add project");
  return payload.project;
}

export async function prepareTaskWorkspace(input: {
  projectId: string;
  sessionId: string;
  ref: string;
  branch?: string;
}): Promise<{ path: string; ref: string; detached: boolean }> {
  const response = await fetch("/api/agent/projects/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await safeJson<unknown>(response);
  if (!response.ok) {
    const failure = payload as { error?: string; detail?: string };
    throw new Error(failure.error || failure.detail || "Failed to prepare task workspace");
  }
  return Schema.decodeUnknownSync(PreparedWorkspaceSchema)(payload);
}

export async function listProjectRefs(projectId: string): Promise<readonly string[]> {
  const response = await fetch(
    `/api/agent/projects/refs?projectId=${encodeURIComponent(projectId)}`,
    { cache: "no-store" },
  );
  const payload = await response.json();
  if (!response.ok) throw new Error("Failed to load branches");
  return Schema.decodeUnknownSync(ProjectRefsSchema)(payload).refs;
}

export async function removeProject(id: string): Promise<void> {
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

export async function initGit(cwd: string): Promise<void> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "init" }),
  });
  if (!response.ok) {
    const payload = await safeJson<{ error?: string }>(response);
    throw new Error(payload.error || "Failed to initialize git repository");
  }
}

export async function listBranches(cwd: string): Promise<GitBranch[]> {
  const response = await fetch(`/api/agent/git/branches?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<{ branches?: GitBranch[]; error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to list branches");
  return payload.branches ?? [];
}

export async function runGitAction(cwd: string, action: GitAction): Promise<void> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    const payload = await safeJson<{ error?: string }>(response);
    throw new Error(payload.error || "Git operation failed");
  }
}

export async function switchBranch(cwd: string, branch: string): Promise<void> {
  await runGitAction(cwd, { action: "switch_branch", branch });
}

export async function createBranch(cwd: string, branch: string): Promise<void> {
  await runGitAction(cwd, { action: "create_branch", branch });
}
