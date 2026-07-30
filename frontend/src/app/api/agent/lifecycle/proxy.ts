import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const proxyAgentLifecycle = (request: Request, bodyLimitBytes?: number) => {
  const token = process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN?.trim();
  if (!token) {
    return Response.json({ error: "Agent lifecycle API is not configured" }, { status: 503 });
  }
  return proxyToAgentRuntime(request, {
    authorization: `Bearer ${token}`,
    ...(bodyLimitBytes ? { bodyLimitBytes } : {}),
  });
};
