import { clearGoal, readGoal, writeGoal, type GoalStatus } from "../goals-store";
import { GOAL_STATUSES } from "../../../../shared/agent/session-goal";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

function goalSessionId(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("piSessionId")?.trim();
  return id || null;
}

export async function handleGoalGet(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  try {
    return Response.json({ goal: await readGoal(piSessionId) });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to read goal."), 500);
  }
}

export async function handleGoalPut(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  try {
    const goal = await writeGoal(piSessionId, {
      ...(typeof body.objective === "string" ? { objective: body.objective } : {}),
      ...(GOAL_STATUSES.includes(body.status as GoalStatus)
        ? { status: body.status as GoalStatus }
        : {}),
      ...(typeof body.turnBudget === "number" || body.turnBudget === null
        ? { turnBudget: body.turnBudget as number | null }
        : {}),
      ...(body.resetTurns === true ? { turnsUsed: 0 } : {}),
    });
    return Response.json({ goal: goal.objective ? goal : null });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update goal."), 500);
  }
}

export async function handleGoalDelete(request: Request): Promise<Response> {
  const piSessionId = goalSessionId(request);
  if (!piSessionId) return jsonError("piSessionId is required.");
  try {
    await clearGoal(piSessionId);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to clear goal."), 500);
  }
}
