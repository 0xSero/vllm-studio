import {
  getAutomation,
  listAutomations,
  nextRunAt,
  patchAutomation,
  recordAutomationRun,
  type Automation,
  type AutomationRun,
} from "./automations-store";
import { getGlobalSingleton } from "./instances";
import { piRuntimeManager } from "./pi-runtime";
import { refreshPiModels } from "./pi-runtime-models";
import { lastAssistantResult } from "./session-text";
import { listProjectsFromStore } from "./projects-store";
import type { AgentModel } from "../../../shared/agent/models";

const TICK_MS = 30_000;

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: Set<string>;
};

function state(): SchedulerState {
  return getGlobalSingleton("automationScheduler", () => ({
    timer: null,
    running: new Set<string>(),
  }));
}

function runPrompt(automation: Automation): string {
  const preamble = automation.lastRun?.summary
    ? `Previous run summary (context, may be stale):\n${automation.lastRun.summary}\n\n---\n\n`
    : "";
  return `${preamble}${automation.prompt}`;
}

export function automationRunError(lastError: string | null, summary: string): string | null {
  if (lastError) return lastError;
  return summary.trim() ? null : "Automation completed without an assistant response.";
}

export type AutomationModelResolution =
  | { ok: true; modelId: string; fallback: boolean }
  | { ok: false; error: string };

export const NO_ACTIVE_MODEL_ERROR =
  "No model is loaded right now, so this automation could not run. Load a model in Local Studio and try again.";
export const MODEL_LOOKUP_ERROR =
  "Could not read the list of runtime models, so this automation could not pick a model to run on.";

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

function failedRun(automation: Automation, error: string): AutomationRun {
  return {
    at: new Date().toISOString(),
    piSessionId: null,
    cwd: automation.cwd,
    projectId: null,
    outcome: "error",
    summary: "",
    error,
    requestedModelId: automation.modelId,
  };
}

export async function runAutomationNow(id: string): Promise<Automation | null> {
  const scheduler = state();
  const automation = await getAutomation(id);
  if (!automation || scheduler.running.has(id)) return null;
  scheduler.running.add(id);
  const runtimeSessionId = `automation:${id}:${Date.now()}`;
  const scheduleNext = () => nextRunAt(automation.schedule, new Date()).toISOString();
  try {
    let models: readonly AgentModel[];
    try {
      ({ models } = await refreshPiModels());
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : "";
      return await recordAutomationRun(
        id,
        failedRun(automation, `${MODEL_LOOKUP_ERROR}${detail}`),
        scheduleNext(),
      );
    }
    const resolution = resolveAutomationModel(automation.modelId, models);
    if (!resolution.ok) {
      return await recordAutomationRun(id, failedRun(automation, resolution.error), scheduleNext());
    }
    const modelFields = resolution.fallback
      ? {
          requestedModelId: automation.modelId,
          actualModelId: resolution.modelId,
          fallbackReason: "requested_model_inactive" as const,
        }
      : { requestedModelId: automation.modelId, actualModelId: resolution.modelId };
    const { session } = piRuntimeManager.getSessionForLookup(runtimeSessionId, null);
    await session.ensureStarted(resolution.modelId, automation.cwd || undefined, null, {});
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
    return await recordAutomationRun(
      id,
      {
        at: new Date().toISOString(),
        piSessionId,
        cwd: status.cwd,
        projectId,
        outcome: error ? "error" : "ok",
        summary: result.text,
        ...(error ? { error } : {}),
        ...modelFields,
      },
      scheduleNext(),
    );
  } catch (error) {
    return await recordAutomationRun(
      id,
      failedRun(automation, error instanceof Error ? error.message : "Automation run failed"),
      scheduleNext(),
    );
  } finally {
    scheduler.running.delete(id);
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  let automations: Automation[];
  try {
    automations = await listAutomations();
  } catch {
    return;
  }
  for (const automation of automations) {
    if (automation.status !== "active") continue;
    if (!automation.nextRunAt) {
      await patchAutomation(automation.id, {
        nextRunAt: nextRunAt(automation.schedule, now).toISOString(),
      }).catch(() => undefined);
      continue;
    }
    if (new Date(automation.nextRunAt) <= now) {
      void runAutomationNow(automation.id);
    }
  }
}

export function startAutomationScheduler(): void {
  const scheduler = state();
  if (scheduler.timer) return;
  scheduler.timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
}
