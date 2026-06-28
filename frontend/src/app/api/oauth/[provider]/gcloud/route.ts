import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { NextRequest } from "next/server";
import { enableExternalOAuthCredentials } from "@/features/agent/oauth/oauth-store";
import { getOAuthProvider } from "@/features/agent/oauth/oauth-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

const GCLOUD_CANDIDATES = [
  "/opt/homebrew/bin/gcloud",
  "/usr/local/bin/gcloud",
  "/usr/bin/gcloud",
  "gcloud",
];

async function resolveGcloud(): Promise<string | null> {
  for (const candidate of GCLOUD_CANDIDATES) {
    if (candidate === "gcloud") return candidate;
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const { provider } = await context.params;
  const definition = getOAuthProvider(provider);
  if (!definition) {
    return Response.json({ error: "Unknown OAuth provider." }, { status: 404 });
  }
  if (provider !== "google") {
    return Response.json({ error: "gcloud login is only available for Google." }, { status: 400 });
  }
  const gcloud = await resolveGcloud();
  if (!gcloud) {
    return Response.json({ error: "Google Cloud SDK is not installed." }, { status: 400 });
  }
  await enableExternalOAuthCredentials(provider);
  const child = spawn(
    gcloud,
    ["auth", "application-default", "login", `--scopes=${definition.scopes.join(",")}`, "--quiet"],
    { detached: true, stdio: "ignore" },
  );
  child.on("error", () => {});
  child.unref();
  return Response.json({ started: true });
}
