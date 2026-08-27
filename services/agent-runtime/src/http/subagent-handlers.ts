import { listSubagents, runSubagent } from "../subagents";
import { jsonError, readJsonBody } from "./helpers";

export async function handleSubagentsList(request: Request): Promise<Response> {
  const parent = new URL(request.url).searchParams.get("piSessionId")?.trim();
  if (!parent) return jsonError("piSessionId is required.");
  return Response.json({ subagents: listSubagents(parent) });
}

export async function handleSubagentRun(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const parentPiSessionId = typeof body?.parentPiSessionId === "string" ? body.parentPiSessionId : "";
  const name = typeof body?.name === "string" ? body.name : "";
  const task = typeof body?.task === "string" ? body.task : "";
  if (!parentPiSessionId || !task.trim()) {
    return jsonError("Body must include parentPiSessionId and task.");
  }
  const result = await runSubagent({
    parentPiSessionId,
    name,
    task,
    ...(typeof body?.modelId === "string" ? { modelId: body.modelId } : {}),
  });
  return Response.json({ ok: true, ...result });
}
