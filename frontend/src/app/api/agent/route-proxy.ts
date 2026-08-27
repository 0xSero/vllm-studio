import { type NextRequest } from "next/server";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export function runtimeProxy(request: NextRequest): Promise<Response> {
  return proxyToAgentRuntime(request);
}

export function authProxy(request: NextRequest): Promise<Response> | Response {
  return requireApiAccess(request) ?? proxyToAgentRuntime(request);
}
