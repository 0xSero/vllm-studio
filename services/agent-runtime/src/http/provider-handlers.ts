//
// HTTP surface for the provider hub. All routes are proxied through the Next
// server (`/api/agent/providers*`) like the other runtime handlers, so the
// hub's single ModelRuntime instance serves both sign-in and sessions.
//

import {
  cancelProviderLogin,
  getProviderLoginJob,
  listProviders,
  logoutProvider,
  respondProviderLogin,
  startProviderLogin,
} from "../provider-hub";
import { refreshPiModels, type PiControllerModelsRequest } from "../pi-runtime-models";
import { errorMessage, guarded, jsonError, readJsonBody } from "./helpers";

export function handleProvidersList(): Promise<Response> {
  return guarded("Failed to list providers.", async () =>
    Response.json({ providers: await listProviders() }),
  );
}

export async function handleProviderLogin(request: Request, providerId: string): Promise<Response> {
  const body = await readJsonBody(request);
  const authType = body?.type === "api_key" ? "api_key" : body?.type === "oauth" ? "oauth" : null;
  if (!authType) return jsonError('Body must include type: "oauth" | "api_key".');
  return guarded("Failed to start login.", async () => {
    const result = await startProviderLogin(providerId, authType);
    return "error" in result ? jsonError(result.error, result.status) : Response.json(result);
  });
}

export function handleProviderLoginJob(request: Request, jobId: string): Response {
  const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
  const job = getProviderLoginJob(jobId, Number.isFinite(after) ? after : 0);
  if (!job) return jsonError(`Unknown login job '${jobId}'.`, 404);
  return Response.json(job);
}

export async function handleProviderLoginRespond(
  request: Request,
  jobId: string,
): Promise<Response> {
  const body = await readJsonBody(request);
  const promptId = typeof body?.promptId === "number" ? body.promptId : null;
  const value = typeof body?.value === "string" ? body.value : null;
  if (promptId === null || value === null) {
    return jsonError("Body must include promptId (number) and value (string).");
  }
  if (!respondProviderLogin(jobId, promptId, value)) {
    return jsonError("No matching pending prompt for this job.", 409);
  }
  return Response.json({ ok: true });
}

export function handleProviderLoginCancel(_request: Request, jobId: string): Response {
  if (!cancelProviderLogin(jobId)) return jsonError(`Unknown login job '${jobId}'.`, 404);
  return Response.json({ ok: true });
}

export function handleProviderLogout(_request: Request, providerId: string): Promise<Response> {
  return guarded("Failed to sign out.", async () => {
    const result = await logoutProvider(providerId);
    return "error" in result ? jsonError(result.error, result.status) : Response.json(result);
  });
}

// ─── Models ───────────────────────────────────────────────────────────────

function parseControllers(value: unknown): PiControllerModelsRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.url !== "string" || !record.url.trim()) return [];
    return [
      {
        url: record.url,
        ...(typeof record.apiKey === "string" ? { apiKey: record.apiKey } : {}),
        ...(typeof record.name === "string" ? { name: record.name } : {}),
      },
    ];
  });
}

export async function handleAgentModels(request?: Request): Promise<Response> {
  try {
    const body = request
      ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      : {};
    const { models } = await refreshPiModels(parseControllers(body.controllers));
    return Response.json({ provider: "local-studio", models });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to load /v1/models"), 502);
  }
}
