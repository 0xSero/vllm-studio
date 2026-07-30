import type { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyAgentOnboarding } from "../../proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: RouteContext) {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  const { path } = await context.params;
  const upstreamPath = `/api/agent/onboarding/inference/${path
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  return proxyAgentOnboarding(request, upstreamPath, 4 * 1024 * 1024);
}

export const GET = handle;
export const POST = handle;
