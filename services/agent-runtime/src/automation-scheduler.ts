import { abortAutomationRun, automationTargetThreadId, runAutomation } from "./automation-runner";
import {
  getAutomation,
  listAutomations,
  nextRunAt,
  patchAutomation,
  recordAutomationRun,
  type Automation,
} from "./automations-store";
import { getGlobalSingleton } from "./instances";

export { automationRunError } from "./automation-runner";

const TICK_MS = 30_000;
const MAX_OVERDUE_RUNS = 3;

type RunHandle = {
  threadId: string | null;
  controller: AbortController;
  settled: Promise<void>;
};

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: Map<string, RunHandle>;
};

function state(): SchedulerState {
  return getGlobalSingleton("automationScheduler", () => ({
    timer: null,
    running: new Map<string, RunHandle>(),
  }));
}

async function executeAutomationRun(
  id: string,
  automation: Automation,
  scheduler: SchedulerState,
  signal: AbortSignal,
): Promise<void> {
  try {
    const run = await runAutomation(automation, signal);
    await recordAutomationRun(id, run);
  } finally {
    scheduler.running.delete(id);
  }
}

export async function startAutomationRun(id: string): Promise<"started" | "running" | "missing"> {
  const scheduler = state();
  const automation = await getAutomation(id);
  if (!automation) return "missing";
  if (scheduler.running.has(id)) return "running";
  const controller = new AbortController();
  scheduler.running.set(id, {
    threadId: automationTargetThreadId(automation),
    controller,
    settled: Promise.resolve()
      .then(() => executeAutomationRun(id, automation, scheduler, controller.signal))
      .catch(() => undefined),
  });
  return "started";
}

export async function cancelAutomationRunsForThread(threadId: string): Promise<void> {
  const target = threadId.trim();
  if (!target) return;
  const scheduler = state();
  await Promise.all(
    [...scheduler.running.entries()]
      .filter(([, handle]) => handle.threadId === target)
      .map(async ([id, handle]) => {
        handle.controller.abort();
        await abortAutomationRun(id);
        await handle.settled;
      }),
  );
}

async function tick(): Promise<void> {
  const now = new Date();
  const scheduler = state();
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
      if (scheduler.running.size >= MAX_OVERDUE_RUNS) break;
      await startAutomationRun(automation.id).catch(() => "missing" as const);
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
