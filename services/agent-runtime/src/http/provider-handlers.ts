import {
  cancelProviderLogin,
  getProviderLoginJob,
  listProviders,
  logoutProvider,
  respondProviderLogin,
  startProviderLogin,
} from "../provider-hub";
import { jsonError, jsonTask, readJsonBody } from "./helpers";

export async function handleProvidersList(): Promise<Response> {
  return jsonTask(listProviders, (providers) => ({ providers }), {
    fallback: "Failed to list providers.",
  });
}

export async function handleProviderLogin(request: Request, providerId: string): Promise<Response> {
  const body = await readJsonBody(request);
  const authType = body?.type === "api_key" ? "api_key" : body?.type === "oauth" ? "oauth" : null;
  if (!authType) return jsonError("Body must include type: \"oauth\" | \"api_key\".");
  return jsonTask(
    () => startProviderLogin(providerId, authType),
    (result) => ("error" in result ? jsonError(result.error, result.status) : result),
    { fallback: "Failed to start login." },
  );
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

export function handleProviderLoginCancel(jobId: string): Response {
  if (!cancelProviderLogin(jobId)) return jsonError(`Unknown login job '${jobId}'.`, 404);
  return Response.json({ ok: true });
}

export async function handleProviderLogout(providerId: string): Promise<Response> {
  return jsonTask(
    () => logoutProvider(providerId),
    (result) => ("error" in result ? jsonError(result.error, result.status) : result),
    { fallback: "Failed to sign out." },
  );
}
