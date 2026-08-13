import { runAutomation } from "./automation-runner";
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

export async function runAutomationNow(id: string): Promise<Automation | null> {
  const scheduler = state();
  const automation = await getAutomation(id);
  if (!automation || scheduler.running.has(id)) return null;
  scheduler.running.add(id);
  try {
    const run = await runAutomation(automation);
    return await recordAutomationRun(
      id,
      run,
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
      void runAutomationNow(automation.id).catch(() => undefined);
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
