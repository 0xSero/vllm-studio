import { NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyToHarness } from "@/app/api/harness/proxy-to-harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const { path } = await params;
  return proxyToHarness(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const { path } = await params;
  return proxyToHarness(request, path);
}
