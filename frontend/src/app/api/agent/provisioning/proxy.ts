import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const proxyProvisioning = (
  request: Request,
  upstreamPath: string,
  bodyLimitBytes?: number,
) => {
  const token =
    process.env.LOCAL_STUDIO_PROVISIONING_TOKEN?.trim() ||
    process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN?.trim();
  if (!token) {
    return Response.json(
      { error: "Provisioning coordinator API is not configured" },
      { status: 503 },
    );
  }
  return proxyToAgentRuntime(request, {
    authorization: `Bearer ${token}`,
    upstreamPath,
    ...(bodyLimitBytes ? { bodyLimitBytes } : {}),
  });
};
