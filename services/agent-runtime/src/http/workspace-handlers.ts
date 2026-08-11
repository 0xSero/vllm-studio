import { exec } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseGitAction, parseTerminalRunRequest } from "../../../../shared/agent/workspace";
import { addComment, deleteComment, listComments } from "../comments-store";
import {
  addProjectToStore,
  listProjectsFromStore,
  removeProjectFromStore,
} from "../projects-store";
import {
  assertWorkspaceRoot,
  listDirectory,
  readFileBytes,
  readFileSnippet,
  writeFileContent,
} from "../workspace-files";
import { assertGitCwd, loadGitState, runGitAction } from "../workspace-git";

const execAsync = promisify(exec);
const jsonError = (message: string, status = 400): Response =>
  Response.json({ error: message }, { status });
const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
const search = (request: Request, key: string): string =>
  new URL(request.url).searchParams.get(key)?.trim() ?? "";

function absoluteCwd(
  request: Request,
  mustExist = false,
): { cwd: string; error?: never } | { cwd?: never; error: Response } {
  const cwd = search(request, "cwd");
  if (!cwd) return { error: jsonError("cwd is required") };
  if (!path.isAbsolute(cwd)) return { error: jsonError("cwd must be absolute") };
  if (mustExist && !existsSync(cwd)) return { error: jsonError("cwd not found", 404) };
  return { cwd };
}

async function jsonBody(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
}

const INLINE_TYPES: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function handleWorkspaceList(request: Request): Promise<Response> {
  const result = absoluteCwd(request, true);
  if (result.error) return result.error;
  try {
    return Response.json({ entries: listDirectory(result.cwd, search(request, "path")) });
  } catch (error) {
    return jsonError(errorMessage(error, "List failed"));
  }
}

export async function handleWorkspaceRaw(request: Request): Promise<Response> {
  const result = absoluteCwd(request);
  if (result.error) return result.error;
  const relativePath = search(request, "path");
  if (!relativePath) return jsonError("path is required");
  try {
    const { bytes, size, modifiedAt } = await readFileBytes(result.cwd, relativePath);
    const name = path.basename(relativePath);
    const inlineType = INLINE_TYPES[path.extname(relativePath).toLowerCase()];
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": inlineType ?? "application/octet-stream",
        "content-length": String(size),
        "content-disposition": `${inlineType ? "inline" : "attachment"}; filename="${encodeURIComponent(name)}"`,
        "last-modified": modifiedAt.toUTCString(),
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Read failed"), 404);
  }
}

export async function handleWorkspaceFile(request: Request): Promise<Response> {
  const result = absoluteCwd(request);
  if (result.error) return result.error;
  const relativePath = search(request, "path");
  if (!relativePath) return jsonError("cwd and path are required");
  try {
    if (request.method === "PUT") {
      const body = await jsonBody(request);
      if (body instanceof Response) return body;
      const content = (body as { content?: unknown })?.content;
      if (typeof content !== "string") return jsonError("content must be a string");
      await writeFileContent(result.cwd, relativePath, content);
    }
    return Response.json(await readFileSnippet(result.cwd, relativePath));
  } catch (error) {
    return jsonError(
      errorMessage(error, request.method === "PUT" ? "Write failed" : "Read failed"),
    );
  }
}

export async function handleComments(request: Request): Promise<Response> {
  const result = absoluteCwd(request);
  if (result.error) return result.error;
  const relativePath = search(request, "path");
  if (!relativePath) return jsonError("cwd and path are required");
  try {
    if (request.method === "GET") {
      return Response.json({ comments: await listComments(result.cwd, relativePath) });
    }
    if (request.method === "DELETE") {
      const id = search(request, "id");
      if (!id) return jsonError("cwd, path, id required");
      await deleteComment(result.cwd, relativePath, id);
      return Response.json({ ok: true });
    }
    const body = await jsonBody(request);
    if (body instanceof Response) return body;
    const record = body as { line?: unknown; body?: unknown };
    const line = Number(record.line);
    const text = typeof record.body === "string" ? record.body.trim() : "";
    if (!Number.isFinite(line) || line < 1 || !text) {
      return jsonError("cwd, path, line, body required");
    }
    return Response.json({ comment: await addComment(result.cwd, relativePath, line, text) });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed"));
  }
}

export async function handleGit(request: Request): Promise<Response> {
  const { cwd, error } = assertGitCwd(search(request, "cwd"));
  if (error) return error;
  try {
    if (request.method === "GET") return Response.json(await loadGitState(cwd));
    const body = await jsonBody(request);
    if (body instanceof Response) return body;
    const action = parseGitAction(body);
    if (!action.ok) return jsonError(action.error);
    return Response.json(await runGitAction(cwd, action.value));
  } catch (failure) {
    return jsonError(errorMessage(failure, "Git operation failed"));
  }
}

function terminalCwd(request: Request): { cwd: string; error?: never } | { error: Response } {
  const result = absoluteCwd(request);
  if (result.error) return { error: result.error };
  const cwd = path.resolve(result.cwd);
  try {
    if (!statSync(cwd).isDirectory()) return { error: jsonError("cwd is not a directory") };
    assertWorkspaceRoot(cwd);
    return { cwd };
  } catch (error) {
    return {
      error: existsSync(cwd)
        ? jsonError(errorMessage(error, "cwd is not an allowed workspace"), 403)
        : jsonError("cwd not found", 404),
    };
  }
}

export async function handleTerminalRun(request: Request): Promise<Response> {
  const result = terminalCwd(request);
  if (result.error) return result.error;
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const parsed = parseTerminalRunRequest(body);
  if (!parsed.ok) return jsonError(parsed.error);
  try {
    const { stdout, stderr } = await execAsync(parsed.value.command, {
      cwd: result.cwd,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    return Response.json({ ok: true, command: parsed.value.command, stdout, stderr, exitCode: 0 });
  } catch (failure) {
    const error = failure as { stdout?: string; stderr?: string; code?: number; message?: string };
    return Response.json({
      ok: false,
      command: parsed.value.command,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: typeof error.code === "number" ? error.code : null,
      error: error.message ?? "Command failed",
    });
  }
}

export async function handleResolveCwd(request: Request): Promise<Response> {
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const target = typeof record.target === "string" ? record.target.trim() : "";
  const from = typeof record.from === "string" ? record.from.trim() : "";
  const previous = typeof record.previous === "string" ? record.previous.trim() : "";
  let next: string;
  if (!target || target === "~") next = os.homedir();
  else if (target === "-") {
    if (!previous) return jsonError("OLDPWD not set");
    next = previous;
  } else if (target.startsWith("~/")) next = path.join(os.homedir(), target.slice(2));
  else if (path.isAbsolute(target)) next = target;
  else {
    if (!from || !path.isAbsolute(from)) return jsonError("from must be absolute");
    next = path.resolve(from, target);
  }
  try {
    if (!statSync(next).isDirectory()) return jsonError(`not a directory: ${next}`);
  } catch {
    return jsonError(`no such file or directory: ${next}`, 404);
  }
  return Response.json({ ok: true, cwd: next });
}

type DirectoryEntry = { name: string; path: string };
const directoryRoots = (): string[] => {
  const raw = process.env.LOCAL_STUDIO_DIRECTORY_BROWSER_ROOTS;
  return (raw ? raw.split(path.delimiter) : [os.homedir()])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
};
const within = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
};
const loopbackHost = (host: string): boolean => {
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return ["localhost", "127.0.0.1", "::1"].includes(hostname?.toLowerCase() ?? "");
};

export async function handleDirectories(request: Request): Promise<Response> {
  const roots = directoryRoots();
  const host =
    request.headers.get("x-local-studio-origin-host") ?? request.headers.get("host") ?? "";
  if (!loopbackHost(host) && process.env.LOCAL_STUDIO_ENABLE_REMOTE_DIRECTORY_BROWSER !== "1") {
    return jsonError("Directory browsing is only available locally", 403);
  }
  const requested = search(request, "path");
  const directoryPath = path.resolve(requested || roots[0] || os.homedir());
  if (!roots.some((root) => within(directoryPath, root))) {
    return jsonError("Path is outside the allowed directories", 403);
  }
  try {
    if (!statSync(directoryPath).isDirectory()) return jsonError("Path is not a directory");
    const entries = (
      await Promise.all(
        (await readdir(directoryPath)).map(async (name): Promise<DirectoryEntry | null> => {
          const entryPath = path.join(directoryPath, name);
          try {
            return (await stat(entryPath)).isDirectory() ? { name, path: entryPath } : null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((entry): entry is DirectoryEntry => entry !== null);
    entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
    const parent = path.dirname(directoryPath);
    return Response.json({
      path: directoryPath,
      parent: parent === directoryPath ? null : parent,
      home: os.homedir(),
      entries,
    });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list directories"));
  }
}

export async function handleProjects(request: Request): Promise<Response> {
  try {
    if (request.method === "GET") return Response.json({ projects: listProjectsFromStore() });
    if (request.method === "DELETE") {
      const id = search(request, "id");
      if (!id) return jsonError("id is required");
      removeProjectFromStore(id);
      return Response.json({ ok: true });
    }
    const body = await jsonBody(request);
    if (body instanceof Response) return body;
    const value = (body as { path?: unknown })?.path;
    const projectPath = typeof value === "string" ? value.trim() : "";
    return projectPath
      ? Response.json({ project: addProjectToStore(projectPath) })
      : jsonError("path is required");
  } catch (error) {
    return jsonError(errorMessage(error, "Project operation failed"), 500);
  }
}
