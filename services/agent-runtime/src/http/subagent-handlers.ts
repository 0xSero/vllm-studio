import { Option, Schema } from "effect";
import { listSubagents, runSubagent } from "../subagents";
import { jsonError, readJsonBody } from "./helpers";

export async function handleSubagentsList(request: Request): Promise<Response> {
  const parent = new URL(request.url).searchParams.get("piSessionId")?.trim();
  if (!parent) return jsonError("piSessionId is required.");
  return Response.json({ subagents: listSubagents(parent) });
}

export async function handleSubagentRun(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const parentPiSessionId = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.String)(body?.parentPiSessionId),
  ) ?? "";
  const name = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(body?.name)) ?? "";
  const task = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(body?.task)) ?? "";
  const modelId = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.String)(body?.modelId),
  );
  if (!parentPiSessionId || !task.trim()) {
    return jsonError("Body must include parentPiSessionId and task.");
  }
  const input: Parameters<typeof runSubagent>[0] = { parentPiSessionId, name, task };
  if (modelId !== undefined) input.modelId = modelId;
  const result = await runSubagent(input);
  return Response.json({ ok: true, ...result });
}
