import type { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyAgentOnboarding } from "./proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return (await requireApiAccess(request)) ?? proxyAgentOnboarding(request);
}

export async function PUT(request: NextRequest) {
  return (await requireApiAccess(request)) ?? proxyAgentOnboarding(request, undefined, 1024 * 1024);
}
