import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  patchAutomation,
} from "../automations-store";
import { runAutomationNow } from "../automation-scheduler";
import { clearGoal, readGoal, writeGoal } from "../goals-store";
import { Option, Schema } from "effect";
import { GoalStatusSchema } from "../../../../shared/agent/session-goal";
import { AutomationScheduleSchema } from "../../../../shared/agent/automation";
import { jsonError, readJsonBody } from "./helpers";

export async function handleAutomationsList(): Promise<Response> {
  return Response.json({ automations: await listAutomations() });
}

export async function handleAutomationCreate(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(body?.name)) ?? "";
  const prompt = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(body?.prompt)) ?? "";
  const modelId = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(body?.modelId)) ?? "";
  const cwd = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(body?.cwd)) ?? "";
  const schedule = Option.getOrElse(
    Schema.decodeUnknownOption(AutomationScheduleSchema)(body?.schedule),
    () => ({ kind: "daily", time: "08:00" }),
  );
  if (!prompt.trim() || !modelId.trim()) {
    return jsonError("Body must include prompt and modelId.");
  }
  const automation = await createAutomation({ name, prompt, modelId, cwd, schedule });
  return Response.json({ automation });
}

export async function handleAutomationPatch(request: Request, id: string): Promise<Response> {
  const rawBody = await readJsonBody(request);
  if (!rawBody) return jsonError("Body must be a JSON object.");
  const name = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(rawBody.name));
  const prompt = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(rawBody.prompt));
  const modelId = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(rawBody.modelId));
  const cwd = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(rawBody.cwd));
  const status = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.Literals(["active", "paused"]))(rawBody.status),
  );
  const unread = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Boolean)(rawBody.unread));
  let patch: Parameters<typeof patchAutomation>[1] = {};
  if (name !== undefined) patch = { ...patch, name };
  if (prompt !== undefined) patch = { ...patch, prompt };
  if (modelId !== undefined) patch = { ...patch, modelId };
  if (cwd !== undefined) patch = { ...patch, cwd };
  if (status !== undefined) patch = { ...patch, status };
  if (unread !== undefined) patch = { ...patch, unread };
  if ("schedule" in rawBody) {
    const schedule = Option.getOrElse(
      Schema.decodeUnknownOption(AutomationScheduleSchema)(rawBody.schedule),
      () => ({ kind: "daily", time: "08:00" }),
    );
    patch = { ...patch, schedule };
  }
  const automation = await patchAutomation(id, patch);
  if (!automation) return jsonError(`Unknown automation '${id}'.`, 404);
  return Response.json({ automation });
}

export async function handleAutomationDelete(id: string): Promise<Response> {
  const removed = await deleteAutomation(id);
  if (!removed) return jsonError(`Unknown automation '${id}'.`, 404);
  return Response.json({ ok: true });
}

export async function handleAutomationRun(id: string): Promise<Response> {
  const automation = await getAutomation(id);
  if (!automation) return jsonError(`Unknown automation '${id}'.`, 404);
  const completed = await runAutomationNow(id);
  return Response.json({ ok: true, started: completed !== null });
}


function goalSessionId(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("piSessionId")?.trim();
  return id || null;
}

export async function handleGoalGet(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  return Response.json({ goal: await readGoal(piSessionId) });
}

export async function handleGoalPut(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  const rawBody = await readJsonBody(request);
  if (!rawBody) return jsonError("Body must be a JSON object.");
  const objective = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.String)(rawBody.objective),
  );
  const status = Option.getOrUndefined(Schema.decodeUnknownOption(GoalStatusSchema)(rawBody.status));
  const turnBudget = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.NullOr(Schema.Number))(rawBody.turnBudget),
  );
  const resetTurns = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.Boolean)(rawBody.resetTurns),
  );
  let patch: Parameters<typeof writeGoal>[1] = {};
  if (objective !== undefined) patch = { ...patch, objective };
  if (status !== undefined) patch = { ...patch, status };
  if (turnBudget !== undefined) patch = { ...patch, turnBudget };
  if (resetTurns === true) patch = { ...patch, turnsUsed: 0 };
  const goal = await writeGoal(piSessionId, patch);
  return Response.json({ goal: goal.objective ? goal : null });
}

export async function handleGoalDelete(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  await clearGoal(piSessionId);
  return Response.json({ ok: true });
}
