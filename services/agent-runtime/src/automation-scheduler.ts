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
import { lastAssistantResult } from "./session-text";
import { listProjectsFromStore } from "./projects-store";
import { refreshPiModels } from "./pi-runtime-models";
import { findSessionFile } from "./sessions-store";

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

function runPrompt(automation: Automation, resuming: boolean): string {
  const preamble =
    !resuming && automation.lastRun?.summary
      ? `Previous run summary (context, may be stale):\n${automation.lastRun.summary}\n\n---\n\n`
      : "";
  return `${preamble}${automation.prompt}`;
}

export function automationRunError(lastError: string | null, summary: string): string | null {
  if (lastError) return lastError;
  return summary.trim() ? null : "Automation completed without an assistant response.";
}

async function runnableModelId(configured: string): Promise<string> {
  try {
    const { models } = await refreshPiModels();
    if (models.some((model) => model.id === configured)) return configured;
    const fallback = models.find((model) => model.active) ?? models[0];
    if (!fallback) return configured;
    console.warn(`[automation] ${configured} is unavailable; running on ${fallback.id} instead`);
    return fallback.id;
  } catch {
    return configured;
  }
}

function findTargetSessionCwd(automation: Automation, targetSessionId: string): string | null {
  const candidates = [automation.cwd, ...listProjectsFromStore().map((project) => project.path)];
  for (const candidate of new Set(candidates.map((cwd) => cwd.trim()).filter(Boolean))) {
    try {
      if (findSessionFile(candidate, targetSessionId)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

type RunTarget = {
  piSessionId: string | null;
  cwd: string | undefined;
  runtimeSessionId: string;
  adopted: boolean;
  note: string;
};

function resolveRunTarget(automation: Automation): RunTarget {
  const fresh = `automation:${automation.id}:${Date.now()}`;
  const target = automation.targetSessionId?.trim() ?? "";
  const cwd = target ? findTargetSessionCwd(automation, target) : null;
  if (!target || !cwd) {
    return {
      piSessionId: null,
      cwd: automation.cwd || undefined,
      runtimeSessionId: fresh,
      adopted: false,
      note: target
        ? `Session ${target} no longer exists on this machine — this run used a fresh session instead.`
        : "",
    };
  }
  const live = piRuntimeManager.findSessionForLookup(fresh, target);
  return {
    piSessionId: target,
    cwd,
    runtimeSessionId: live?.sessionId ?? fresh,
    adopted: Boolean(live),
    note: "",
  };
}

function runSummary(note: string, text: string): string {
  if (!note) return text;
  return text ? `${note}\n\n${text}` : note;
}

export async function runAutomationNow(id: string): Promise<Automation | null> {
  const scheduler = state();
  const automation = await getAutomation(id);
  if (!automation || scheduler.running.has(id)) return null;
  scheduler.running.add(id);
  const target = resolveRunTarget(automation);
  try {
    const { session } = piRuntimeManager.getSessionForLookup(
      target.runtimeSessionId,
      target.piSessionId,
    );
    const modelId = await runnableModelId(automation.modelId);
    await session.ensureStarted(
      modelId,
      target.cwd,
      target.piSessionId,
      target.adopted ? undefined : {},
    );
    await session.prompt(runPrompt(automation, target.piSessionId !== null), () => {});
    const status = session.status;
    const piSessionId = status.piSessionId;
    const result = piSessionId
      ? lastAssistantResult(status.cwd, piSessionId)
      : { text: "", error: null };
    const error = automationRunError(status.lastError ?? result.error, result.text);
    const projectId =
      listProjectsFromStore().find((project) => project.path === status.cwd)?.id ?? null;
    if (!target.adopted) void session.stop().catch(() => undefined);
    let run: AutomationRun = {
      at: new Date().toISOString(),
      piSessionId,
      cwd: status.cwd,
      projectId,
      outcome: error ? "error" : "ok",
      summary: runSummary(target.note, result.text),
    };
    if (error) run = { ...run, error };
    return await recordAutomationRun(
      id,
      run,
      nextRunAt(automation.schedule, new Date()).toISOString(),
    );
  } catch (error) {
    return await recordAutomationRun(
      id,
      {
        at: new Date().toISOString(),
        piSessionId: null,
        cwd: automation.cwd,
        projectId: null,
        outcome: "error",
        summary: "",
        error: error instanceof Error ? error.message : "Automation run failed",
      },
      nextRunAt(automation.schedule, new Date()).toISOString(),
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
