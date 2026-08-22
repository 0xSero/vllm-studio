import { readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveDataDir } from "./data-dir";
import { createSessionScopedJsonStore } from "./session-json-store";
import { isRecord } from "../../../shared/agent/guards";
import type {
  Automation,
  AutomationRun,
  AutomationSchedule,
} from "../../../shared/agent/automation";

export type {
  Automation,
  AutomationRun,
  AutomationSchedule,
} from "../../../shared/agent/automation";

const AUTOMATIONS_SUBDIR = "automations";
export const automationSummaryLimit = 2000;
export const automationRunHistoryLimit = 20;

export function prependAutomationRun(
  runs: readonly AutomationRun[],
  run: AutomationRun,
): readonly AutomationRun[] {
  return [run, ...runs].slice(0, automationRunHistoryLimit);
}

/** Anything unrecognized falls back to a daily 08:00 run. */
function normalizeSchedule(value: unknown): AutomationSchedule {
  if (!isRecord(value)) return { kind: "daily", time: "08:00" };
  if (value.kind === "interval" && typeof value.minutes === "number" && value.minutes >= 1) {
    return { kind: "interval", minutes: Math.round(value.minutes) };
  }
  if (value.kind === "daily" && typeof value.time === "string") {
    return {
      kind: "daily",
      time: value.time,
      ...(value.weekdaysOnly === true ? { weekdaysOnly: true } : {}),
    };
  }
  if (value.kind === "weekly" && typeof value.day === "number" && typeof value.time === "string") {
    return {
      kind: "weekly",
      day: Math.min(6, Math.max(0, Math.round(value.day))),
      time: value.time,
    };
  }
  return { kind: "daily", time: "08:00" };
}

function normalizeRun(value: unknown): AutomationRun | null {
  if (!isRecord(value) || typeof value.at !== "string") return null;
  return {
    at: value.at,
    piSessionId: typeof value.piSessionId === "string" ? value.piSessionId : null,
    cwd: typeof value.cwd === "string" ? value.cwd : "",
    projectId: typeof value.projectId === "string" ? value.projectId : null,
    outcome: value.outcome === "error" ? "error" : "ok",
    summary:
      typeof value.summary === "string" ? value.summary.slice(0, automationSummaryLimit) : "",
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

/** A stored session id, or null for "start a fresh session every run". Records
 *  written before automations could target a session have no field at all. */
function normalizeTargetSessionId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAutomation(value: unknown): Automation {
  const record = isRecord(value) ? value : {};
  const now = new Date().toISOString();
  const lastRun = normalizeRun(record.lastRun);
  const runs = Array.isArray(record.runs)
    ? record.runs
        .map(normalizeRun)
        .filter((run): run is AutomationRun => run !== null)
        .slice(0, automationRunHistoryLimit)
    : lastRun
      ? [lastRun]
      : [];
  return {
    version: 1,
    id: typeof record.id === "string" ? record.id : "",
    name: typeof record.name === "string" ? record.name : "Untitled automation",
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    modelId: typeof record.modelId === "string" ? record.modelId : "",
    cwd: typeof record.cwd === "string" ? record.cwd : "",
    targetSessionId: normalizeTargetSessionId(record.targetSessionId),
    schedule: normalizeSchedule(record.schedule),
    status: record.status === "paused" ? "paused" : "active",
    nextRunAt: typeof record.nextRunAt === "string" ? record.nextRunAt : null,
    lastRun: runs[0] ?? lastRun,
    runs,
    unread: record.unread === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

const store = createSessionScopedJsonStore<Automation>({
  subdir: AUTOMATIONS_SUBDIR,
  legacyFile: "automations-legacy.json",
  normalize: normalizeAutomation,
});

export function nextRunAt(schedule: AutomationSchedule, from: Date): Date {
  if (schedule.kind === "interval") {
    return new Date(from.getTime() + schedule.minutes * 60_000);
  }
  // Unparseable times fall back to 08:00, the same default a missing one gets.
  const match = /^(\d{1,2}):(\d{2})$/.exec(schedule.time.trim());
  const next = new Date(from);
  next.setHours(
    match ? Math.min(23, Number(match[1])) : 8,
    match ? Math.min(59, Number(match[2])) : 0,
    0,
    0,
  );
  const dayBlocked = (day: number) =>
    schedule.kind === "weekly"
      ? day !== schedule.day
      : schedule.weekdaysOnly === true && (day === 0 || day === 6);
  // Roll forward whole days until the slot is in the future and lands on an
  // allowed weekday; setDate carries month and year ends for us.
  while (next <= from || dayBlocked(next.getDay())) next.setDate(next.getDate() + 1);
  return next;
}

export async function listAutomations(): Promise<Automation[]> {
  const dir = path.join(resolveDataDir(), AUTOMATIONS_SUBDIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const automations: Automation[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const automation = await store.read(entry.slice(0, -5));
    if (automation.id) automations.push(automation);
  }
  return automations.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const automation = await store.read(id);
  return automation.id ? automation : null;
}

export async function createAutomation(input: {
  name: string;
  prompt: string;
  modelId: string;
  cwd: string;
  targetSessionId?: string | null;
  schedule: unknown;
}): Promise<Automation> {
  const id = `auto-${randomUUID().slice(0, 8)}`;
  const schedule = normalizeSchedule(input.schedule);
  return store.write(
    {
      version: 1,
      id,
      name: input.name.trim() || "Untitled automation",
      prompt: input.prompt,
      modelId: input.modelId,
      cwd: input.cwd,
      targetSessionId: normalizeTargetSessionId(input.targetSessionId),
      schedule,
      status: "active",
      nextRunAt: nextRunAt(schedule, new Date()).toISOString(),
      lastRun: null,
      runs: [],
      unread: false,
      createdAt: new Date().toISOString(),
    },
    id,
  );
}

export async function patchAutomation(
  id: string,
  patch: Partial<
    Pick<
      Automation,
      "name" | "prompt" | "modelId" | "cwd" | "status" | "unread" | "targetSessionId"
    >
  > & {
    schedule?: unknown;
    nextRunAt?: string | null;
    lastRun?: AutomationRun | null;
    runs?: readonly AutomationRun[];
  },
): Promise<Automation | null> {
  const existing = await getAutomation(id);
  if (!existing) return null;
  const { schedule: rawSchedule, ...rest } = patch;
  const schedule = rawSchedule === undefined ? undefined : normalizeSchedule(rawSchedule);
  const next = await store.write(
    {
      ...rest,
      ...(schedule ? { schedule } : {}),
      ...(schedule || patch.status === "active"
        ? { nextRunAt: nextRunAt(schedule ?? existing.schedule, new Date()).toISOString() }
        : {}),
    },
    id,
  );
  return next;
}

export async function recordAutomationRun(
  id: string,
  run: AutomationRun,
  nextRunAtValue: string,
): Promise<Automation | null> {
  const automation = await getAutomation(id);
  if (!automation) return null;
  return patchAutomation(id, {
    unread: true,
    lastRun: run,
    runs: prependAutomationRun(automation.runs, run),
    nextRunAt: nextRunAtValue,
  });
}

export async function deleteAutomation(id: string): Promise<boolean> {
  const existing = await getAutomation(id);
  if (!existing) return false;
  await rm(path.join(resolveDataDir(), AUTOMATIONS_SUBDIR, `${id}.json`), { force: true });
  return true;
}
