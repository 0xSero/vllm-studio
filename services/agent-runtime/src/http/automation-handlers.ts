import { Schema } from "effect";
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  patchAutomation,
} from "../automations-store";
import { startAutomationRun } from "../automation-scheduler";
import { AutomationTargetSchema, type AutomationTarget } from "../../../../shared/agent/automation";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

const decodeTarget = Schema.decodeUnknownSync(AutomationTargetSchema);

function readTarget(value: unknown): AutomationTarget | Response | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeTarget(value);
  } catch {
    return jsonError(
      'target must be {"kind":"global"} or {"kind":"thread","threadId":string,"piSessionId":string|null}.',
    );
  }
}

export async function handleAutomationsList(): Promise<Response> {
  try {
    return Response.json({ automations: await listAutomations() });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to list automations."), 500);
  }
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
  const target = readTarget(body?.target);
  if (target instanceof Response) return target;
  try {
    const automation = await createAutomation({
      name,
      prompt,
      modelId,
      cwd,
      schedule: body?.schedule,
      ...(target ? { target } : {}),
    });
    return Response.json({ automation });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to create automation."), 500);
  }
}

export async function handleAutomationPatch(request: Request, id: string): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return jsonError("Body must be a JSON object.");
  const target = readTarget(body.target);
  if (target instanceof Response) return target;
  try {
    const automation = await patchAutomation(id, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.prompt === "string" ? { prompt: body.prompt } : {}),
      ...(typeof body.modelId === "string" ? { modelId: body.modelId } : {}),
      ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
      ...(target ? { target } : {}),
      ...(body.status === "active" || body.status === "paused" ? { status: body.status } : {}),
      ...(typeof body.unread === "boolean" ? { unread: body.unread } : {}),
      ...(body.schedule !== undefined ? { schedule: body.schedule } : {}),
    });
    if (!automation) return jsonError(`Unknown automation '${id}'.`, 404);
    return Response.json({ automation });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to update automation."), 500);
  }
}

export async function handleAutomationDelete(id: string): Promise<Response> {
  try {
    const removed = await deleteAutomation(id);
    if (!removed) return jsonError(`Unknown automation '${id}'.`, 404);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to delete automation."), 500);
  }
}

export async function handleAutomationRun(id: string): Promise<Response> {
  try {
    const result = await startAutomationRun(id);
    if (result === "missing") return jsonError(`Unknown automation '${id}'.`, 404);
    return Response.json({ ok: true, started: result === "started" });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to start automation."), 500);
  }
}
