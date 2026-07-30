import type { NextRequest } from "next/server";
import os from "node:os";
import { readJsonRequestWithinLimit } from "@shared/agent/agent-turn-body";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyAgentLifecycle } from "../proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inferenceEndpoint = () => {
  const raw = process.env.LOCAL_STUDIO_FRONTEND_BASE?.trim();
  if (!raw) throw new Error("Frontend base URL is not configured");
  const endpoint = new URL(raw);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    (endpoint.protocol === "http:" && !loopback) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Frontend base URL is invalid");
  }
  return `${endpoint.toString().replace(/\/+$/, "")}/api/agent/onboarding/inference/v1`;
};

export async function PUT(request: NextRequest) {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  const decoded = await readJsonRequestWithinLimit(request, 1024 * 1024);
  if (!decoded.ok) return Response.json({ error: decoded.error }, { status: decoded.status });
  const body = decoded.value;
  const profile =
    body && typeof body === "object" && "profile" in body ? Reflect.get(body, "profile") : body;
  let endpoint: string;
  try {
    endpoint = inferenceEndpoint();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Frontend base URL is invalid" },
      { status: 503 },
    );
  }
  const upstream = new Request(request.url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profile,
      locality: {
        machineId: "local-host",
        accessProfileId: "local-loopback",
        executionHome: os.homedir(),
        inferenceEndpoint: endpoint,
        credentialRef: "keyring:runtime:inference",
      },
    }),
  });
  return proxyAgentLifecycle(upstream, 1024 * 1024);
}
