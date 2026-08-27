import { Option, Schema } from "effect";
import {
  cancelProviderLogin,
  getProviderLoginJob,
  listProviders,
  logoutProvider,
  respondProviderLogin,
  startProviderLogin,
} from "../provider-hub";
import { jsonError, readJsonBody } from "./helpers";

const ProviderResponseSchema = Schema.Struct({
  promptId: Schema.optional(Schema.Number),
  value: Schema.optional(Schema.String),
});

type ParsedBody = typeof ProviderResponseSchema.Type;
const EMPTY_PROVIDER_RESPONSE: ParsedBody = {};

export async function handleProvidersList(): Promise<Response> {
  return Response.json({ providers: await listProviders() });
}

export async function handleProviderLogin(request: Request, providerId: string): Promise<Response> {
  const body = await readJsonBody(request);
  const authType = body?.type === "api_key" ? "api_key" : body?.type === "oauth" ? "oauth" : null;
  if (!authType) return jsonError("Body must include type: \"oauth\" | \"api_key\".");
  const result = await startProviderLogin(providerId, authType);
  if ("error" in result) return jsonError(result.error, result.status);
  return Response.json(result);
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
  const body = Option.getOrElse(
    Schema.decodeUnknownOption(ProviderResponseSchema)(await readJsonBody(request)),
    () => EMPTY_PROVIDER_RESPONSE,
  );
  const promptId = body.promptId ?? null;
  const value = body.value ?? null;
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
  const result = await logoutProvider(providerId);
  if ("error" in result) return jsonError(result.error, result.status);
  return Response.json(result);
}
