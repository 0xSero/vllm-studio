import type {
  Automation,
  AutomationFallbackReason,
  AutomationRun,
  AutomationTarget,
} from "../../../shared/agent/automation";
import type { AgentModel } from "../../../shared/agent/models";
import { sessionTitleFromUserPrompt } from "../../../shared/agent/session-title";
import { piRuntimeManager, selectPiRuntimeModel } from "./pi-runtime";
import { refreshPiModels } from "./pi-runtime-models";
import { AUTOMATION_RUNTIME_PREFIX, isAutomationRuntimeSessionId } from "./pi-runtime-state";
import { listProjectsFromStore } from "./projects-store";
import { lastAssistantResult } from "./session-text";
import { findThread, registerProvisionalThread } from "./thread-repository";

export const NO_ACTIVE_MODEL_ERROR =
  "No model is loaded right now, so this automation could not run. Load a model in Local Studio and try again.";
export const MODEL_LOOKUP_ERROR =
  "Could not read the list of runtime models, so this automation could not pick a model to run on.";
export const AUTOMATION_CANCELLED_ERROR =
  "This automation run was stopped because its conversation was archived while the run was in flight.";

export function ambiguousModelError(modelId: string): string {
  return `Model '${modelId}' is available from more than one active provider. Select a provider-specific model before running this automation.`;
}

export function missingThreadError(threadId: string): string {
  return `This automation runs inside conversation '${threadId}', which is no longer a thread in its working directory, so the run was skipped rather than started as a detached conversation.`;
}

export function archivedThreadError(threadId: string): string {
  return `This automation runs inside conversation '${threadId}', which is archived, so the run was skipped rather than reopening an archived thread.`;
}

export function busyThreadError(threadId: string): string {
  return `Conversation '${threadId}' is open in a live session right now, so this automation was skipped rather than taking over that conversation. It will run at its next scheduled time.`;
}

export function detachedThreadError(threadId: string): string {
  return `This automation runs inside conversation '${threadId}', but the run landed in a different conversation, so it was stopped instead of continuing detached.`;
}

export type ResolvedAutomationModel =
  | { ok: true; modelId: string; fallback: false }
  | { ok: true; modelId: string; fallback: true; fallbackReason: AutomationFallbackReason };

export type AutomationModelResolution = ResolvedAutomationModel | { ok: false; error: string };

function isControllerHostedModel(model: AgentModel): boolean {
  return typeof model.controllerUrl === "string" && model.controllerUrl.trim().length > 0;
}

function automationFallbackModel(models: readonly AgentModel[]): AgentModel | undefined {
  return (
    models.find((model) => isControllerHostedModel(model) && model.active) ??
    models.find((model) => !isControllerHostedModel(model))
  );
}

export function resolveAutomationModel(
  requestedModelId: string,
  models: readonly AgentModel[],
): AutomationModelResolution {
  let requested: AgentModel | null | undefined;
  try {
    requested = selectPiRuntimeModel([...models], requestedModelId);
  } catch {
    return { ok: false, error: ambiguousModelError(requestedModelId) };
  }
  if (requested && (!isControllerHostedModel(requested) || requested.active)) {
    return { ok: true, modelId: requested.id, fallback: false };
  }
  const fallback = automationFallbackModel(models);
  if (!fallback) return { ok: false, error: NO_ACTIVE_MODEL_ERROR };
  return {
    ok: true,
    modelId: fallback.id,
    fallback: true,
    fallbackReason: requested ? "requested_model_inactive" : "requested_model_unavailable",
  };
}

export function automationRunError(lastError: string | null, summary: string): string | null {
  if (lastError) return lastError;
  return summary.trim() ? null : "Automation completed without an assistant response.";
}

export function automationTarget(automation: Automation): AutomationTarget {
  return automation.target ?? { kind: "global" };
}

export function automationTargetThreadId(automation: Automation): string | null {
  const target = automationTarget(automation);
  return target.kind === "thread" ? target.threadId : null;
}

export function automationRuntimeSessionId(automationId: string): string {
  return `${AUTOMATION_RUNTIME_PREFIX}${automationId}`;
}

export async function abortAutomationRun(automationId: string): Promise<void> {
  const runtimeSessionId = automationRuntimeSessionId(automationId);
  const entry = piRuntimeManager
    .listSessions()
    .find((candidate) => candidate.sessionId === runtimeSessionId);
  if (!entry) return;
  await entry.session.abort().catch(() => undefined);
  await piRuntimeManager.stopAndDeleteSession(runtimeSessionId).catch(() => undefined);
}

type ThreadResolution = { ok: true; piSessionId: string } | { ok: false; error: string };

async function resolveThreadTarget(cwd: string, threadId: string): Promise<ThreadResolution> {
  const workspace = cwd.trim();
  const thread = workspace ? await findThread(workspace, threadId) : null;
  if (!thread) return { ok: false, error: missingThreadError(threadId) };
  if (thread.archived) return { ok: false, error: archivedThreadError(threadId) };
  return { ok: true, piSessionId: thread.id };
}

function modelFields(requestedModelId: string, resolution: ResolvedAutomationModel) {
  return resolution.fallback
    ? {
        requestedModelId,
        actualModelId: resolution.modelId,
        fallbackUsed: true,
        fallbackReason: resolution.fallbackReason,
      }
    : { requestedModelId, actualModelId: resolution.modelId, fallbackUsed: false };
}

type RunContext = { piSessionId: string | null; cwd: string; projectId: string | null };

function projectIdForCwd(cwd: string): string | null {
  return listProjectsFromStore().find((project) => project.path === cwd)?.id ?? null;
}

function runContext(status: { piSessionId: string | null; cwd: string }): RunContext {
  return {
    piSessionId: status.piSessionId,
    cwd: status.cwd,
    projectId: projectIdForCwd(status.cwd),
  };
}

function failedRun(
  automation: Automation,
  target: AutomationTarget,
  error: string,
  resolution?: ResolvedAutomationModel,
  context?: RunContext,
): AutomationRun {
  return {
    at: new Date().toISOString(),
    piSessionId: context?.piSessionId ?? null,
    cwd: context?.cwd || automation.cwd,
    projectId: context?.projectId ?? null,
    target,
    outcome: "error",
    summary: "",
    error,
    ...(resolution
      ? modelFields(automation.modelId, resolution)
      : { requestedModelId: automation.modelId }),
  };
}

function interactiveRuntimeOwns(piSessionId: string): boolean {
  return piRuntimeManager
    .listSessions()
    .some(
      ({ sessionId, session }) =>
        !isAutomationRuntimeSessionId(sessionId) &&
        session.status.piSessionId === piSessionId &&
        (session.status.running || session.status.active),
    );
}

export async function runAutomation(
  automation: Automation,
  signal?: AbortSignal,
): Promise<AutomationRun> {
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
  let resume: string | null = null;
  let threadId: string | null = null;
  if (target.kind === "thread") {
    const thread = await resolveThreadTarget(automation.cwd, target.threadId);
    if (!thread.ok) return failedRun(automation, target, thread.error, resolution);
    threadId = target.threadId;
    resume = thread.piSessionId;
    if (interactiveRuntimeOwns(resume)) {
      return failedRun(automation, target, busyThreadError(threadId), resolution);
    }
  }
  const runtimeSessionId = automationRuntimeSessionId(automation.id);
  const session = piRuntimeManager.getSession(runtimeSessionId);
  try {
    await session.ensureStarted(resolution.modelId, automation.cwd || undefined, resume, {});
    if (target.kind === "global") {
      const status = session.status;
      if (!status.piSessionId) throw new Error("Automation session did not receive an identity.");
      await registerProvisionalThread({
        id: status.piSessionId,
        cwd: status.cwd,
        modelId: status.modelId || resolution.modelId,
        title: sessionTitleFromUserPrompt(automation.prompt),
        startedAt: new Date().toISOString(),
      });
    }
    if (signal?.aborted) {
      return failedRun(
        automation,
        target,
        AUTOMATION_CANCELLED_ERROR,
        resolution,
        runContext(session.status),
      );
    }
    await session.prompt(automation.prompt, () => {}, { restartOnContinuationError: false });
    const status = session.status;
    const context = runContext(status);
    if (resume && status.piSessionId !== resume) {
      return failedRun(
        automation,
        target,
        detachedThreadError(threadId ?? resume),
        resolution,
        context,
      );
    }
    if (threadId) {
      const settled = await resolveThreadTarget(automation.cwd, threadId);
      if (!settled.ok) return failedRun(automation, target, settled.error, resolution, context);
    }
    const result = status.piSessionId
      ? lastAssistantResult(status.cwd, status.piSessionId)
      : { text: "", error: null };
    const error = automationRunError(status.lastError ?? result.error, result.text);
    return {
      at: new Date().toISOString(),
      ...context,
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
      resolution,
      runContext(session.status),
    );
  } finally {
    await piRuntimeManager.stopAndDeleteSession(runtimeSessionId).catch(() => undefined);
  }
}
