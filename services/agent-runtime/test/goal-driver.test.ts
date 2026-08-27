import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanTemps, tempDir } from "./test-fixtures";
import { attachGoalDriver, markGoalTurnAborted } from "../src/goal-driver";
import { readGoal, writeGoal } from "../src/goals-store";
import type { LoggedPiEvent, PiAgentSession, PiAgentStatus } from "../src/pi-runtime-types";

const id = "goal-driver-test-session";
const original = process.env.LOCAL_STUDIO_DATA_DIR;
beforeEach(() => {
  process.env.LOCAL_STUDIO_DATA_DIR = tempDir("goal-driver-");
});
afterEach(() => {
  if (original === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = original;
  cleanTemps();
});

type GoalEvent = LoggedPiEvent["event"];
type Harness = {
  session: PiAgentSession;
  status: PiAgentStatus;
  emit: (event: GoalEvent) => void;
  prompts: string[];
};
function harness(): Harness {
  const listeners: Array<(event: LoggedPiEvent) => void> = [],
    prompts: string[] = [];
  let seq = 0;
  const status: PiAgentStatus = {
    running: false,
    active: false,
    modelId: "test",
    cwd: "/tmp",
    piSessionId: id,
    agentDir: "/tmp",
    eventSeq: 0,
    lastError: null,
    contextUsage: null,
  };
  const session: PiAgentSession = {
    status,
    async ensureStarted() {},
    async prompt(message) {
      prompts.push(message);
    },
    async steer() {},
    async mutateQueuedFollowUp() {},
    async followUp() {},
    async abort() {
      return { steering: [], followUp: [] };
    },
    async compact() {
      throw new Error("compact is not available in the goal-driver harness");
    },
    async stop() {},
    getEventsAfter() {
      return [];
    },
    onLoggedEvent(listener) {
      listeners.push(listener);
      return () => undefined;
    },
    adoptPiSessionId(piSessionId) {
      status.piSessionId = piSessionId ?? null;
    },
    respondExtensionUi() {
      return false;
    },
  };
  attachGoalDriver(session);
  return {
    session,
    status,
    prompts,
    emit(event) {
      for (const listener of listeners) listener({ seq: ++seq, event, timestamp: "" });
    },
  };
}
const says = (text: string) => ({
  type: "message",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
async function flush(): Promise<void> {
  let previous = JSON.stringify(await readGoal(id)),
    stable = 0;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    await Bun.sleep(5);
    const current = JSON.stringify(await readGoal(id));
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    if (stable >= 3) return;
  }
}
const goal = (patch: Parameters<typeof writeGoal>[1] = {}) =>
  writeGoal(id, {
    objective: "ship the release",
    status: "active",
    resetProgress: true,
    ...patch,
  });
async function turn(emit: Harness["emit"], text?: string): Promise<void> {
  emit({ type: "agent_start" });
  if (text) emit(says(text));
  emit({ type: "agent_settled" });
  await flush();
}

test("ordinary turns count and remain active", async () => {
  const { emit } = harness();
  await goal();
  await turn(emit, "Rebuilt the bundle.");
  const result = await readGoal(id);
  expect(result?.status).toBe("active");
  expect(result?.turnsUsed).toBe(1);
});

test("this turn's completion sentinel settles the goal", async () => {
  const { emit } = harness();
  await goal();
  await turn(emit, "All green.\nGOAL_COMPLETE");
  expect((await readGoal(id))?.status).toBe("complete");
});

test("textless turns do not inherit old sentinels", async () => {
  const { emit } = harness();
  await goal();
  await turn(emit, "All green.\nGOAL_COMPLETE");
  await goal({ objective: "now do the next thing" });
  emit({ type: "agent_start" });
  emit({ type: "tool_execution_start" });
  emit({ type: "agent_settled" });
  await flush();
  const result = await readGoal(id);
  expect(result?.status).toBe("active");
  expect(result?.turnsUsed).toBe(1);
});

test("spent turn budgets stop pursuit", async () => {
  const { emit } = harness();
  await goal({ turnBudget: 1 });
  await turn(emit, "Working.");
  const result = await readGoal(id);
  expect(result?.status).toBe("budget_limited");
  expect(result?.turnsUsed).toBe(1);
});

test("pursuit time is banked per run", async () => {
  const { emit } = harness();
  await goal();
  emit({ type: "agent_start" });
  await flush();
  expect((await readGoal(id))?.activeRunStartedAt).not.toBeNull();
  emit({ type: "agent_settled" });
  await flush();
  const result = await readGoal(id);
  expect(result?.activeRunStartedAt).toBeNull();
  expect(result?.timeUsedSeconds).toBeGreaterThanOrEqual(0);
});

test("Stop pauses without reprompting", async () => {
  const h = harness();
  await goal();
  h.emit({ type: "agent_start" });
  markGoalTurnAborted(h.session);
  h.emit({ type: "agent_settled" });
  await flush();
  expect((await readGoal(id))?.status).toBe("paused");
  await Bun.sleep(2200);
  expect(h.prompts).toHaveLength(0);
});

test("runtime errors pause pursuit", async () => {
  const h = harness();
  await goal();
  h.emit({ type: "agent_start" });
  h.status.lastError = "model unreachable";
  h.emit({ type: "agent_settled" });
  await flush();
  expect((await readGoal(id))?.status).toBe("paused");
});

test("tool-free continuations park the goal", async () => {
  const h = harness();
  await goal();
  await turn(h.emit, "Working.");
  await Bun.sleep(2200);
  expect(h.prompts).toHaveLength(1);
  expect(h.prompts[0]).toContain("ship the release");
  h.emit(says("I think we are nearly there."));
  h.emit({ type: "agent_settled" });
  await flush();
  expect((await readGoal(id))?.status).toBe("paused");
});
