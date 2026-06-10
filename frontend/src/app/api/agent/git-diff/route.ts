import { NextRequest } from "next/server";
import { assertGitCwd, loadGitState, runGitAction } from "@/features/agent/git";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { cwd, error } = assertGitCwd(request.nextUrl.searchParams.get("cwd"));
  if (error) return error;
  try {
    return Response.json(await loadGitState(cwd));
  } catch (err) {
    return jsonError(errorMessage(err, "Git operation failed"));
  }
}

export async function POST(request: NextRequest) {
  const { cwd, error } = assertGitCwd(request.nextUrl.searchParams.get("cwd"));
  if (error) return error;
  try {
    return Response.json(await runGitAction(cwd, { action: "init" }));
  } catch (err) {
    return jsonError(errorMessage(err, "Git operation failed"));
  }
}
