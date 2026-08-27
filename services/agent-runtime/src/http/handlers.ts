import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Option, Schema } from "effect";
import {
  controlTargetHasActiveTurn,
  isAgentThinkingLevel,
  parseAgentTurnRequest,
  type AgentThinkingLevel,
  type AgentTurnCommandResult,
  type AgentTurnRequest,
} from "../../../../shared/agent/agent-turn";
import type { AgentImageInput } from "../../../../shared/agent/agent-image-input";
import {
  AGENT_TURN_BODY_LIMIT_BYTES,
  readJsonRequestWithinLimit,
} from "../../../../shared/agent/agent-turn-body";
import {
  sanitizeComposerPromptTemplates,
  sanitizeComposerSkills,
  selectedContextInstructions,
  type ComposerSkillRef,
} from "../../../../shared/agent/composer-refs";
import { isAgentSettledEvent } from "../../../../shared/agent/pi-events";
import { markGoalTurnAborted } from "../goal-driver";
import { piResourceDiagnostics, piRuntimeManager } from "../pi-runtime";
import type { LoggedPiEvent, PiAgentSession, PiAgentStatus } from "../pi-runtime-types";
import { listSessions } from "../sessions-store";
import { sessionListChangedVersion, subscribeSessionListChanged } from "../session-list-changed";
import { errorMessage, jsonError } from "./helpers";
import { sseResponse } from "./sse";

function adoptRuntimePiSessionId(
  session: PiAgentSession,
  piSessionId: string | null | undefined,
): void {
  const next = piSessionId?.trim();
  if (next) session.adoptPiSessionId(next);
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
      ? piRuntimeManager.getSessionForLookup(turn.sessionId, turn.piSessionId)
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

async function dispatchControl(
  turn: AgentTurnRequest,
  resolved: ResolvedTurnSession,
  images?: AgentImageInput[],
): Promise<"queued" | "rejected"> {
  if (!resolved.controlTargetActive) return "rejected";
  if (turn.queueAction) {
    await resolved.session.mutateQueuedFollowUp(
      turn.message,
      turn.queueAction,
      turn.queueReplacement,
      images,
    );
  } else if (turn.mode === "steer") {
    await resolved.session.steer(turn.message, images);
  } else if (turn.mode === "follow_up") {
    await resolved.session.followUp(turn.message, images);
  } else return "rejected";
  return "queued";
}

async function resolvePiSessionId(session: PiAgentSession, since: Date): Promise<string | null> {
  const { piSessionId, cwd } = session.status;
  return piSessionId || !cwd ? piSessionId : ((await listSessions(cwd, { since }))[0]?.id ?? null);
}

function commandResult(
  outcome: AgentTurnCommandResult["outcome"],
  resolved: ResolvedTurnSession,
  options: { error?: string; piSessionId?: string | null } = {},
): AgentTurnCommandResult {
  const status = resolved.session.status;
  const result: AgentTurnCommandResult = {
    type: "command",
    outcome,
    runtimeSessionId: resolved.sessionId,
    piSessionId: options.piSessionId ?? status.piSessionId,
    active: status.active,
    status,
  };
  if (options.error) result.error = options.error;
  return result;
}

export async function handleAgentTurn(request: Request): Promise<Response> {
  const body = await readJsonRequestWithinLimit(request, AGENT_TURN_BODY_LIMIT_BYTES);
  if (!body.ok) return jsonError(body.error, body.status);
  const parsed = parseAgentTurnRequest(body.value);
  if (!parsed.ok) return jsonError(parsed.error);
  const turn = parsed.value;
  const resolved = resolveTurnSession(turn);
  if (!resolved) {
    return Response.json(
      {
        type: "command",
        outcome: "rejected",
        runtimeSessionId: turn.sessionId,
        piSessionId: turn.piSessionId,
        active: false,
        error: "Runtime session is no longer active.",
      } satisfies AgentTurnCommandResult,
      { status: 409 },
    );
  }
  try {
    const images = turn.images.length ? turn.images : undefined;
    if (turn.mode === "prompt") {
      const startedAt = new Date(Date.now() - 2_000);
      await resolved.session.ensureStarted(turn.modelId, turn.cwd, resolved.effectivePiSessionId, {
        thinkingLevel: turn.thinkingLevel,
        toolAccess: turn.toolAccess,
        browserToolEnabled: turn.browserToolEnabled,
        browserSessionId: turn.browserSessionId,
        browserBackend: turn.browserBackend,
        skills: turn.skills,
        promptTemplates: turn.promptTemplates,
      });
      const promptOptions: Parameters<PiAgentSession["prompt"]>[2] = {
        streamingBehavior: resolved.effectiveStreamingBehavior,
      };
      if (images) promptOptions.images = images;
      void resolved.session
        .prompt(turn.message, () => undefined, promptOptions)
        .catch(() => undefined);
      const piSessionId = await resolvePiSessionId(resolved.session, startedAt);
      adoptRuntimePiSessionId(resolved.session, piSessionId);
      return Response.json(
        commandResult(resolved.effectiveStreamingBehavior ? "queued" : "accepted", resolved, {
          piSessionId,
        }),
      );
    }
    if ((await dispatchControl(turn, resolved, images)) === "rejected") {
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

const AgentAbortRequestSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
});

export async function handleAgentAbort(request: Request): Promise<Response> {
  const rawBody = await request.json().catch(() => null);
  const body = Option.getOrNull(Schema.decodeUnknownOption(AgentAbortRequestSchema)(rawBody));
  const sessionId = body?.sessionId?.trim() || "default";
  const session = piRuntimeManager.getSession(sessionId);
  markGoalTurnAborted(session);
  const cleared = await session.abort();
  return Response.json({ ok: true, cleared });
}

const ExtensionUiRequestSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  requestId: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  confirmed: Schema.optional(Schema.Boolean),
  cancelled: Schema.optional(Schema.Boolean),
});

type ExtensionUiResponse = {
  value?: string;
  confirmed?: boolean;
  cancelled: boolean;
};

export async function handleExtensionUiResponse(request: Request): Promise<Response> {
  const rawBody = await request.json().catch(() => null);
  const body = Option.getOrNull(Schema.decodeUnknownOption(ExtensionUiRequestSchema)(rawBody));
  if (!body) return jsonError("sessionId and requestId are required");
  const sessionId = body.sessionId?.trim() ?? "";
  const requestId = body.requestId?.trim() ?? "";
  if (!sessionId || !requestId) return jsonError("sessionId and requestId are required");
  const resolved = piRuntimeManager.findSessionForLookup(sessionId);
  if (!resolved) return jsonError("Runtime session not found", 404);
  const response: ExtensionUiResponse = {
    cancelled: body.cancelled === true,
  };
  if (body.value !== undefined) response.value = body.value.slice(0, 32_000);
  if (body.confirmed !== undefined) response.confirmed = body.confirmed;
  const accepted = resolved.session.respondExtensionUi(requestId, response);
  return accepted
    ? Response.json({ ok: true })
    : jsonError("Extension request is no longer active", 409);
}

const CompactRequestSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  modelId: Schema.optional(Schema.String),
  thinkingLevel: Schema.optional(Schema.String),
  toolAccess: Schema.optional(Schema.Literals(["read_only", "full"])),
  cwd: Schema.optional(Schema.String),
  piSessionId: Schema.optional(Schema.NullOr(Schema.String)),
  customInstructions: Schema.optional(Schema.String),
  browserToolEnabled: Schema.optional(Schema.Boolean),
  browserSessionId: Schema.optional(Schema.String),
  browserBackend: Schema.optional(Schema.Literals(["embedded", "chrome"])),
  skills: Schema.optional(Schema.Unknown),
  promptTemplates: Schema.optional(Schema.Unknown),
});
type CompactRequest = typeof CompactRequestSchema.Type;

function compactInstructions(skills: ComposerSkillRef[], custom?: string): string | undefined {
  const selected = selectedContextInstructions(skills);
  let extra = custom?.trim() || "";
  if (selected && extra) {
    if (selected.includes(extra)) extra = "";
    else if (extra.includes(selected)) extra = extra.replace(selected, "").trim();
  }
  const additional = extra ? `Additional compaction instructions:\n${extra}` : null;
  return [selected, additional].filter((value): value is string => Boolean(value)).join("\n\n");
}

async function compactSession(
  body: CompactRequest,
  modelId: string,
  thinkingLevel: AgentThinkingLevel | undefined,
): Promise<Response> {
  const session = piRuntimeManager.getSession(body.sessionId?.trim() || "default");
  const skills = sanitizeComposerSkills(body.skills);
  const promptTemplates = sanitizeComposerPromptTemplates(body.promptTemplates);
  await session.ensureStarted(
    modelId,
    body.cwd?.trim() || undefined,
    body.piSessionId?.trim() || null,
    {
      thinkingLevel,
      toolAccess: body.toolAccess === "full" ? "full" : "read_only",
      browserToolEnabled: body.browserToolEnabled === true,
      browserSessionId: body.browserSessionId?.trim() || undefined,
      browserBackend: body.browserBackend === "chrome" ? "chrome" : "embedded",
      skills,
      promptTemplates,
    },
  );
  const result = await session.compact(compactInstructions(skills, body.customInstructions));
  return Response.json({ ok: true, result, status: session.status });
}

export async function handleAgentCompact(request: Request): Promise<Response> {
  const rawBody = await request.json().catch(() => null);
  const body: CompactRequest | null = Option.getOrNull(
    Schema.decodeUnknownOption(CompactRequestSchema)(rawBody),
  );
  if (!body) return jsonError("Invalid JSON body");
  const modelId = body.modelId?.trim();
  if (!modelId) return jsonError("modelId is required");
  if (body.thinkingLevel !== undefined && !isAgentThinkingLevel(body.thinkingLevel)) {
    return jsonError("thinkingLevel must be a supported reasoning level");
  }
  let thinkingLevel: AgentThinkingLevel | undefined;
  if (body.thinkingLevel !== undefined) thinkingLevel = body.thinkingLevel;
  try {
    return await compactSession(body, modelId, thinkingLevel);
  } catch (error) {
    return jsonError(errorMessage(error, "Compaction failed"), 409);
  }
}

export function handleRuntimeSessions(): Response {
  return Response.json({
    sessions: piRuntimeManager
      .listSessions()
      .map(({ sessionId, session }) => ({ sessionId, status: session.status })),
  });
}

function initialRuntimeStatusPhase(
  active: boolean,
  replayBacklogCount: number,
): "running" | "idle" | null {
  if (active) return "running";
  return replayBacklogCount === 0 ? "idle" : null;
}

function replayAfterCursor(requestedAfter: number, runtimeEventSeq: number): number {
  return requestedAfter > runtimeEventSeq ? 0 : requestedAfter;
}

function shouldSendTrailingIdleStatus({
  active,
  replayBacklogCount,
  sentTerminalStatus,
}: {
  active: boolean;
  replayBacklogCount: number;
  sentTerminalStatus: boolean;
}): boolean {
  return !active && replayBacklogCount > 0 && !sentTerminalStatus;
}

export function handleRuntimeStatus(request: Request): Response {
  const searchParams = new URL(request.url).searchParams;
  const sessionId = searchParams.get("sessionId")?.trim() || "default";
  const piSessionId = searchParams.get("piSessionId")?.trim() || null;
  const after = Number(searchParams.get("after") ?? 0);
  const resolved = piRuntimeManager.findSessionForLookup(sessionId, piSessionId);
  if (!resolved) {
    return Response.json({ sessionId, status: null, events: [] });
  }
  const afterSeq = replayAfterCursor(
    Number.isFinite(after) ? after : 0,
    resolved.session.status.eventSeq,
  );
  return Response.json({
    sessionId: resolved.sessionId,
    status: resolved.session.status,
    events: resolved.session.getEventsAfter(afterSeq),
  });
}

function parseSeq(value: string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

type RuntimeStreamPayload =
  | { type: "pi"; seq: number; event: LoggedPiEvent["event"] }
  | { type: "status"; phase: "done" | "idle" | "running"; session: PiAgentStatus };

function encode(payload: RuntimeStreamPayload, id?: number): string {
  const prefix = id === undefined ? "" : `id: ${id}\n`;
  return `${prefix}data: ${JSON.stringify(payload)}\n\n`;
}

export function handleRuntimeEvents(request: Request): Response {
  const searchParams = new URL(request.url).searchParams;
  const sessionId = searchParams.get("sessionId")?.trim() || "default";
  const piSessionId = searchParams.get("piSessionId")?.trim() || null;
  const requestedAfter = Math.max(
    parseSeq(searchParams.get("after")),
    parseSeq(request.headers.get("last-event-id")),
  );
  const resolved = piRuntimeManager.findSessionForLookup(sessionId, piSessionId);
  if (!resolved) {
    return Response.json({ error: "Runtime session not found" }, { status: 404 });
  }
  const session = resolved.session;

  return sseResponse({
    signal: request.signal,
    start(send, close) {
      let off = () => {};
      let ping: ReturnType<typeof setInterval> | null = null;
      let replaying = true;
      const replayQueue: LoggedPiEvent[] = [];
      const sentSeqs = new Set<number>();
      let after = replayAfterCursor(requestedAfter, session.status.eventSeq);
      const safeSend = (payload: RuntimeStreamPayload, id?: number) => {
        send(encode(payload, id));
      };

      const sendLogged = (logged: LoggedPiEvent) => {
        after = replayAfterCursor(after, session.status.eventSeq);
        if (logged.seq <= after || sentSeqs.has(logged.seq)) return;
        sentSeqs.add(logged.seq);
        safeSend({ type: "pi", seq: logged.seq, event: logged.event }, logged.seq);
        if (isAgentSettledEvent(logged.event)) {
          safeSend({ type: "status", phase: "done", session: session.status });
          setTimeout(close, 25);
        }
      };
      const onLiveEvent = (logged: LoggedPiEvent) => {
        if (replaying) {
          replayQueue.push(logged);
          return;
        }
        sendLogged(logged);
      };

      off = session.onLoggedEvent(onLiveEvent);
      const backlog = session.getEventsAfter(after);
      const initialPhase = initialRuntimeStatusPhase(session.status.active, backlog.length);
      if (initialPhase) {
        safeSend({
          type: "status",
          phase: initialPhase,
          session: session.status,
        });
      }
      let sentTerminalStatus = false;
      for (const logged of backlog) {
        sendLogged(logged);
        if (isAgentSettledEvent(logged.event)) sentTerminalStatus = true;
      }
      replaying = false;
      for (const logged of replayQueue) {
        sendLogged(logged);
        if (isAgentSettledEvent(logged.event)) sentTerminalStatus = true;
      }
      if (
        shouldSendTrailingIdleStatus({
          active: session.status.active,
          replayBacklogCount: backlog.length + replayQueue.length,
          sentTerminalStatus,
        })
      ) {
        safeSend({ type: "status", phase: "idle", session: session.status });
      }

      ping = setInterval(() => {
        if (!session.status.active) {
          safeSend({ type: "status", phase: "idle", session: session.status });
          close();
          return;
        }
        safeSend({ type: "status", phase: "running", session: session.status });
      }, 20_000);

      if (!session.status.active) {
        setTimeout(close, 25);
      }
      return () => {
        off();
        if (ping) clearInterval(ping);
      };
    },
  });
}

const SESSION_LIST_HEARTBEAT_MS = 45_000;

export function handleSessionListChanged(request: Request): Response {
  return sseResponse({
    signal: request.signal,
    connectComment: `connected v${sessionListChangedVersion()}`,
    heartbeat: { intervalMs: SESSION_LIST_HEARTBEAT_MS, comment: "keep-alive" },
    start(send) {
      return subscribeSessionListChanged((event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      });
    },
  });
}

export function handleSetupChecks(): Response {
  const codexDir = path.join(homedir(), ".codex");
  const piDir = path.join(homedir(), ".pi");
  const diagnostics = piResourceDiagnostics();
  return Response.json({
    checks: [
      {
        id: "pi-sdk",
        label: "Pi SDK",
        ok: true,
        value: "@earendil-works/pi-coding-agent",
        guidance: "The agent runtime is provided by the bundled Pi SDK package.",
      },
      {
        id: "pi-dir",
        label: "Pi data directory",
        ok: existsSync(piDir),
        value: piDir,
        guidance: "The directory is created after the first Pi run.",
      },
      {
        id: "codex-dir",
        label: "Codex config directory",
        ok: existsSync(codexDir),
        value: codexDir,
        guidance: "Optional but recommended for skills parity.",
      },
    ],
    diagnostics,
  });
}
