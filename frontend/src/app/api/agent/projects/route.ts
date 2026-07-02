import { NextRequest, NextResponse } from "next/server";
import {
  addProjectToStore,
  listProjectsFromStore,
  removeProjectFromStore,
  type ProjectEntry,
} from "@local-studio/agent-runtime/projects-store";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projects = listProjectsFromStore();
    return NextResponse.json({ projects });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read projects"), 500);
  }
}

export async function POST(request: NextRequest) {
  let body: { path?: unknown };
  try {
    body = (await request.json()) as { path?: unknown };
  } catch {
    return jsonError("Invalid JSON body");
  }
  const directoryPath = typeof body.path === "string" ? body.path.trim() : "";
  if (!directoryPath) {
    return jsonError("path is required");
  }
  try {
    const project: ProjectEntry = addProjectToStore(directoryPath);
    return NextResponse.json({ project });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to add project"));
  }
}

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return jsonError("id is required");
  }
  try {
    removeProjectFromStore(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to remove project"), 500);
  }
}
