import { NextRequest } from "next/server";
import { Effect } from "effect";
import { listSessions } from "@local-studio/agent-runtime/sessions-store";
import { piRuntimeManager } from "@local-studio/agent-runtime/pi-runtime";
import {
  parseAgentTurnRequest,
  type AgentImageInput,
  type AgentTurnCommandResult,
  type AgentTurnRequest,
} from "@/features/agent/contracts";
import { controlTargetHasActiveTurn } from "@/features/agent/runtime/selectors";
import type { PiAgentSession, PiAgentStatus } from "@local-studio/agent-runtime/pi-runtime-types";
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

function ensurePromptRuntimeEffect(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
): Effect.Effect<void, unknown> {
  return Effect.tryPromise({
    try: () =>
      resolved.session.ensureStarted(turn.modelId, turn.cwd, resolved.effectivePiSessionId, {
        browserToolEnabled: turn.browserToolEnabled,
        browserSessionId: turn.browserSessionId,
        browserBackend: turn.browserBackend,
        planSessionId: resolved.sessionId,
        canvasEnabled: turn.canvasEnabled,
        skills: turn.skills,
        promptTemplates: turn.promptTemplates,
      }),
    catch: (error) => error,
  });
}

function launchPrompt(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
  commandImages: AgentImageInput[] | undefined,
) {
  void Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        resolved.session.prompt(turn.message, () => undefined, {
          streamingBehavior: resolved.effectiveStreamingBehavior,
          ...(commandImages ? { images: commandImages } : {}),
        }),
      catch: (error) => error,
    }).pipe(Effect.catch(() => Effect.void)),
  );
}

function dispatchControlEffect(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
  commandImages: AgentImageInput[] | undefined,
): Effect.Effect<"queued" | "rejected", unknown> {
  if (!resolved.controlTargetActive) return Effect.succeed("rejected");
  if (turn.mode === "steer") {
    return Effect.tryPromise({
      try: () => resolved.session.steer(turn.message, commandImages),
      catch: (error) => error,
    }).pipe(Effect.map(() => "queued" as const));
  }
  if (turn.mode === "follow_up") {
    return Effect.tryPromise({
      try: () => resolved.session.followUp(turn.message, commandImages),
      catch: (error) => error,
    }).pipe(Effect.map(() => "queued" as const));
  }
  return Effect.succeed("rejected");
}

function resolvePiSessionIdEffect(
  session: PiAgentSession,
  since: Date,
): Effect.Effect<string | null, unknown> {
  const status = session.status;
  if (status.piSessionId || !status.cwd) return Effect.succeed(status.piSessionId);
  return Effect.tryPromise({
    try: () => listSessions(status.cwd, { since }),
    catch: (error) => error,
  }).pipe(Effect.map((recent) => recent[0]?.id ?? null));
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

export function POST(request: NextRequest): Promise<Response> {
  return Effect.runPromise(turnRouteEffect(request));
}

function turnRouteEffect(request: NextRequest): Effect.Effect<Response, unknown> {
  const denied = requireApiAccess(request);
  if (denied) return Effect.succeed(denied);
  return Effect.gen(function* () {
    const rawBody = yield* Effect.tryPromise({
      try: () => request.json(),
      catch: () => null,
    });
    if (!rawBody) return jsonError("Invalid JSON body");
    const parsed = parseAgentTurnRequest(rawBody);
    if (!parsed.ok) return jsonError(parsed.error);
    const turn = parsed.value;
    const commandImages = turn.images.length ? turn.images : undefined;

    return yield* Effect.gen(function* () {
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
        yield* ensurePromptRuntimeEffect(turn, resolved);
        launchPrompt(turn, resolved, commandImages);
        const resolvedPiSessionId = yield* resolvePiSessionIdEffect(
          resolved.session,
          turnStartedAt,
        );
        adoptRuntimePiSessionId(resolved.session, resolvedPiSessionId);
        return Response.json(
          commandResult(resolved.effectiveStreamingBehavior ? "queued" : "accepted", resolved, {
            piSessionId: resolvedPiSessionId,
          }),
        );
      }

      const controlOutcome = yield* dispatchControlEffect(turn, resolved, commandImages);
      if (controlOutcome === "rejected") {
        return Response.json(
          commandResult("rejected", resolved, {
            error: "Runtime session is no longer active.",
          }),
          { status: 409 },
        );
      }
      return Response.json(commandResult("queued", resolved));
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          Response.json(
            {
              type: "command",
              outcome: "rejected",
              runtimeSessionId: turn.sessionId,
              piSessionId: turn.piSessionId,
              active: false,
              error: errorMessage(error, "Pi agent turn failed"),
            } satisfies AgentTurnCommandResult,
            { status: 500 },
          ),
        ),
      ),
    );
  });
}
