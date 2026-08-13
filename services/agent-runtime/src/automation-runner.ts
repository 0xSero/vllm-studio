import type {
  Automation,
  AutomationRun,
  AutomationTarget,
} from "../../../shared/agent/automation";
import type { AgentModel } from "../../../shared/agent/models";
import { piRuntimeManager } from "./pi-runtime";
import { refreshPiModels } from "./pi-runtime-models";
import { listProjectsFromStore } from "./projects-store";
import { lastAssistantResult } from "./session-text";
import { findSessionFile } from "./sessions-store";

export const NO_ACTIVE_MODEL_ERROR =
  "No model is loaded right now, so this automation could not run. Load a model in Local Studio and try again.";
export const MODEL_LOOKUP_ERROR =
  "Could not read the list of runtime models, so this automation could not pick a model to run on.";

export function missingThreadError(threadId: string): string {
  return `This automation runs inside conversation '${threadId}', which is not on disk for its working directory, so the run was skipped rather than started as a detached conversation.`;
}

export type AutomationModelResolution =
  | { ok: true; modelId: string; fallback: boolean }
  | { ok: false; error: string };

export function resolveAutomationModel(
  requestedModelId: string,
  models: readonly AgentModel[],
): AutomationModelResolution {
  const requested = models.find(
    (model) => model.id === requestedModelId || model.rawId === requestedModelId,
  );
  if (requested?.active) return { ok: true, modelId: requestedModelId, fallback: false };
  const active = models.find((model) => model.active);
  if (!active) return { ok: false, error: NO_ACTIVE_MODEL_ERROR };
  return { ok: true, modelId: active.id, fallback: true };
}

export function automationRunError(lastError: string | null, summary: string): string | null {
  if (lastError) return lastError;
  return summary.trim() ? null : "Automation completed without an assistant response.";
}

export function automationTarget(automation: Automation): AutomationTarget {
  return automation.target ?? { kind: "global" };
}

function runPrompt(automation: Automation): string {
  const preamble = automation.lastRun?.summary
    ? `Previous run summary (context, may be stale):\n${automation.lastRun.summary}\n\n---\n\n`
    : "";
  return `${preamble}${automation.prompt}`;
}

function resumeThread(cwd: string, threadId: string): string | null {
  const workspace = cwd.trim();
  if (!workspace) return null;
  return findSessionFile(workspace, threadId) ? threadId : null;
}

function modelFields(requestedModelId: string, resolution: { modelId: string; fallback: boolean }) {
  return resolution.fallback
    ? {
        requestedModelId,
        actualModelId: resolution.modelId,
        fallbackReason: "requested_model_inactive" as const,
      }
    : { requestedModelId, actualModelId: resolution.modelId };
}

function failedRun(
  automation: Automation,
  target: AutomationTarget,
  error: string,
): AutomationRun {
  return {
    at: new Date().toISOString(),
    piSessionId: null,
    cwd: automation.cwd,
    projectId: null,
    target,
    outcome: "error",
    summary: "",
    error,
    requestedModelId: automation.modelId,
  };
}

export async function runAutomation(automation: Automation): Promise<AutomationRun> {
  const target = automationTarget(automation);
  let models: readonly AgentModel[];
  try {
    ({ models } = await refreshPiModels());
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    return failedRun(automation, target, `${MODEL_LOOKUP_ERROR}${detail}`);
  }
  const resolution = resolveAutomationModel(automation.modelId, models);
  if (!resolution.ok) return failedRun(automation, target, resolution.error);
  const resume = target.kind === "thread" ? resumeThread(automation.cwd, target.threadId) : null;
  if (target.kind === "thread" && !resume) {
    return failedRun(automation, target, missingThreadError(target.threadId));
  }
  try {
    const { session } = piRuntimeManager.getSessionForLookup(`automation:${automation.id}`, null);
    await session.ensureStarted(resolution.modelId, automation.cwd || undefined, resume, {});
    await session.prompt(runPrompt(automation), () => {});
    const status = session.status;
    const piSessionId = status.piSessionId;
    const result = piSessionId
      ? lastAssistantResult(status.cwd, piSessionId)
      : { text: "", error: null };
    const error = automationRunError(status.lastError ?? result.error, result.text);
    const projectId =
      listProjectsFromStore().find((project) => project.path === status.cwd)?.id ?? null;
    void session.stop().catch(() => undefined);
    return {
      at: new Date().toISOString(),
      piSessionId,
      cwd: status.cwd,
      projectId,
      target,
      outcome: error ? "error" : "ok",
      summary: result.text,
      ...(error ? { error } : {}),
      ...modelFields(automation.modelId, resolution),
    };
  } catch (error) {
    return failedRun(
      automation,
      target,
      error instanceof Error ? error.message : "Automation run failed",
    );
  }
}
