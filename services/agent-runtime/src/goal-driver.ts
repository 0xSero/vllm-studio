import { isAgentSettledEvent } from "../../../shared/agent/pi-events";
import { goalContinuationPrompt, goalOutcomeFromText } from "../../../shared/agent/goal-protocol";
import { Schema } from "effect";
import type { LoggedPiEvent, PiAgentSession } from "./pi-runtime-types";
import { readGoal, writeGoal, type GoalWritePatch } from "./goals-store";
import { assistantMessageText } from "./session-text";

const CONTINUATION_GRACE_MS = 2000;

const AssistantEventSchema = Schema.Struct({
  type: Schema.Literals(["message", "message_end"]),
  message: Schema.Struct({
    role: Schema.Literal("assistant"),
    content: Schema.Unknown,
  }),
});

type DriverState = {
  sawToolThisTurn: boolean;
  assistantText: string;
  lastTurnWasContinuation: boolean;
  aborted: boolean;
  runStartedAtMs: number | null;
  pendingContinuation: boolean;
};

const driverStates = new WeakMap<PiAgentSession, DriverState>();

export function markGoalTurnAborted(session: PiAgentSession): void {
  const state = driverStates.get(session);
  if (state) state.aborted = true;
}

function eventTouchesTools(event: LoggedPiEvent["event"]): boolean {
  const type = event.type ?? "";
  return type.includes("tool");
}

function assistantTextFromEvent(event: LoggedPiEvent["event"]): string {
  const decoded = Schema.decodeUnknownOption(AssistantEventSchema)(event);
  return decoded._tag === "Some" ? assistantMessageText(decoded.value.message.content) : "";
}

async function openGoalRun(session: PiAgentSession): Promise<void> {
  try {
    const piSessionId = session.status.piSessionId;
    if (!piSessionId) return;
    const goal = await readGoal(piSessionId);
    if (!goal || goal.status !== "active") return;
    await writeGoal(piSessionId, { activeRunStartedAt: new Date().toISOString() });
  } catch {}
}

type GoalTurn = {
  aborted: boolean;
  wasContinuation: boolean;
  hadTools: boolean;
  assistantText: string;
  runSeconds: number;
};

function takeTurn(state: DriverState): GoalTurn {
  const runSeconds = state.runStartedAtMs === null ? 0 : (Date.now() - state.runStartedAtMs) / 1000;
  const turn = {
    aborted: state.aborted,
    wasContinuation: state.lastTurnWasContinuation,
    hadTools: state.sawToolThisTurn,
    assistantText: state.assistantText,
    runSeconds,
  };
  state.aborted = false;
  state.lastTurnWasContinuation = false;
  state.sawToolThisTurn = false;
  state.assistantText = "";
  state.runStartedAtMs = null;
  return turn;
}

async function settleGoalAfterTurn(session: PiAgentSession, state: DriverState): Promise<void> {
  const status = session.status;
  const piSessionId = status.piSessionId;
  const turn = takeTurn(state);
  if (!piSessionId) return;
  const goal = await readGoal(piSessionId);
  if (!goal) return;

  const banked = {
    timeUsedSeconds: goal.timeUsedSeconds + turn.runSeconds,
    activeRunStartedAt: null,
  } satisfies GoalWritePatch;
  const settle = (patch: GoalWritePatch) => writeGoal(piSessionId, { ...banked, ...patch });

  if (goal.status !== "active") {
    if (turn.runSeconds > 0 || goal.activeRunStartedAt) await writeGoal(piSessionId, banked);
    return;
  }

  if (turn.aborted || status.lastError) {
    await settle({ status: "paused" });
    return;
  }

  const outcome = goalOutcomeFromText(turn.assistantText);
  if (outcome) {
    await settle({ status: outcome.kind === "complete" ? "complete" : "blocked" });
    return;
  }

  const turnsUsed = goal.turnsUsed + 1;
  if (goal.turnBudget !== null && turnsUsed >= goal.turnBudget) {
    await settle({ turnsUsed, status: "budget_limited" });
    return;
  }
  if (turn.wasContinuation && !turn.hadTools) {
    await settle({ turnsUsed, status: "paused" });
    return;
  }
  await settle({ turnsUsed });
  if (!state.pendingContinuation) scheduleContinuation(session, state, piSessionId);
}

function scheduleContinuation(
  session: PiAgentSession,
  state: DriverState,
  piSessionId: string,
): void {
  state.pendingContinuation = true;
  setTimeout(() => {
    void (async () => {
      try {
        const current = session.status;
        if (current.active || current.piSessionId !== piSessionId) return;
        const liveGoal = await readGoal(piSessionId);
        if (!liveGoal || liveGoal.status !== "active") return;
        state.lastTurnWasContinuation = true;
        state.sawToolThisTurn = false;
        state.assistantText = "";
        await session.prompt(goalContinuationPrompt(liveGoal.objective), () => {});
      } catch {
      } finally {
        state.pendingContinuation = false;
      }
    })();
  }, CONTINUATION_GRACE_MS);
}

export function attachGoalDriver(session: PiAgentSession): void {
  const state: DriverState = {
    sawToolThisTurn: false,
    assistantText: "",
    lastTurnWasContinuation: false,
    aborted: false,
    runStartedAtMs: null,
    pendingContinuation: false,
  };
  driverStates.set(session, state);
  session.onLoggedEvent((logged) => {
    const type = logged.event.type ?? "";
    if (type === "agent_start") {
      state.sawToolThisTurn = false;
      state.assistantText = "";
      state.aborted = false;
      state.runStartedAtMs = Date.now();
      void openGoalRun(session);
      return;
    }
    if (eventTouchesTools(logged.event)) {
      state.sawToolThisTurn = true;
      return;
    }
    state.assistantText += assistantTextFromEvent(logged.event);
    if (isAgentSettledEvent(logged.event)) {
      void settleGoalAfterTurn(session, state);
    }
  });
}
