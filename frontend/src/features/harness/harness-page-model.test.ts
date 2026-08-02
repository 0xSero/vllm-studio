import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  TERMINAL_TASK_STATUSES,
  describeGoalOutcome,
  goalStartBlocker,
  initialHarnessObjective,
  isTerminalTaskStatus,
  resolveTaskEnvelope,
  stripGoalCommandPrefix,
  startTaskPolling,
} from "./harness-page-model";

const runningTask = { id: "task-1", status: "working" };

describe("resolveTaskEnvelope", () => {
  test("prefers the explicit task envelope over everything else", () => {
    const resolved = resolveTaskEnvelope({
      task: runningTask,
      current: { id: "task-2", status: "done" },
      id: "envelope-id",
      status: "working",
    });
    assert.equal(resolved?.id, "task-1");
    assert.equal(resolved?.status, "working");
  });

  test("an envelope carrying both a top-level id and current resolves to current", () => {
    // Regression: `{ id: "req-1", current: {...} }` used to be misread as the
    // task itself because the old discriminator only checked `payload.id`.
    const resolved = resolveTaskEnvelope({
      id: "req-1",
      current: runningTask,
    });
    assert.equal(resolved?.id, "task-1");
    assert.equal(resolved?.status, "working");
  });

  test("current still wins even when the envelope itself is task-shaped", () => {
    const resolved = resolveTaskEnvelope({
      id: "req-1",
      status: "working",
      current: runningTask,
    });
    assert.equal(resolved?.id, "task-1");
  });

  test("an invalid explicit envelope value falls through instead of masking the task", () => {
    assert.equal(resolveTaskEnvelope({ task: {}, current: runningTask })?.id, "task-1");
    assert.equal(
      resolveTaskEnvelope({ task: { id: "half-formed" }, current: runningTask })?.id,
      "task-1",
    );
    // The idle shape: tasks/current answers { current: null, tasks: [...] }.
    assert.equal(resolveTaskEnvelope({ current: null }), null);
  });

  test("returns null when every candidate is malformed", () => {
    assert.equal(resolveTaskEnvelope({ task: {}, current: { id: "", status: "" } }), null);
    assert.equal(resolveTaskEnvelope({ task: null, current: null, id: "req-9" }), null);
  });

  test("accepts a bare payload only when it has a valid task shape", () => {
    assert.equal(resolveTaskEnvelope(runningTask)?.id, "task-1");
    // id without status is not a task.
    assert.equal(resolveTaskEnvelope({ id: "req-1" }), null);
    // status without id is not a task.
    assert.equal(resolveTaskEnvelope({ status: "working" }), null);
    // Empty ids/statuses do not count.
    assert.equal(resolveTaskEnvelope({ id: "", status: "" }), null);
    // The events envelope ({ task_id, events }) has neither key.
    assert.equal(resolveTaskEnvelope({ events: [] }), null);
    assert.equal(resolveTaskEnvelope({}), null);
  });
});

describe("isTerminalTaskStatus", () => {
  test("matches the Harness durable terminal set exactly", () => {
    assert.deepEqual([...TERMINAL_TASK_STATUSES].sort(), [
      "blocked",
      "complete",
      "done",
      "failed",
      "stopped",
    ]);
    for (const status of TERMINAL_TASK_STATUSES) {
      assert.equal(isTerminalTaskStatus(status), true);
    }
  });

  test("active, unknown, and missing statuses keep polling", () => {
    for (const status of ["working", "checking", "starting", "queued", "", undefined]) {
      assert.equal(isTerminalTaskStatus(status), false, `${String(status)} must not be terminal`);
    }
  });
});

describe("initialHarnessObjective", () => {
  test("accepts one Workbench objective while rejecting ambiguous query values", () => {
    assert.equal(initialHarnessObjective("Ship the verified change"), "Ship the verified change");
    assert.equal(initialHarnessObjective(["first", "second"]), "");
    assert.equal(initialHarnessObjective(undefined), "");
    assert.equal(initialHarnessObjective("x".repeat(20_000)).length, 16_384);
  });
});

describe("goal prompt and outcome helpers", () => {
  test("accepts ordinary prose and strips only a standalone /goal prefix", () => {
    assert.equal(
      stripGoalCommandPrefix("  Review the provider flow  "),
      "Review the provider flow",
    );
    assert.equal(stripGoalCommandPrefix("/goal  Fix the prompt flow"), "Fix the prompt flow");
    assert.equal(stripGoalCommandPrefix("/goalkeeper review"), "/goalkeeper review");
    assert.equal(stripGoalCommandPrefix(" /goal "), "");
  });

  test("explains why a goal cannot start instead of leaving a dead button", () => {
    assert.match(
      goalStartBlocker({
        goal: "",
        backend: "managed",
        providerConfigured: true,
        setupLoading: false,
      }) ?? "",
      /Type a goal first/,
    );
    assert.match(
      goalStartBlocker({
        goal: "Review the provider",
        backend: "provider",
        providerConfigured: false,
        setupLoading: false,
      }) ?? "",
      /endpoint and model/,
    );
    assert.equal(
      goalStartBlocker({
        goal: "Review the provider",
        backend: "managed",
        providerConfigured: true,
        setupLoading: false,
      }),
      null,
    );
  });

  test("an active shared-workspace goal explains why a new goal cannot start", () => {
    const blocker = goalStartBlocker({
      goal: "Review the provider",
      backend: "managed",
      providerConfigured: true,
      setupLoading: false,
      activeTaskStatus: "working",
    });
    assert.match(String(blocker), /another goal is already running/i);
    assert.match(String(blocker), /shared workspace/i);
  });

  test("a terminal current task does not block a new goal", () => {
    assert.equal(
      goalStartBlocker({
        goal: "Review the provider",
        backend: "managed",
        providerConfigured: true,
        setupLoading: false,
        activeTaskStatus: "done",
      }),
      null,
    );
  });

  test("does not call a done task verified when it has no recorded checks", () => {
    const outcome = describeGoalOutcome({ id: "task-1", status: "done" });
    assert.equal(outcome?.state, "unverified");
    assert.match(outcome?.headline ?? "", /without verification/);
  });

  test("treats a provider failure as terminal and actionable", () => {
    const outcome = describeGoalOutcome({
      id: "task-2",
      status: "failed",
      summary: "Provider stopped with evidence.",
    });
    assert.equal(outcome?.state, "blocked");
    assert.match(outcome?.headline ?? "", /failed/i);
    assert.match(outcome?.detail ?? "", /Provider stopped/);
  });
});

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function manualTimers() {
  const pending: Array<{ id: number; fn: () => void }> = [];
  let nextId = 1;
  return {
    schedule(fn: () => void, _ms: number): number {
      const id = nextId++;
      pending.push({ id, fn });
      return id;
    },
    clearSchedule(id: number): void {
      const index = pending.findIndex((timer) => timer.id === id);
      if (index >= 0) pending.splice(index, 1);
    },
    fire(): void {
      const next = pending.shift();
      assert.ok(next, "expected a pending timer to fire");
      next.fn();
    },
    get count(): number {
      return pending.length;
    },
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("startTaskPolling", () => {
  test("serializes polls and re-arms only after the load settles", async () => {
    const timers = manualTimers();
    const gate = deferred();
    const seen: AbortSignal[] = [];
    const stop = startTaskPolling({
      intervalMs: 3000,
      load: (signal) => {
        seen.push(signal);
        return gate.promise;
      },
      onError: () => assert.fail("no error expected"),
      schedule: timers.schedule,
      clearSchedule: timers.clearSchedule,
    });

    assert.equal(timers.count, 1, "arms an initial timer");
    timers.fire();
    assert.equal(seen.length, 1);
    assert.equal(timers.count, 0, "must not re-arm while a load is in flight");

    gate.resolve();
    await settle();
    assert.equal(timers.count, 1, "re-arms after the load settles");

    stop();
    assert.equal(timers.count, 0, "stop clears the pending timer");
  });

  test("reports transient errors and keeps polling", async () => {
    const timers = manualTimers();
    const errors: unknown[] = [];
    let attempts = 0;
    const stop = startTaskPolling({
      intervalMs: 3000,
      load: () => {
        attempts += 1;
        return Promise.reject(new Error(`boom ${attempts}`));
      },
      onError: (error) => errors.push(error),
      schedule: timers.schedule,
      clearSchedule: timers.clearSchedule,
    });

    timers.fire();
    await settle();
    assert.equal(errors.length, 1);
    assert.equal(timers.count, 1, "keeps polling after an error");

    timers.fire();
    await settle();
    assert.equal(errors.length, 2);

    stop();
    assert.equal(timers.count, 0);
  });

  test("stop aborts the in-flight load and suppresses its error", async () => {
    const timers = manualTimers();
    const gate = deferred();
    const seen: AbortSignal[] = [];
    const errors: unknown[] = [];
    const stop = startTaskPolling({
      intervalMs: 3000,
      load: (signal) => {
        seen.push(signal);
        return gate.promise;
      },
      onError: (error) => errors.push(error),
      schedule: timers.schedule,
      clearSchedule: timers.clearSchedule,
    });

    timers.fire();
    assert.equal(seen[0]?.aborted, false);

    stop();
    assert.equal(seen[0]?.aborted, true, "stop must abort the in-flight signal");

    gate.reject(new DOMException("The operation was aborted.", "AbortError"));
    await settle();
    assert.deepEqual(errors, [], "aborted loads must not surface as errors");
    assert.equal(timers.count, 0, "no re-arm after stop");
  });

  test("a load that resolves after stop cannot re-arm the poller", async () => {
    const timers = manualTimers();
    const gate = deferred();
    const stop = startTaskPolling({
      intervalMs: 3000,
      load: () => gate.promise,
      onError: () => assert.fail("no error expected"),
      schedule: timers.schedule,
      clearSchedule: timers.clearSchedule,
    });

    timers.fire();
    stop();
    gate.resolve();
    await settle();
    assert.equal(timers.count, 0, "stale completion must not restart polling");
  });
});
