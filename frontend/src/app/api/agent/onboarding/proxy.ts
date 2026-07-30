import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const proxyAgentOnboarding = (
  request: Request,
  upstreamPath?: string,
  bodyLimitBytes?: number,
) => {
  const token =
    process.env.LOCAL_STUDIO_AGENT_ONBOARDING_TOKEN?.trim() ||
    process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN?.trim();
  if (!token) {
    return Response.json({ error: "Agent onboarding API is not configured" }, { status: 503 });
  }
  return proxyToAgentRuntime(request, {
    authorization: `Bearer ${token}`,
    ...(upstreamPath ? { upstreamPath } : {}),
    ...(bodyLimitBytes ? { bodyLimitBytes } : {}),
  });
};
