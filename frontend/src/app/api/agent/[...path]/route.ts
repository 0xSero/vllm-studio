import { NextRequest } from "next/server";
import path from "node:path";
import { matchAgentOperation, type AgentMethod } from "@shared/agent/operations";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { assertWorkspaceRoot } from "@local-studio/agent-runtime/workspace-files";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function validateWorkspaceCwd(request: NextRequest, route: string): Promise<Response | null> {
  if (route !== "terminal/pty/open") return null;
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const cwd = (body as { cwd?: unknown })?.cwd;
  if (cwd === undefined || cwd === null || cwd === "") return null;
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    return Response.json({ error: "cwd must be an absolute path" }, { status: 400 });
  }
  try {
    assertWorkspaceRoot(path.resolve(cwd));
    return null;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "cwd is not an allowed workspace" },
      { status: 403 },
    );
  }
}

async function handle(request: NextRequest): Promise<Response> {
  const path = request.nextUrl.pathname.replace(/^\/api\/agent\/?/, "");
  const operation = matchAgentOperation(path);
  if (!operation) return Response.json({ error: "Not found" }, { status: 404 });
  const [, methods, policy = {}] = operation;
  const method = request.method as AgentMethod;
  if (!methods.includes(method)) {
    return new Response(null, { status: 405, headers: { allow: methods.join(", ") } });
  }
  if (policy.authenticated) {
    const denied = requireApiAccess(request);
    if (denied) return denied;
  }
  if (
    policy.crossSiteError &&
    request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site"
  ) {
    return Response.json({ error: policy.crossSiteError }, { status: 403 });
  }
  if (policy.validateWorkspaceCwd) {
    const invalid = await validateWorkspaceCwd(request, path);
    if (invalid) return invalid;
  }
  return proxyToAgentRuntime(request, { bodyLimitBytes: policy.bodyLimit });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
