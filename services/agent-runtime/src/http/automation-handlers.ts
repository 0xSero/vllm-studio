import { Option, Schema } from "effect";
import { AutomationScheduleSchema } from "../../../../shared/agent/automation";
import { GoalStatusSchema } from "../../../../shared/agent/session-goal";
import type { UnparsedValue } from "../../../../shared/agent/guards";
import { runAutomationNow } from "../automation-scheduler";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  patchAutomation,
} from "../automations-store";
import { clearGoal, readGoal, writeGoal } from "../goals-store";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);

export async function handleAutomationsList(): Promise<Response> {
  try {
    return Response.json({ automations: await listAutomations() });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list automations."), 500);
  }
}

function targetSessionPatch(value: UnparsedValue): { targetSessionId: string | null } | null {
  if (value === null) return { targetSessionId: null };
  const decoded = Option.getOrUndefined(decodeString(value));
  return decoded === undefined ? null : { targetSessionId: decoded.trim() || null };
}

export async function handleAutomationCreate(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = Option.getOrUndefined(decodeString(body?.name)) ?? "";
  const prompt = Option.getOrUndefined(decodeString(body?.prompt)) ?? "";
  const modelId = Option.getOrUndefined(decodeString(body?.modelId)) ?? "";
  const cwd = Option.getOrUndefined(decodeString(body?.cwd)) ?? "";
  const schedule = Option.getOrElse(
    Schema.decodeUnknownOption(AutomationScheduleSchema)(body?.schedule),
    () => ({ kind: "daily", time: "08:00" }),
  );
  if (!prompt.trim() || !modelId.trim()) {
    return jsonError("Body must include prompt and modelId.");
  }
  try {
    const input: Parameters<typeof createAutomation>[0] = { name, prompt, modelId, cwd, schedule };
    const targetSession = targetSessionPatch(body?.targetSessionId);
    if (targetSession) input.targetSessionId = targetSession.targetSessionId;
    const automation = await createAutomation(input);
    return Response.json({ automation });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to create automation."), 500);
  }
}

export async function handleAutomationPatch(request: Request, id: string): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  const name = Option.getOrUndefined(decodeString(body.name));
  const prompt = Option.getOrUndefined(decodeString(body.prompt));
  const modelId = Option.getOrUndefined(decodeString(body.modelId));
  const cwd = Option.getOrUndefined(decodeString(body.cwd));
  const status = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.Literals(["active", "paused"]))(body.status),
  );
  const unread = Option.getOrUndefined(decodeBoolean(body.unread));
  let patch: Parameters<typeof patchAutomation>[1] = {};
  if (name !== undefined) patch = { ...patch, name };
  if (prompt !== undefined) patch = { ...patch, prompt };
  if (modelId !== undefined) patch = { ...patch, modelId };
  if (cwd !== undefined) patch = { ...patch, cwd };
  if (status !== undefined) patch = { ...patch, status };
  if (unread !== undefined) patch = { ...patch, unread };
  if ("schedule" in body) {
    const schedule = Option.getOrElse(
      Schema.decodeUnknownOption(AutomationScheduleSchema)(body.schedule),
      () => ({ kind: "daily", time: "08:00" }),
    );
    patch = { ...patch, schedule };
  }
  const targetSession = targetSessionPatch(body.targetSessionId);
  if (targetSession) patch = { ...patch, ...targetSession };
  if (body.clearRuns === true) {
    patch = { ...patch, runs: [], lastRun: null, unread: false };
  }
  try {
    const automation = await patchAutomation(id, patch);
    if (!automation) return jsonError(`Unknown automation '${id}'.`, 404);
    return Response.json({ automation });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update automation."), 500);
  }
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
  return Response.json({ ok: true, started: completed !== null, automation: completed });
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
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  const objective = Option.getOrUndefined(decodeString(body.objective));
  const status = Option.getOrUndefined(Schema.decodeUnknownOption(GoalStatusSchema)(body.status));
  const turnBudget = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.NullOr(Schema.Number))(body.turnBudget),
  );
  const resetTurns = Option.getOrUndefined(decodeBoolean(body.resetTurns));
  let patch: Parameters<typeof writeGoal>[1] = {};
  if (objective !== undefined) patch = { ...patch, objective };
  if (status !== undefined) patch = { ...patch, status };
  if (turnBudget !== undefined) patch = { ...patch, turnBudget };
  if (resetTurns === true) patch = { ...patch, resetProgress: true };
  try {
    const goal = await writeGoal(piSessionId, patch);
    return Response.json({ goal: goal.objective ? goal : null });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update goal."), 500);
  }
}

export async function handleGoalDelete(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  await clearGoal(piSessionId);
  return Response.json({ ok: true });
}
