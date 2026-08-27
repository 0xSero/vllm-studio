import { Option, Schema } from "effect";
import {
  findSubagent,
  listSubagents,
  runSubagent,
  spawnSubagent,
  stopSubagent,
  subagentIsActive,
  subagentReport,
  type SubagentRun,
} from "../subagents";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

const SubagentRunBodySchema = Schema.Struct({
  parentPiSessionId: Schema.String,
  name: Schema.optional(Schema.String),
  task: Schema.String,
  modelId: Schema.optional(Schema.String),
  wait: Schema.optional(Schema.Boolean),
});
const SubagentStopBodySchema = Schema.Struct({ piSessionId: Schema.String });

const parentFromQuery = (request: Request): string =>
  new URL(request.url).searchParams.get("piSessionId")?.trim() ?? "";

function runSummary(run: SubagentRun) {
  return {
    id: run.id,
    name: run.name,
    task: run.task,
    status: run.status,
    active: run.status === "running" && subagentIsActive(run),
    piSessionId: run.piSessionId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error ?? null,
  };
}

function runView(run: SubagentRun) {
  const report = subagentReport(run);
  return { ...runSummary(run), error: run.error ?? report.error, report: report.text };
}

export async function handleSubagentsList(request: Request): Promise<Response> {
  const parent = parentFromQuery(request);
  if (!parent) return jsonError("piSessionId is required.");
  return Response.json({ subagents: listSubagents(parent).map(runSummary) });
}

export async function handleSubagentGet(request: Request, runId: string): Promise<Response> {
  const parent = parentFromQuery(request);
  if (!parent) return jsonError("piSessionId is required.");
  const run = findSubagent(parent, runId);
  if (!run) return jsonError(`No subagent "${runId}" was spawned by this session.`, 404);
  return Response.json({ ok: true, subagent: runView(run) });
}

export async function handleSubagentStop(request: Request, runId: string): Promise<Response> {
  const rawBody = await readJsonBody(request);
  const body = Option.getOrNull(Schema.decodeUnknownOption(SubagentStopBodySchema)(rawBody));
  const parent = body?.piSessionId.trim() ?? "";
  if (!parent) return jsonError("Body must include piSessionId.");
  try {
    return Response.json({ ok: true, subagent: runView(await stopSubagent(parent, runId)) });
  } catch (error) {
    return jsonError(errorMessage(error, "Could not stop the subagent."), 404);
  }
}

export async function handleSubagentRun(request: Request): Promise<Response> {
  const rawBody = await readJsonBody(request);
  const body = Option.getOrNull(Schema.decodeUnknownOption(SubagentRunBodySchema)(rawBody));
  if (!body?.parentPiSessionId.trim() || !body.task.trim()) {
    return jsonError("Body must include parentPiSessionId and task.");
  }
  const input: Parameters<typeof runSubagent>[0] = {
    parentPiSessionId: body.parentPiSessionId.trim(),
    name: body.name ?? "",
    task: body.task,
  };
  if (body.modelId !== undefined) input.modelId = body.modelId;
  try {
    if (body.wait === false) {
      const { run, completion } = await spawnSubagent(input);
      completion.catch(() => undefined);
      return Response.json({
        ok: true,
        runId: run.id,
        name: run.name,
        piSessionId: run.piSessionId,
      });
    }
    const result = await runSubagent(input);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(errorMessage(error, "Subagent run failed."), 500);
  }
}
