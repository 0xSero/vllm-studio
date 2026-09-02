import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CHATS_PROJECT_ID } from "../../../shared/agent/project-ids";
import type { ProjectEntry, ProjectRecord, ProjectsDocument } from "../../../shared/agent/projects";
import { resolveProjectsFilePath } from "./data-dir";
import { ownerFileExists, restrictOwnerFile } from "./owner-files";
import { projectPathKey, readProjectsDocument, writeProjectsDocument } from "./projects-document";
import { withProjectsFileTransaction } from "./projects-lock";
import { migrateLegacyProjectsRegistry } from "./projects-migration";

export type { ProjectEntry, ProjectRecord } from "../../../shared/agent/projects";

const initializations = new Map<string, Promise<void>>();

export function projectsStoreFilePath(): string {
  return resolveProjectsFilePath();
}

export function initializeProjectsStore(): Promise<void> {
  const filePath = projectsStoreFilePath();
  const existing = initializations.get(filePath);
  if (existing) return existing;
  const pending = migrateLegacyProjectsRegistry().catch((error: unknown) => {
    initializations.delete(filePath);
    throw error;
  });
  initializations.set(filePath, pending);
  return pending;
}

async function withProjectsDocument<T>(
  callback: (document: ProjectsDocument, filePath: string) => T,
): Promise<T> {
  await initializeProjectsStore();
  const filePath = projectsStoreFilePath();
  return withProjectsFileTransaction(filePath, () => {
    if (ownerFileExists(filePath)) restrictOwnerFile(filePath);
    return callback(readProjectsDocument(filePath), filePath);
  });
}

function isExistingDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function gitBranchFor(projectPath: string): string | null {
  try {
    const head =
      readFileSync(path.join(projectPath, ".git", "HEAD"), "utf8")
        .trim()
        .split("\n")[0] ?? "";
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (match?.[1]) return match[1];
    return /^[0-9a-f]{7,40}$/i.test(head) ? head.slice(0, 7) : null;
  } catch {
    return null;
  }
}

function withMeta(record: ProjectRecord): ProjectEntry {
  return {
    ...record,
    exists: isExistingDirectory(record.path),
    hasGit: existsSync(path.join(record.path, ".git")),
    branch: gitBranchFor(record.path),
  };
}

function chatsProject(): ProjectEntry {
  const chatsPath = path.join(homedir(), ".local-studio");
  mkdirSync(chatsPath, { recursive: true, mode: 0o700 });
  return withMeta({
    id: CHATS_PROJECT_ID,
    name: "Chats",
    path: chatsPath,
    addedAt: "1970-01-01T00:00:00.000Z",
  });
}

export function listProjectsFromStore(): ProjectEntry[] {
  const projects = readProjectsDocument(projectsStoreFilePath()).projects.filter(
    (project) => project.id !== CHATS_PROJECT_ID,
  );
  return [chatsProject(), ...projects.map(withMeta)];
}

export async function addProjectToStore(rawPath: string): Promise<ProjectEntry> {
  const projectPath = resolveAllowedWorkspace(rawPath);
  const record = await withProjectsDocument((document, filePath) => {
    const pathKey = projectPathKey(projectPath);
    const existing = document.projects.find((project) => projectPathKey(project.path) === pathKey);
    if (existing) return existing;
    const record: ProjectRecord = {
      id: `proj-${randomUUID()}`,
      name: path.basename(projectPath) || projectPath,
      path: projectPath,
      addedAt: new Date().toISOString(),
    };
    writeProjectsDocument(filePath, { projects: [record, ...document.projects] });
    return record;
  });
  return withMeta(record);
}

export async function removeProjectFromStore(id: string): Promise<void> {
  if (id === CHATS_PROJECT_ID) return;
  await withProjectsDocument((document, filePath) => {
    if (!document.projects.some((project) => project.id === id)) return;
    writeProjectsDocument(filePath, {
      projects: document.projects.filter((project) => project.id !== id),
    });
  });
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
