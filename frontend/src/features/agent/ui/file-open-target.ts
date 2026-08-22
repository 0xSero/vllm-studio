type FileOpenTarget = { root: string; rel: string; kind: "file" | "directory" };

// Resolve a clicked reference into the root the panel should show and the path
// under it. References arrive the way assistants write them: `file://` URLs,
// `path:line:col`, `~/…`, `./…`, repo-relative, or absolute paths that point
// somewhere else entirely (a PDF on the Desktop while the session runs in a
// project). Absolute paths outside the session root resolve against their own
// parent directory rather than returning null — the panel adopts that directory
// as its root so the file actually opens.
export function resolveFileOpenTarget(
  requestPath: string,
  cwd: string | null,
): FileOpenTarget | null {
  const projectRoot = cwd ? cwd.replace(/\/+$/, "") : null;
  const raw = normalizeReference(requestPath, projectRoot);
  if (!raw) return null;
  const isDirectory = raw.endsWith("/");
  const clean = isDirectory ? raw.replace(/\/+$/, "") : raw;
  if (!clean) return null;

  if (projectRoot && (clean === projectRoot || clean.startsWith(`${projectRoot}/`))) {
    return {
      root: projectRoot,
      rel: clean === projectRoot ? "" : clean.slice(projectRoot.length + 1),
      kind: isDirectory ? "directory" : "file",
    };
  }
  if (clean.startsWith("/")) {
    if (isDirectory) return { root: clean, rel: "", kind: "directory" };
    const slash = clean.lastIndexOf("/");
    const parent = clean.slice(0, slash);
    const name = clean.slice(slash + 1);
    if (!name) return null;
    return { root: parent || "/", rel: name, kind: "file" };
  }
  if (!projectRoot) return null;
  const rel = clean.startsWith("./") ? clean.slice(2) : clean;
  if (!rel || rel.startsWith("../")) return null;
  return { root: projectRoot, rel, kind: isDirectory ? "directory" : "file" };
}

// Strip the decorations references arrive with (backticks, a `file://` scheme,
// a `:line:col` suffix) and expand `~`. The renderer has no `os.homedir()`, but
// the session cwd is an absolute path under the same home, so `/Users/<name>` /
// `/home/<name>` recovers it — enough to make `~/…` paths clickable.
function normalizeReference(requestPath: string, projectRoot: string | null): string | null {
  let raw = requestPath.trim();
  if (!raw) return null;
  if (/^file:\/\//i.test(raw)) {
    try {
      raw = decodeURIComponent(new URL(raw).pathname);
    } catch {
      return null;
    }
  }
  raw = raw.replace(/^`|`$/g, "").replace(/:\d+(?::\d+)?$/, "");
  if (!raw || raw.includes("\0")) return null;
  if (raw !== "~" && !raw.startsWith("~/")) return raw;
  const home = projectRoot?.match(/^(\/(?:Users|home)\/[^/]+)/)?.[1];
  if (!home) return raw;
  return raw === "~" ? `${home}/` : `${home}/${raw.slice(2)}`;
}
