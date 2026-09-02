import { Schema } from "effect";
import { ProjectAddSchema } from "../../../../shared/agent/projects";
import {
  addProjectToStore,
  initializeProjectsStore,
  listProjectsFromStore,
  removeProjectFromStore,
  type ProjectEntry,
} from "../projects-store";
import { errorMessage, jsonError } from "./helpers";

export async function handleProjectsList(): Promise<Response> {
  try {
    await initializeProjectsStore();
    const projects = listProjectsFromStore();
    return Response.json({ projects });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read projects"), 500);
  }
}

export async function handleProjectAdd(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  let directoryPath: string;
  try {
    directoryPath = Schema.decodeUnknownSync(ProjectAddSchema)(body).path.trim();
  } catch {
    return jsonError("path is required");
  }
  if (!directoryPath) {
    return jsonError("path is required");
  }
  try {
    const project: ProjectEntry = await addProjectToStore(directoryPath);
    return Response.json({ project });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to add project"));
  }
}

export async function handleProjectRemove(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return jsonError("id is required");
  }
  try {
    await removeProjectFromStore(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to remove project"), 500);
  }
}
