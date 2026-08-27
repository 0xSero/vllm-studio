import path from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { CHATS_PROJECT_ID } from "../../../shared/agent/project-ids";
import {
  createProjectsStore,
  type ProjectEntry,
} from "../../../frontend/desktop/logic/projects-store-core";

export type { ProjectEntry };

const PROJECTS_RELATIVE = path.join("data", "agentfs", "projects.json");

function projectsFilePath(): string {
  if (process.env.LOCAL_STUDIO_PROJECTS_FILE) return process.env.LOCAL_STUDIO_PROJECTS_FILE;
  let dir = process.cwd();
  let firstRepoRoot: string | null = null;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, PROJECTS_RELATIVE);
    if (existsSync(candidate)) return candidate;
    if (firstRepoRoot === null && existsSync(path.join(dir, ".git"))) firstRepoRoot = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const root = firstRepoRoot ?? path.resolve(process.cwd(), "..");
  return path.join(root, PROJECTS_RELATIVE);
}

const store = createProjectsStore({
  projectsFilePath,
  chatsProjectId: CHATS_PROJECT_ID,
  emptyPathMessage: "path is required",
});

export function projectsStoreFilePath(): string {
  return projectsFilePath();
}

export function listProjectsFromStore(): ProjectEntry[] {
  return store.listProjects();
}

export function addProjectToStore(rawPath: string): ProjectEntry {
  return store.addProject(resolveAllowedWorkspace(rawPath));
}

export function removeProjectFromStore(id: string): void {
  store.removeProject(id);
}

function canonicalDirectory(rawPath: string): string {
  const resolved = realpathSync.native(rawPath);
  if (!statSync(resolved).isDirectory()) throw new Error(`Path is not a directory: ${rawPath}`);
  return resolved;
}

export function allowedWorkspaceRoots(): string[] {
  const configured = process.env.WORKSPACE_ROOTS?.split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const roots = configured?.length ? configured : [homedir()];
  return [...new Set(roots.map(canonicalDirectory))];
}

export function resolveAllowedWorkspace(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) throw new Error("path is required");
  const candidate = canonicalDirectory(trimmed);
  const allowed = allowedWorkspaceRoots().some((root) => {
    const relative = path.relative(root, candidate);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
    );
  });
  if (!allowed) throw new Error("Path is outside WORKSPACE_ROOTS");
  return candidate;
}
