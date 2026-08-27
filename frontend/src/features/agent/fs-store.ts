import {
  constants,
  existsSync,
  promises as fs,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type { FsEntry } from "@/features/agent/filesystem-types";
import { listProjectsFromStore } from "@local-studio/agent-runtime/projects-store";

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "dist-desktop",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".local-studio",
]);

const SYSTEM_ROOTS = new Set([
  "/",
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/opt",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
]);

const RESOLVED_SYSTEM_ROOTS = new Set(
  [...SYSTEM_ROOTS].map((entry) => {
    try {
      return realpathSync(entry);
    } catch {
      return entry;
    }
  }),
);

export function assertWorkspaceRoot(rootCwd: string): string {
  const resolved = path.resolve(rootCwd);
  const real = (() => {
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  })();
  if (
    SYSTEM_ROOTS.has(resolved) ||
    SYSTEM_ROOTS.has(real) ||
    RESOLVED_SYSTEM_ROOTS.has(real) ||
    real === path.parse(real).root
  ) {
    throw new Error("Path is not an allowed workspace root");
  }
  return real;
}

function resolveRealPath(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function resolveWorkspaceRoot(cwd: string): string {
  const requestedReal = resolveRealPath(cwd);
  for (const project of listProjectsFromStore()) {
    if (!project.exists) continue;
    const projectReal = resolveRealPath(project.path);
    if (projectReal === requestedReal) return projectReal;
  }
  return assertWorkspaceRoot(requestedReal);
}

function ensureInside(rootCwd: string, target: string): string {
  const realRoot = realpathSync(assertWorkspaceRoot(rootCwd));
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    realTarget = path.resolve(target);
  }
  const rel = path.relative(realRoot, realTarget);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error("Path escapes project root");
  }
  return realTarget;
}

export function listDirectory(rootCwd: string, relPath: string): FsEntry[] {
  const root = resolveWorkspaceRoot(rootCwd);
  const target = ensureInside(root, path.resolve(root, relPath || "."));
  if (!existsSync(target)) throw new Error("Not found");
  const stats = statSync(target);
  if (!stats.isDirectory()) throw new Error("Not a directory");

  const names = readdirSync(target);
  const entries: FsEntry[] = [];
  for (const name of names) {
    if (IGNORE_DIRS.has(name)) continue;
    if (name.startsWith(".") && name !== ".env.example") continue;
    const abs = path.join(target, name);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    entries.push({
      name,
      path: abs,
      rel: path.relative(root, abs),
      kind: s.isDirectory() ? "directory" : "file",
      size: s.isFile() ? s.size : undefined,
      modifiedAt: s.mtime.toISOString(),
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

const SEARCH_MAX_VISITED = 20_000;
const SEARCH_MAX_DEPTH = 12;

function fileMatch(query: string, name: string, relativePath: string): "name" | "path" | undefined {
  if (!query || name.toLowerCase().includes(query)) return "name";
  if (relativePath.toLowerCase().includes(query)) return "path";
}

type SearchDirectory = { dir: string; depth: number };
function searchCandidate(
  root: string,
  query: string,
  current: SearchDirectory,
  name: string,
  queue: SearchDirectory[],
): FsEntry | undefined {
  if (IGNORE_DIRS.has(name) || (name.startsWith(".") && name !== ".env.example")) return undefined;
  const abs = path.join(current.dir, name);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(abs);
  } catch {
    return undefined;
  }
  if (stats.isDirectory()) {
    if (current.depth < SEARCH_MAX_DEPTH) queue.push({ dir: abs, depth: current.depth + 1 });
    return undefined;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) return undefined;
  const rel = path.relative(root, abs);
  const match = fileMatch(query, name, rel);
  if (!match) return undefined;
  return {
    name,
    path: abs,
    rel,
    kind: "file",
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

export function searchFiles(rootCwd: string, query: string, limit = 20): FsEntry[] {
  const root = resolveWorkspaceRoot(rootCwd);
  const q = query.trim().toLowerCase();
  const nameMatches: FsEntry[] = [];
  const pathMatches: FsEntry[] = [];
  const queue: SearchDirectory[] = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && nameMatches.length < limit && visited < SEARCH_MAX_VISITED) {
    const current = queue.shift();
    if (!current) break;
    let names: string[];
    try {
      names = readdirSync(current.dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (visited >= SEARCH_MAX_VISITED || nameMatches.length >= limit) break;
      visited += 1;
      const entry = searchCandidate(root, q, current, name, queue);
      if (!entry) continue;
      if (!q || name.toLowerCase().includes(q)) nameMatches.push(entry);
      else pathMatches.push(entry);
    }
  }
  return [...nameMatches, ...pathMatches].slice(0, limit);
}

export async function readFileSnippet(
  rootCwd: string,
  relPath: string,
  maxBytes = 5 * 1024 * 1024,
): Promise<{ content: string; truncated: boolean; size: number }> {
  const root = resolveWorkspaceRoot(rootCwd);
  const target = ensureInside(root, path.resolve(root, relPath));
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error("Not a file");
  if (stats.size > maxBytes) {
    return { content: "", truncated: true, size: stats.size };
  }
  const buf = await fs.readFile(target);
  const head = buf.subarray(0, Math.min(buf.length, 8192));
  if (head.includes(0)) {
    return { content: "", truncated: true, size: stats.size };
  }
  return { content: buf.toString("utf-8"), truncated: false, size: stats.size };
}

export async function openReadableFile(
  rootCwd: string,
  relPath: string,
): Promise<{ file: FileHandle; size: number; modifiedAt: Date }> {
  const root = resolveWorkspaceRoot(rootCwd);
  const resolved = path.resolve(root, relPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes project root");
  }
  const target = ensureInside(root, resolved);
  const file = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("Not a file");
    return { file, size: stats.size, modifiedAt: stats.mtime };
  } catch (error) {
    await file.close();
    throw error;
  }
}

export async function writeFileContent(
  rootCwd: string,
  relPath: string,
  content: string,
): Promise<void> {
  const root = resolveWorkspaceRoot(rootCwd);
  const target = ensureInside(root, path.resolve(root, relPath));
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error("Not a file");
  await fs.writeFile(target, content, "utf8");
}
