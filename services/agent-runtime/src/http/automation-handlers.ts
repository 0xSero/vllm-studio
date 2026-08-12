import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  patchAutomation,
} from "../automations-store";
import { runAutomationNow } from "../automation-scheduler";
import { clearGoal, readGoal, writeGoal, type GoalStatus } from "../goals-store";
import { GOAL_STATUSES } from "../../../../shared/agent/session-goal";
import { jsonError, jsonTask, readJsonBody } from "./helpers";

export async function handleAutomationsList(): Promise<Response> {
  return jsonTask(listAutomations, (automations) => ({ automations }), {
    fallback: "Failed to list automations.",
  });
}

export async function handleAutomationCreate(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const name = typeof body?.name === "string" ? body.name : "";
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const modelId = typeof body?.modelId === "string" ? body.modelId : "";
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  if (!prompt.trim() || !modelId.trim()) {
    return jsonError("Body must include prompt and modelId.");
  }
  return jsonTask(
    () => createAutomation({ name, prompt, modelId, cwd, schedule: body?.schedule }),
    (automation) => ({ automation }),
    { fallback: "Failed to create automation." },
  );
}

export async function handleAutomationPatch(request: Request, id: string): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  return jsonTask(
    () =>
      patchAutomation(id, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.prompt === "string" ? { prompt: body.prompt } : {}),
        ...(typeof body.modelId === "string" ? { modelId: body.modelId } : {}),
        ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
        ...(body.status === "active" || body.status === "paused" ? { status: body.status } : {}),
        ...(typeof body.unread === "boolean" ? { unread: body.unread } : {}),
        ...(body.schedule !== undefined ? { schedule: body.schedule } : {}),
      }),
    (automation) => automation ? { automation } : jsonError(`Unknown automation '${id}'.`, 404),
    { fallback: "Failed to update automation." },
  );
}

export async function handleAutomationDelete(id: string): Promise<Response> {
  return jsonTask(
    () => deleteAutomation(id),
    (removed) => removed ? { ok: true } : jsonError(`Unknown automation '${id}'.`, 404),
    { fallback: "Failed to delete automation." },
  );
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
  return jsonTask(() => readGoal(piSessionId), (goal) => ({ goal }), {
    fallback: "Failed to read goal.",
  });
}

export async function handleGoalPut(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  return jsonTask(
    () =>
      writeGoal(piSessionId, {
        ...(typeof body.objective === "string" ? { objective: body.objective } : {}),
        ...(GOAL_STATUSES.includes(body.status as GoalStatus)
          ? { status: body.status as GoalStatus }
          : {}),
        ...(typeof body.turnBudget === "number" || body.turnBudget === null
          ? { turnBudget: body.turnBudget as number | null }
          : {}),
        ...(body.resetTurns === true ? { turnsUsed: 0 } : {}),
      }),
    (goal) => ({ goal: goal.objective ? goal : null }),
    { fallback: "Failed to update goal." },
  );
}

export async function handleGoalDelete(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  return jsonTask(() => clearGoal(piSessionId), () => ({ ok: true }), {
    fallback: "Failed to clear goal.",
  });
}
