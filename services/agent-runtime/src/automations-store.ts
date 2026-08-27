import { readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Schema } from "effect";
import { resolveDataDir } from "./data-dir";
import { createSessionScopedJsonStore, type PersistedValue } from "./session-json-store";
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
const MAX_SUMMARY_CHARS = 2000;
export const automationRunHistoryLimit = 20;

export function prependAutomationRun(
  runs: readonly AutomationRun[],
  run: AutomationRun,
): readonly AutomationRun[] {
  return [run, ...runs].slice(0, automationRunHistoryLimit);
}

const isString: (value: PersistedValue) => value is string = Schema.is(Schema.String);
const isNumber: (value: PersistedValue) => value is number = Schema.is(Schema.Number);

function normalizeSchedule(value: PersistedValue): AutomationSchedule {
  if (isRecord(value)) {
    if (value.kind === "interval" && isNumber(value.minutes) && value.minutes >= 1) {
      return { kind: "interval", minutes: Math.round(value.minutes) };
    }
    if (value.kind === "daily" && isString(value.time)) {
      if (value.weekdaysOnly === true)
        return { kind: "daily", time: value.time, weekdaysOnly: true };
      return { kind: "daily", time: value.time };
    }
    if (value.kind === "weekly" && isNumber(value.day) && isString(value.time)) {
      return {
        kind: "weekly",
        day: Math.min(6, Math.max(0, Math.round(value.day))),
        time: value.time,
      };
    }
  }
  return { kind: "daily", time: "08:00" };
}

function normalizeRun(value: PersistedValue): AutomationRun | null {
  if (!isRecord(value) || !isString(value.at)) return null;
  const run: AutomationRun = {
    at: value.at,
    piSessionId: isString(value.piSessionId) ? value.piSessionId : null,
    cwd: isString(value.cwd) ? value.cwd : "",
    projectId: isString(value.projectId) ? value.projectId : null,
    outcome: value.outcome === "error" ? "error" : "ok",
    summary: isString(value.summary) ? value.summary.slice(0, MAX_SUMMARY_CHARS) : "",
  };
  if (isString(value.error)) return { ...run, error: value.error };
  return run;
}

function normalizeTargetSessionId(value: PersistedValue): string | null {
  return isString(value) && value.trim() ? value.trim() : null;
}

function normalizeAutomation(value: PersistedValue): Automation {
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
    id: isString(record.id) ? record.id : "",
    name: isString(record.name) ? record.name : "Untitled automation",
    prompt: isString(record.prompt) ? record.prompt : "",
    modelId: isString(record.modelId) ? record.modelId : "",
    cwd: isString(record.cwd) ? record.cwd : "",
    targetSessionId: normalizeTargetSessionId(record.targetSessionId),
    schedule: normalizeSchedule(record.schedule),
    status: record.status === "paused" ? "paused" : "active",
    nextRunAt: isString(record.nextRunAt) ? record.nextRunAt : null,
    lastRun: runs[0] ?? lastRun,
    runs,
    unread: record.unread === true,
    createdAt: isString(record.createdAt) ? record.createdAt : now,
    updatedAt: isString(record.updatedAt) ? record.updatedAt : now,
  };
}

const store = createSessionScopedJsonStore<Automation>({
  subdir: AUTOMATIONS_SUBDIR,
  legacyFile: "automations-legacy.json",
  normalize: normalizeAutomation,
});

function parseTime(time: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hours = match ? Math.min(23, Number(match[1])) : 8;
  const minutes = match ? Math.min(59, Number(match[2])) : 0;
  return { hours, minutes };
}

export function nextRunAt(schedule: AutomationSchedule, from: Date): Date {
  if (schedule.kind === "interval") {
    return new Date(from.getTime() + schedule.minutes * 60_000);
  }
  const { hours, minutes } = parseTime(schedule.time);
  const candidate = new Date(from);
  candidate.setHours(hours, minutes, 0, 0);
  const advanceDays = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };
  if (schedule.kind === "daily") {
    let next = candidate <= from ? advanceDays(candidate, 1) : candidate;
    if (schedule.weekdaysOnly) {
      while (next.getDay() === 0 || next.getDay() === 6) next = advanceDays(next, 1);
    }
    return next;
  }
  let next = candidate;
  const targetDay = schedule.day;
  while (next.getDay() !== targetDay || next <= from) next = advanceDays(next, 1);
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
  let scheduleInput: PersistedValue;
  try {
    scheduleInput = JSON.parse(JSON.stringify(input.schedule));
  } catch {
    scheduleInput = undefined;
  }
  const schedule = normalizeSchedule(scheduleInput);
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
    schedule?: PersistedValue;
    nextRunAt?: string | null;
    lastRun?: AutomationRun | null;
    runs?: readonly AutomationRun[];
  },
): Promise<Automation | null> {
  const existing = await getAutomation(id);
  if (!existing) return null;
  const { schedule: rawSchedule, ...rest } = patch;
  const schedule = rawSchedule === undefined ? undefined : normalizeSchedule(rawSchedule);
  let update: Partial<Omit<Automation, "version" | "updatedAt">> = { ...rest };
  if (schedule) update = { ...update, schedule };
  if (schedule || patch.status === "active") {
    const value = nextRunAt(schedule ?? existing.schedule, new Date()).toISOString();
    update = { ...update, nextRunAt: value };
  }
  const next = await store.write(update, id);
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

export const automationSummaryLimit = MAX_SUMMARY_CHARS;
