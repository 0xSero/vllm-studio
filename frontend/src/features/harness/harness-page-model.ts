// Pure model logic for the Harness operator surface. Kept framework-free so the
// envelope discrimination, terminal-status contract, and polling lifecycle can
// be unit tested without React.

export type HarnessTask = {
  id?: string;
  status?: string;
  status_label?: string;
  summary?: string;
  human_title?: string;
  artifacts?: Array<{ name?: string; path?: string }>;
  events?: Array<{ seq?: number; summary?: string; checkpoint?: string }>;
  metadata?: {
    demo?: { enabled?: boolean; model_used?: boolean; workspace?: string };
    integration?: {
      kind?: string;
      route_id?: string;
      model_id?: string;
      node?: string;
      runtime?: string;
      model_used?: boolean;
      connected_workspace_mutated?: boolean;
    };
  };
};

// The Harness GUI server answers with three envelope shapes:
//   tasks/current      -> { current, tasks }
//   tasks/{id}         -> { api_version, task, owner }
//   tasks/{id}/events  -> { api_version, task_id, events }
// Older builds returned the bare task object. TaskResponse tolerates all of
// them; resolveTaskEnvelope decides which one we are looking at.
export type TaskResponse = Partial<HarnessTask> & {
  task?: HarnessTask | null;
  current?: HarnessTask | null;
  events?: HarnessTask["events"];
};

export type ManagedGoalTask = HarnessTask & {
  objective?: string;
  mode?: string;
  execution_profile?: string;
  needs_human?: boolean;
  review_status?: string;
  changed_files?: string[];
  verification?: string[];
  progress?: { label?: string; percent?: number; determinate?: boolean };
  current?: { checkpoint?: string; current_subgoal?: string; cycle?: number };
  readiness_gate?: {
    can_start?: boolean;
    can_queue?: boolean;
    state?: string;
    label?: string;
    next_action?: string;
    summary?: string;
    requires_review?: boolean;
  };
  advanced_details?: {
    payload?: { events?: HarnessTask["events"] };
    last_run?: { run_dir?: string; prompt_path?: string };
  };
};

export type ManagedTaskResponse = Partial<ManagedGoalTask> & {
  task?: ManagedGoalTask | null;
  current?: ManagedGoalTask | null;
  events?: ManagedGoalTask["events"];
};

function isTaskShaped(
  candidate: Partial<HarnessTask>,
): candidate is Partial<HarnessTask> & { id: string; status: string } {
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.status === "string" &&
    candidate.status.length > 0
  );
}

/** Explicit `task` / `current` envelopes win, in that order, but only when the
 *  value actually looks like a task (non-empty id AND status). Every valid
 *  Harness response serializes both fields, so this rejects only malformed
 *  values — `current: null` while idle, `task: {}` from a broken upstream —
 *  and lets them fall through to the next candidate instead of masking it.
 *  The top-level payload is checked last so an envelope that happens to carry
 *  a top-level id (e.g. a request id next to `current`) can never shadow the
 *  real task. */
export function resolveTaskEnvelope(payload: TaskResponse): HarnessTask | null {
  for (const candidate of [payload.task, payload.current, payload]) {
    if (candidate && isTaskShaped(candidate)) return candidate;
  }
  return null;
}

// Task statuses come from the managed and provider Harness adapters:
// done | stopped | blocked | failed | checking | starting | working. The
// durable terminal set includes provider failures because a failed worker run
// is complete evidence and must not block a fresh goal.
// Unknown/future statuses are treated as active so we keep polling — the safe
// default for states we have never seen.
export const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set([
  "complete",
  "done",
  "stopped",
  "blocked",
  "failed",
]);

export function isTerminalTaskStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_TASK_STATUSES.has(status);
}

export type GoalBackendKind = "managed" | "provider";

/** The prompt box accepts an ordinary sentence; `/goal` is an optional
 *  Codex-style prefix. Stripping it here keeps the submit path and its tests
 *  in agreement about what counts as an empty objective. */
export function stripGoalCommandPrefix(raw: string): string {
  return raw
    .trim()
    .replace(/^\/goal(?:\s+|$)/i, "")
    .trim();
}

export type GoalStartInput = {
  goal: string;
  backend: GoalBackendKind;
  /** `setup.configured` for the currently selected backend. Callers must pass
   *  `false` while the setup payload is unknown so the gate fails closed. */
  providerConfigured: boolean;
  setupLoading: boolean;
  /** Current task status for the selected shared workspace, when known. */
  activeTaskStatus?: string;
};

/** Why a goal cannot start yet, phrased for a first-time user, or null when it
 *  can. Returning a reason (instead of only disabling the button) is what makes
 *  the empty-prompt and unconfigured-provider cases explainable rather than a
 *  dead control. Provider copy stays generic: no host, path, or node names. */
export function goalStartBlocker(input: GoalStartInput): string | null {
  if (input.setupLoading) return "Loading goal setup…";
  const objective = stripGoalCommandPrefix(input.goal);
  if (!objective) {
    return input.goal.trim()
      ? "Add an objective after /goal, for example: /goal summarise the open issues."
      : "Type a goal first. You can start it with /goal.";
  }
  if (input.backend === "provider" && !input.providerConfigured) {
    return "Add an endpoint and model under Model provider, then save, before starting a goal.";
  }
  if (
    input.activeTaskStatus &&
    !isTerminalTaskStatus(input.activeTaskStatus) &&
    input.activeTaskStatus !== "needs_review" &&
    input.activeTaskStatus !== "ready"
  ) {
    return "Another goal is already running in this shared workspace. Continue or stop it before starting a new one.";
  }
  return null;
}

export type GoalOutcomeTone = "default" | "good" | "warning" | "danger";

export type GoalOutcome = {
  state: "running" | "needs_review" | "stopped" | "blocked" | "complete" | "unverified";
  tone: GoalOutcomeTone;
  headline: string;
  detail: string;
};

/** Plain-language terminal state for the goal card.
 *
 *  Completion honesty: "verified" is only claimed when the Harness actually
 *  recorded verification checks on the task. A `done` task with no checks is
 *  reported as finished-but-unverified, never as verified, so UI prose can
 *  never outrun the evidence contract. Check counts are described as
 *  "recorded" because the task payload carries the checks, not their verdicts. */
export function describeGoalOutcome(task: ManagedGoalTask | null): GoalOutcome | null {
  if (!task?.id) return null;
  const status = task.status ?? "";
  const summary = task.summary?.trim();
  const checks = task.verification?.length ?? 0;
  const files = task.changed_files?.length ?? 0;

  if (status === "done" || status === "complete") {
    if (checks === 0) {
      return {
        state: "unverified",
        tone: "warning",
        headline: "Finished without verification evidence",
        detail:
          summary ??
          "The harness recorded no verification checks for this goal, so it is not a verified completion.",
      };
    }
    return {
      state: "complete",
      tone: "good",
      headline: "Goal complete with recorded evidence",
      detail: `${checks} verification check${checks === 1 ? "" : "s"} recorded · ${files} changed file${
        files === 1 ? "" : "s"
      }.`,
    };
  }
  if (status === "stopped") {
    return {
      state: "stopped",
      tone: "warning",
      headline: "Goal stopped",
      detail: summary ?? "This goal was stopped before it finished. Start a new goal to continue.",
    };
  }
  if (status === "blocked") {
    return {
      state: "blocked",
      tone: "danger",
      headline: "Goal blocked",
      detail:
        summary ?? "The harness could not continue. Add feedback below and continue the goal.",
    };
  }
  if (status === "failed") {
    return {
      state: "blocked",
      tone: "danger",
      headline: "Goal failed",
      detail:
        summary ?? "The provider could not complete this goal. Start a new goal to try again.",
    };
  }
  if (status === "needs_review") {
    return {
      state: "needs_review",
      tone: "warning",
      headline: "Waiting for your review",
      detail: summary ?? "The harness finished a cycle and needs your decision before continuing.",
    };
  }
  return {
    state: "running",
    tone: "default",
    headline: task.progress?.label ?? task.current?.checkpoint ?? "Working",
    detail: summary ?? "The harness is working on this goal.",
  };
}

export type TaskPollerOptions = {
  intervalMs: number;
  /** Load one refresh. Receives the poller's AbortSignal; implementations must
   *  pass it to fetch and stop touching state once it is aborted. */
  load: (signal: AbortSignal) => Promise<void>;
  /** Called for load failures, except aborts caused by stopping the poller. */
  onError: (error: unknown) => void;
  /** Injectable timers for tests. Default to window timers in the browser. */
  schedule?: (fn: () => void, ms: number) => number;
  clearSchedule?: (id: number) => void;
};

/** Serialized task polling: each cycle waits for the previous load to settle
 *  before arming the next timer, so requests never overlap; a failed load
 *  reports the error and keeps polling. The returned stop function clears any
 *  pending timer, aborts an in-flight load, and guarantees no re-arm and no
 *  error report afterwards. */
export function startTaskPolling(options: TaskPollerOptions): () => void {
  const schedule = options.schedule ?? ((fn, ms) => window.setTimeout(fn, ms));
  const clearSchedule = options.clearSchedule ?? ((id) => window.clearTimeout(id));
  const controller = new AbortController();
  let timer: number | undefined;
  let stopped = false;

  const tick = async (): Promise<void> => {
    try {
      await options.load(controller.signal);
    } catch (error) {
      if (!stopped && !controller.signal.aborted) options.onError(error);
    }
    if (!stopped) arm();
  };
  const arm = (): void => {
    timer = schedule(() => void tick(), options.intervalMs);
  };
  arm();

  return () => {
    stopped = true;
    controller.abort();
    if (timer !== undefined) clearSchedule(timer);
  };
}
