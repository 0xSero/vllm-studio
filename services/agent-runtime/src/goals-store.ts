import { Schema } from "effect";
import { isRecord } from "../../../shared/agent/guards";
import {
  GOAL_STATUSES,
  type GoalStatus,
  type SessionGoal,
} from "../../../shared/agent/session-goal";
import { createSessionScopedJsonStore, type PersistedValue } from "./session-json-store";

export type { GoalStatus, SessionGoal };

const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);
const isGoalStatus = Schema.is(Schema.Literals(GOAL_STATUSES));

function positiveNumber(value: PersistedValue): number {
  return isNumber(value) && Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeGoal(value: PersistedValue): SessionGoal {
  const record = isRecord(value) ? value : {};
  const now = new Date().toISOString();
  return {
    version: 1,
    objective: isString(record.objective) ? record.objective : "",
    status: isGoalStatus(record.status) ? record.status : "active",
    turnBudget:
      isNumber(record.turnBudget) && record.turnBudget > 0 ? Math.round(record.turnBudget) : null,
    turnsUsed: isNumber(record.turnsUsed) && record.turnsUsed >= 0 ? record.turnsUsed : 0,
    timeUsedSeconds: positiveNumber(record.timeUsedSeconds),
    activeRunStartedAt: isString(record.activeRunStartedAt) ? record.activeRunStartedAt : null,
    createdAt: isString(record.createdAt) ? record.createdAt : now,
    updatedAt: isString(record.updatedAt) ? record.updatedAt : now,
  };
}

const store = createSessionScopedJsonStore<SessionGoal>({
  subdir: "goals",
  legacyFile: "goals-legacy.json",
  normalize: normalizeGoal,
});

export type GoalWritePatch = Partial<Omit<SessionGoal, "version" | "updatedAt">> & {
  resetProgress?: boolean;
};

const PROGRESS_RESET = {
  turnsUsed: 0,
  timeUsedSeconds: 0,
  activeRunStartedAt: null,
} as const;

export async function readGoal(piSessionId: string): Promise<SessionGoal | null> {
  const goal = await store.read(piSessionId);
  return goal.objective ? goal : null;
}

export async function writeGoal(piSessionId: string, patch: GoalWritePatch): Promise<SessionGoal> {
  const { resetProgress, ...fields } = patch;
  return store.write(
    resetProgress ? { ...fields, ...PROGRESS_RESET, createdAt: new Date().toISOString() } : fields,
    piSessionId,
  );
}

export async function clearGoal(piSessionId: string): Promise<void> {
  await writeGoal(piSessionId, {
    objective: "",
    status: "active",
    turnBudget: null,
    resetProgress: true,
  });
}
