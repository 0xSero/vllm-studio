"use client";

import { useCallback, useRef, useState } from "react";
import { clearSessionGoal, updateSessionGoal } from "@/features/agent/runtime/api";

/** Verbs that act on a goal that must already exist server-side. */
const GOAL_STATE_VERBS = new Set(["clear", "pause", "resume"]);

/** Backs the `/goal` composer command.
 *
 * `revision` bumps on every successful mutation so the composer drawer's goal
 * poll refreshes immediately instead of waiting out its interval. The action
 * returns a message on failure and null on success, which is the contract the
 * command registry expects.
 *
 * A brand-new chat has no piSessionId until its first turn response comes back,
 * and every goal write is keyed by that id. Rather than refuse the write — the
 * new-chat composer is the natural place to set a goal — an objective set that
 * early is held here and written by `flushPendingGoal` the moment the session
 * earns its id. */
export function useGoalCommand(piSessionId: string | null): {
  goalRevision: number;
  goalAction: (args: string) => Promise<string | null>;
  flushPendingGoal: (piSessionId: string) => void;
} {
  const [goalRevision, setGoalRevision] = useState(0);
  const pendingObjectiveRef = useRef<string | null>(null);

  const writeObjective = useCallback(async (sessionId: string, objective: string) => {
    await updateSessionGoal(sessionId, { objective, status: "active", resetTurns: true });
    setGoalRevision((value) => value + 1);
  }, []);

  const goalAction = useCallback(
    async (args: string): Promise<string | null> => {
      if (!args) return "Usage: /goal <objective> — or /goal pause · resume · clear";
      const verb = args.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (!piSessionId) {
        // Nothing to pause, resume or clear before the session exists.
        if (GOAL_STATE_VERBS.has(verb))
          return "Send a first message, then set a goal for this session.";
        pendingObjectiveRef.current = args;
        return null;
      }
      try {
        if (verb === "clear") {
          await clearSessionGoal(piSessionId);
          setGoalRevision((value) => value + 1);
        } else if (verb === "pause" || verb === "resume") {
          await updateSessionGoal(piSessionId, { status: verb === "pause" ? "paused" : "active" });
          setGoalRevision((value) => value + 1);
        } else {
          await writeObjective(piSessionId, args);
        }
        return null;
      } catch {
        return "Failed to update the goal.";
      }
    },
    [piSessionId, writeObjective],
  );

  const flushPendingGoal = useCallback(
    (sessionId: string) => {
      const objective = pendingObjectiveRef.current;
      if (!objective) return;
      pendingObjectiveRef.current = null;
      // Keep the objective queued if the write fails so the next id assignment
      // (a retry, a reattach) still lands it.
      void writeObjective(sessionId, objective).catch(() => {
        pendingObjectiveRef.current ??= objective;
      });
    },
    [writeObjective],
  );

  return { goalRevision, goalAction, flushPendingGoal };
}
