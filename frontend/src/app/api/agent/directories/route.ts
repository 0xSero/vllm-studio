import { NextRequest } from "next/server";
import os from "node:os";
import path from "node:path";
import { readdir, stat } from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DirectoryEntry = {
  name: string;
  path: string;
};

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

function isLoopbackHost(host: string | null): boolean {
  const value = host ?? "";
  const hostname = value.startsWith("[")
    ? value.slice(1, value.indexOf("]"))
    : value.split(":")[0]?.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function configuredRoots(): string[] {
  const raw = process.env.VLLM_STUDIO_DIRECTORY_BROWSER_ROOTS;
  if (!raw) return [path.resolve(os.homedir())];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function resolveAllowedPath(input: string | null, roots: string[]): string | null {
  const fallbackRoot = roots[0] ?? path.resolve(os.homedir());
  const candidate = path.resolve(input?.trim() || fallbackRoot);
  return roots.some((root) => isWithinRoot(candidate, root)) ? candidate : null;
}

export async function GET(request: NextRequest) {
  const roots = configuredRoots();
  const remoteBrowserEnabled = process.env.VLLM_STUDIO_ENABLE_REMOTE_DIRECTORY_BROWSER === "1";
  if (!isLoopbackHost(request.headers.get("host")) && !(remoteBrowserEnabled && roots.length > 0)) {
    return Response.json(
      { error: "Directory browsing is only available locally" },
      { status: 403 },
    );
  }

  const directoryPath = resolveAllowedPath(request.nextUrl.searchParams.get("path"), roots);
  if (!directoryPath) {
    return Response.json({ error: "Path is outside the allowed directories" }, { status: 403 });
  }

  if (!(await isDirectory(directoryPath))) {
    return Response.json({ error: "Path is not a directory" }, { status: 400 });
  }

  try {
    const names = await readdir(directoryPath);
    const entries: DirectoryEntry[] = [];

    await Promise.all(
      names.map(async (name) => {
        if (name === "." || name === "..") return;
        const entryPath = path.join(directoryPath, name);
        if (!(await isDirectory(entryPath))) return;
        entries.push({ name, path: entryPath });
      }),
    );

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
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list directories" },
      { status: 400 },
    );
  }
}
