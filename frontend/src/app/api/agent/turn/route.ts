import { NextRequest } from "next/server";
import { listSessions } from "@/features/agent/sessions-store";
import { piRuntimeManager } from "@/features/agent/pi-runtime";
import {
  parseAgentTurnRequest,
  type AgentImageInput,
  type AgentTurnCommandResult,
  type AgentTurnRequest,
} from "@/features/agent/contracts";
import { controlTargetHasActiveTurn } from "@/features/agent/runtime/selectors";
import { applyManagedOauthTokens } from "@/features/agent/oauth/managed-tokens";
import type { PiAgentSession, PiAgentStatus } from "@/features/agent/pi-runtime-types";
import { requireApiAccess } from "@/lib/auth/guard";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adoptRuntimePiSessionId(session: unknown, piSessionId: string | null | undefined) {
  const next = piSessionId?.trim();
  if (!next || !session || typeof session !== "object") return;
  const runtime = session as {
    adoptPiSessionId?: (value: string) => void;
    currentPiSessionId?: string | null;
  };
  if (typeof runtime.adoptPiSessionId === "function") {
    runtime.adoptPiSessionId(next);
  } else if (!runtime.currentPiSessionId) {
    runtime.currentPiSessionId = next;
  }
}

type ResolvedTurnSession = {
  effectivePiSessionId: string | null;
  effectiveStreamingBehavior: AgentTurnRequest["streamingBehavior"];
  controlTargetActive: boolean;
  session: PiAgentSession;
  sessionId: string;
};

function resolveTurnSession(turn: AgentTurnRequest): ResolvedTurnSession | null {
  const resolved =
    turn.mode === "prompt"
      ? { sessionId: turn.sessionId, session: piRuntimeManager.getSession(turn.sessionId) }
      : piRuntimeManager.findSessionForLookup(turn.sessionId, turn.piSessionId);
  if (!resolved) return null;
  const status = resolved.session.status;
  const controlTargetActive = controlTargetHasActiveTurn(status);
  return {
    effectivePiSessionId: effectivePiSessionId(turn, status, controlTargetActive),
    effectiveStreamingBehavior: effectiveStreamingBehavior(turn, status),
    controlTargetActive,
    session: resolved.session,
    sessionId: resolved.sessionId,
  };
}

function effectivePiSessionId(
  turn: AgentTurnRequest,
  status: PiAgentStatus,
  controlTargetActive: boolean,
) {
  if (turn.mode === "prompt") return turn.piSessionId;
  return controlTargetActive ? (status.piSessionId ?? turn.piSessionId) : turn.piSessionId;
}

function effectiveStreamingBehavior(turn: AgentTurnRequest, status: PiAgentStatus) {
  if (turn.mode === "prompt" && status.active === true) return turn.streamingBehavior ?? "steer";
  return turn.streamingBehavior;
}

async function ensurePromptRuntime(turn: AgentTurnRequest, resolved: ResolvedTurnSession) {
  const managedTokenFingerprint = await applyManagedOauthTokens();
  await resolved.session.ensureStarted(turn.modelId, turn.cwd, resolved.effectivePiSessionId, {
    browserToolEnabled: turn.browserToolEnabled,
    browserSessionId: turn.browserSessionId,
    browserBackend: turn.browserBackend,
    planSessionId: resolved.sessionId,
    canvasEnabled: turn.canvasEnabled,
    plugins: turn.plugins,
    skills: turn.skills,
    promptTemplates: turn.promptTemplates,
    managedTokenFingerprint,
  });
}

function launchPrompt(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
  commandImages: AgentImageInput[] | undefined,
) {
  void resolved.session
    .prompt(turn.message, () => undefined, {
      streamingBehavior: resolved.effectiveStreamingBehavior,
      ...(commandImages ? { images: commandImages } : {}),
    })
    .catch(() => {
      // PiSdkSession records lastError on status. The runtime event/status
      // subscriber owns user-visible recovery and replay.
    });
}

async function dispatchControl(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
  commandImages: AgentImageInput[] | undefined,
): Promise<"queued" | "rejected"> {
  if (!resolved.controlTargetActive) return "rejected";
  if (turn.mode === "steer") {
    await resolved.session.steer(turn.message, commandImages);
    return "queued";
  }
  if (turn.mode === "follow_up") {
    await resolved.session.followUp(turn.message, commandImages);
    return "queued";
  }
  return "rejected";
}

async function resolvePiSessionId(session: PiAgentSession, since: Date) {
  const status = session.status;
  if (status.piSessionId || !status.cwd) return status.piSessionId;
  const recent = await listSessions(status.cwd, { since });
  return recent[0]?.id ?? null;
}

function commandResult(
  outcome: AgentTurnCommandResult["outcome"],
  resolved: ResolvedTurnSession,
  options: { error?: string; piSessionId?: string | null } = {},
): AgentTurnCommandResult {
  const status = resolved.session.status;
  return {
    type: "command",
    outcome,
    runtimeSessionId: resolved.sessionId,
    piSessionId: options.piSessionId ?? status.piSessionId,
    active: status.active,
    status,
    ...(options.error ? { error: options.error } : {}),
  };
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const parsed = parseAgentTurnRequest(rawBody);
  if (!parsed.ok) return jsonError(parsed.error);
  const turn = parsed.value;
  const commandImages = turn.images.length ? turn.images : undefined;

  try {
    const turnStartedAt = new Date(Date.now() - 2_000);
    const resolved = resolveTurnSession(turn);
    if (!resolved) {
      const result: AgentTurnCommandResult = {
        type: "command",
        outcome: "rejected",
        runtimeSessionId: turn.sessionId,
        piSessionId: turn.piSessionId,
        active: false,
        error: "Runtime session is no longer active.",
      };
      return Response.json(result, { status: 409 });
    }

    if (turn.mode === "prompt") {
      await ensurePromptRuntime(turn, resolved);
      launchPrompt(turn, resolved, commandImages);
      const resolvedPiSessionId = await resolvePiSessionId(resolved.session, turnStartedAt);
      adoptRuntimePiSessionId(resolved.session, resolvedPiSessionId);
      return Response.json(
        commandResult(resolved.effectiveStreamingBehavior ? "queued" : "accepted", resolved, {
          piSessionId: resolvedPiSessionId,
        }),
      );
    }

    const controlOutcome = await dispatchControl(turn, resolved, commandImages);
    if (controlOutcome === "rejected") {
      return Response.json(
        commandResult("rejected", resolved, {
          error: "Runtime session is no longer active.",
        }),
        { status: 409 },
      );
    }
    return Response.json(commandResult("queued", resolved));
  } catch (error) {
    return Response.json(
      {
        type: "command",
        outcome: "rejected",
        runtimeSessionId: turn.sessionId,
        piSessionId: turn.piSessionId,
        active: false,
        error: errorMessage(error, "Pi agent turn failed"),
      } satisfies AgentTurnCommandResult,
      { status: 500 },
    );
  }
}
