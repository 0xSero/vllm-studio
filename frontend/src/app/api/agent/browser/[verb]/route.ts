import { NextRequest } from "next/server";
import { proxyToController } from "@/app/api/agent/proxy-to-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return proxyToController(request);
}
