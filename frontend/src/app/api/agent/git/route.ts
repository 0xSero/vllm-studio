import { NextRequest } from "next/server";
import { parseGitAction } from "@/lib/agent/contracts/git";
import { assertGitCwd, loadGitState, runGitAction } from "@/lib/agent/git/service";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { cwd, error } = assertGitCwd(request.nextUrl.searchParams.get("cwd"));
  if (error) return error;
  try {
    return Response.json(await loadGitState(cwd));
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const { cwd, error } = assertGitCwd(request.nextUrl.searchParams.get("cwd"));
  if (error) return error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = parseGitAction(body);
  if (!action.ok) return Response.json({ error: action.error }, { status: 400 });
  try {
    return Response.json(await runGitAction(cwd, action.value));
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 400 });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Git operation failed";
}
