import type { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyProvisioning } from "./proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return (await requireApiAccess(request)) ?? proxyProvisioning(request, "/api/provisioning");
}

export async function DELETE(request: NextRequest) {
  return (await requireApiAccess(request)) ?? proxyProvisioning(request, "/api/provisioning");
}
