import {
  addProjectToStore,
  listProjectsFromStore,
  removeProjectFromStore,
  type ProjectEntry,
} from "../projects-store";
import { Schema } from "effect";
import { errorMessage, jsonError } from "./helpers";

const ProjectPathInputSchema = Schema.Struct({ path: Schema.String });

export async function handleProjectsList(): Promise<Response> {
  try {
    const projects = listProjectsFromStore();
    return Response.json({ projects });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read projects"), 500);
  }
}

export async function handleProjectAdd(request: Request): Promise<Response> {
  let body: typeof ProjectPathInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ProjectPathInputSchema)(await request.json());
  } catch {
    return jsonError("Invalid JSON body");
  }
  const directoryPath = body.path.trim();
  if (!directoryPath) {
    return jsonError("path is required");
  }
  try {
    const project: ProjectEntry = addProjectToStore(directoryPath);
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
    removeProjectFromStore(id);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to remove project"), 500);
  }
}
