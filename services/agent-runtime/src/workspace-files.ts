import { existsSync, promises as fs, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { FsEntry } from "../../../shared/agent/workspace";
import { listProjectsFromStore } from "./projects-store";

const IGNORE_DIRS = new Set(
  ".git node_modules .next dist dist-desktop .turbo .cache __pycache__ .venv venv .local-studio".split(
    " ",
  ),
);
const SYSTEM_ROOTS = new Set(
  "/ /bin /boot /dev /etc /lib /lib32 /lib64 /libx32 /opt /proc /root /run /sbin /sys /usr /var".split(
    " ",
  ),
);
const resolveRealPath = (candidate: string): string => {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
};
const RESOLVED_SYSTEM_ROOTS = new Set([...SYSTEM_ROOTS].map(resolveRealPath));
export function assertWorkspaceRoot(rootCwd: string): string {
  const resolved = path.resolve(rootCwd);
  const real = resolveRealPath(resolved);
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

function resolveWorkspaceRoot(cwd: string): string {
  const requestedReal = resolveRealPath(cwd);
  return listProjectsFromStore().some(
    (project) => project.exists && resolveRealPath(project.path) === requestedReal,
  )
    ? requestedReal
    : assertWorkspaceRoot(requestedReal);
}
function ensureInside(rootCwd: string, target: string): string {
  const realRoot = realpathSync(assertWorkspaceRoot(rootCwd));
  const realTarget = resolveRealPath(target);
  const rel = path.relative(realRoot, realTarget);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error("Path escapes project root");
  }
  return realTarget;
}

function workspaceFile(rootCwd: string, relPath: string): { root: string; target: string } {
  const root = resolveWorkspaceRoot(rootCwd);
  return { root, target: ensureInside(root, path.resolve(root, relPath)) };
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

export async function readFileSnippet(
  rootCwd: string,
  relPath: string,
  maxBytes = 5 * 1024 * 1024,
): Promise<{ content: string; truncated: boolean; size: number }> {
  const { target } = workspaceFile(rootCwd, relPath);
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
export async function readFileBytes(
  rootCwd: string,
  relPath: string,
  maxBytes = 64 * 1024 * 1024,
): Promise<{ bytes: Buffer; size: number; modifiedAt: Date }> {
  const { root, target } = workspaceFile(rootCwd, relPath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Path escapes project root");
  }
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error("Not a file");
  if (stats.size > maxBytes) throw new Error("File is too large to serve");
  return { bytes: await fs.readFile(target), size: stats.size, modifiedAt: stats.mtime };
}

export async function writeFileContent(
  rootCwd: string,
  relPath: string,
  content: string,
): Promise<void> {
  const { target } = workspaceFile(rootCwd, relPath);
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error("Not a file");
  await fs.writeFile(target, content, "utf8");
}
