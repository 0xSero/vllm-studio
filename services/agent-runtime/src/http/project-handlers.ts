//
// HTTP surface for the projects list (the directories pinned in the sidebar).
// Moved verbatim from the Next route handlers so a remote runtime's project
// list is the one the UI shows.
//

import {
  addProjectToStore,
  listProjectsFromStore,
  removeProjectFromStore,
  type ProjectEntry,
} from "../projects-store";
import { guarded, jsonError } from "./helpers";

export function handleProjectsList(): Promise<Response> {
  return guarded("Failed to read projects", async () =>
    Response.json({ projects: listProjectsFromStore() }),
  );
}

export async function handleProjectAdd(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  if (!body) return jsonError("Invalid JSON body");
  const directoryPath = typeof body.path === "string" ? body.path.trim() : "";
  if (!directoryPath) return jsonError("path is required");
  return guarded(
    "Failed to add project",
    async () => Response.json({ project: addProjectToStore(directoryPath) satisfies ProjectEntry }),
    400,
  );
}

export async function handleProjectRemove(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return jsonError("id is required");
  return guarded("Failed to remove project", async () => {
    removeProjectFromStore(id);
    return Response.json({ ok: true });
  });
}
