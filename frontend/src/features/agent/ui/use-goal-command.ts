"use client";

import { useCallback, useState } from "react";
import { clearSessionGoal, updateSessionGoal } from "@/features/agent/runtime/api";

export function canRunGoalCommand(piSessionId: string | null): piSessionId is string {
  return Boolean(piSessionId);
}

/** Backs the `/goal` composer command.
 *
 * `revision` bumps on every successful mutation so the composer drawer's goal
 * poll refreshes immediately instead of waiting out its interval. The action
 * returns a message on failure and null on success, which is the contract the
 * command registry expects. */
export function useGoalCommand(piSessionId: string | null): {
  goalRevision: number;
  goalAction: (args: string) => Promise<string | null>;
} {
  const [goalRevision, setGoalRevision] = useState(0);

  const goalAction = useCallback(
    async (args: string): Promise<string | null> => {
      if (!canRunGoalCommand(piSessionId))
        return "Send a first message, then set a goal for this session.";
      if (!args) return "Usage: /goal <objective> — or /goal pause · resume · clear";
      const verb = args.split(/\s+/)[0]?.toLowerCase() ?? "";
      try {
        if (verb === "clear") {
          await clearSessionGoal(piSessionId);
        } else if (verb === "pause" || verb === "resume") {
          await updateSessionGoal(piSessionId, { status: verb === "pause" ? "paused" : "active" });
        } else {
          await updateSessionGoal(piSessionId, {
            objective: args,
            status: "active",
            resetTurns: true,
          });
        }
        setGoalRevision((value) => value + 1);
        return null;
      } catch {
        return "Failed to update the goal.";
      }
    },
    [piSessionId],
  );

  return { goalRevision, goalAction };
}
