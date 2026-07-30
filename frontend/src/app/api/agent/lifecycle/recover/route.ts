import type { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyAgentLifecycle } from "../proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return (await requireApiAccess(request)) ?? proxyAgentLifecycle(request);
}
