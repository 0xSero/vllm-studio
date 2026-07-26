// Session goal for Local Studio.
//
// `/goal <objective>` stores an objective per pi session, and goal-driver.ts
// re-prompts the agent whenever it settles. Without this extension the model
// only ever saw the objective inside those synthetic continuation prompts — on
// a turn the user typed themselves it had no idea a goal existed. This puts the
// objective in the system prompt of EVERY turn, so the goal actually steers the
// session instead of only nudging it between turns.
//
// Extensions run sandboxed from the runtime's own modules, so the goal store is
// read straight off disk rather than imported.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MARKER = "Local Studio session goal:";

/** Statuses where the goal should steer the turn. A paused/complete/blocked
 *  goal stays in the store (so the UI can show and resume it) but must not keep
 *  pushing the model. */
const STEERING_STATUSES = new Set(["active", "budget_limited"]);

type SessionGoal = {
  objective?: unknown;
  status?: unknown;
  turnBudget?: unknown;
  turnsUsed?: unknown;
};

/** Mirrors goals-store.ts: <dataDir>/goals/<piSessionId>.json, where dataDir is
 *  LOCAL_STUDIO_DATA_DIR (Electron userData) or ~/.local-studio. Read straight
 *  from disk rather than over HTTP — the extension runs in the runtime process
 *  on the same host, so a file read removes the app server, its auth boundary
 *  and its host allowlist as failure modes, and keeps working if it is down. */
function readGoal(piSessionId: string): SessionGoal | null {
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(piSessionId)) return null;
  const dataDir = process.env.LOCAL_STUDIO_DATA_DIR?.trim() || path.join(homedir(), ".local-studio");
  try {
    const raw = readFileSync(path.join(dataDir, "goals", `${piSessionId}.json`), "utf8");
    return JSON.parse(raw) as SessionGoal;
  } catch {
    // No goal for this session (the common case) — stay silent.
    return null;
  }
}

/** Codex wraps the objective in tags and states plainly that it is instruction,
 *  not data, then reports budget so the model can pace itself. */
export function goalSystemPromptSection(goal: SessionGoal): string | null {
  const objective = typeof goal.objective === "string" ? goal.objective.trim() : "";
  if (!objective) return null;
  const status = typeof goal.status === "string" ? goal.status : "active";
  if (!STEERING_STATUSES.has(status)) return null;

  const lines = [
    MARKER,
    "You are working toward a standing objective for this session. It applies to",
    "every turn, including ones the user starts. Keep it in view when you decide",
    "what to do next, and prefer work that advances it.",
    "",
    `<objective>${objective}</objective>`,
  ];

  const turnsUsed = typeof goal.turnsUsed === "number" ? goal.turnsUsed : 0;
  const turnBudget = typeof goal.turnBudget === "number" ? goal.turnBudget : null;
  if (turnBudget !== null) {
    lines.push("", `Turn budget: ${turnsUsed} of ${turnBudget} used.`);
    if (status === "budget_limited") {
      lines.push("The budget is spent. Summarise progress and what remains; do not start new work.");
    }
  } else if (turnsUsed > 0) {
    lines.push("", `Turns spent on this goal so far: ${turnsUsed}.`);
  }

  lines.push(
    "",
    "Before claiming the objective is met, audit it against concrete evidence —",
    "files written, command output, tests run — not intent. Say GOAL_COMPLETE only",
    "when that evidence exists, and GOAL_BLOCKED with the reason only when you",
    "genuinely cannot proceed.",
  );

  return lines.join("\n");
}

export default function goalExtension(pi: ExtensionAPI): void {
  let cachedSessionId: string | null = null;

  const sessionIdFrom = (ctx: { sessionManager?: { getSessionId?: () => string | null } }) => {
    try {
      const live = ctx.sessionManager?.getSessionId?.() ?? null;
      if (live) cachedSessionId = live;
    } catch {
      // fall through to whatever was cached
    }
    return cachedSessionId;
  };

  // Cache opportunistically, but never depend on session_start having produced
  // an id — it fires before the rollout file exists on some paths, and a null
  // there used to silently disable goal steering for the whole session.
  pi.on("session_start", (_event, ctx) => {
    sessionIdFrom(ctx);
  });

  pi.on("before_agent_start", (event, ctx) => {
    const sessionId = sessionIdFrom(ctx);
    if (!sessionId) return {};
    // Re-read every turn: the goal is mutable from the composer mid-session, so
    // anything cached at session start would go stale.
    const goal = readGoal(sessionId);
    if (!goal) return {};
    const section = goalSystemPromptSection(goal);
    if (!section) return {};
    if (event.systemPrompt.includes(MARKER)) return {};
    return { systemPrompt: `${event.systemPrompt.trimEnd()}\n\n${section}` };
  });
}
