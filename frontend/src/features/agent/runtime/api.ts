import { Effect, Schema } from "effect";
import {
  SessionGoalResponseSchema,
  type SessionGoal,
  type SessionGoalPatch,
} from "@shared/agent/session-goal";
import type { SessionUsageTotals } from "@shared/agent/session-summary";
import { requestDecodedEffect } from "@/lib/api/request-json";
import {
  parseAgentTurnCommandResult,
  type AgentTurnCommandResult,
} from "@/features/agent/messages";
import type {
  AgentImageInput,
  AgentQueueAction,
  AgentToolAccess,
} from "@/features/agent/contracts";
import type { BrowserBackend } from "@/features/agent/tools/types";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";

import {
  decodeRuntimeActivityPayload,
  decodeRuntimeEventPayload,
  decodeRuntimeSessions,
  decodeRuntimeStatusResponse,
  type RuntimeContextUsage,
  type RuntimeActivityPayload,
  type RuntimeEventPayload,
  type RuntimeSessionSummary,
  type RuntimeStatus,
} from "@/features/agent/runtime/runtime-schema";
export type {
  RuntimeActivityPayload,
  RuntimeContextUsage,
  RuntimeEventPayload,
  RuntimeSessionSummary,
  RuntimeStatus,
};
export type { SessionUsageTotals };

export function runtimeContextUsage(
  status: RuntimeStatus | null | undefined,
  fallback: RuntimeContextUsage | null | undefined,
): RuntimeContextUsage | null {
  if (status) return status.contextUsage ?? null;
  return fallback ?? null;
}

const AbortSessionResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  cleared: Schema.Struct({
    steering: Schema.Array(Schema.String),
    followUp: Schema.Array(Schema.String),
  }),
});

const decodeAbortSessionResponse = Schema.decodeUnknownOption(AbortSessionResponseSchema, {
  onExcessProperty: "preserve",
});

export type AbortSessionResult = {
  steering: string[];
  followUp: string[];
};

export function parseAbortSessionResult(input: unknown): AbortSessionResult {
  const decoded = decodeAbortSessionResponse(input);
  return decoded._tag === "Some"
    ? {
        steering: [...decoded.value.cleared.steering],
        followUp: [...decoded.value.cleared.followUp],
      }
    : { steering: [], followUp: [] };
}

export function listRuntimeSessions(): Promise<RuntimeSessionSummary[]> {
  return Effect.runPromise(
    requestDecodedEffect("/api/agent/runtime/sessions", decodeRuntimeSessions, {
      cache: "no-store",
    }).pipe(Effect.catch(() => Effect.succeed([]))),
  );
}

export function loadRuntimeStatus(
  sessionId: string,
  piSessionId?: string | null,
): Promise<RuntimeStatus | null> {
  const params = new URLSearchParams({ sessionId });
  if (piSessionId) params.set("piSessionId", piSessionId);
  return Effect.runPromise(
    requestDecodedEffect(
      `/api/agent/runtime/status?${params.toString()}`,
      decodeRuntimeStatusResponse,
      { cache: "no-store" },
    ).pipe(Effect.catch(() => Effect.succeed(null))),
  );
}

export function abortSession(
  sessionId: string,
  piSessionId?: string | null,
): Promise<AbortSessionResult> {
  return Effect.runPromise(
    requestDecodedEffect("/api/agent/abort", parseAbortSessionResult, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, piSessionId }),
    }).pipe(Effect.catch(() => Effect.succeed({ steering: [], followUp: [] }))),
  );
}

export function respondExtensionUi(
  sessionId: string,
  requestId: string,
  response: { value?: string; confirmed?: boolean; cancelled?: boolean },
): Promise<void> {
  return Effect.runPromise(
    requestDecodedEffect(
      "/api/agent/runtime/extension-ui",
      () => undefined,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, requestId, ...response }),
      },
      "Extension response was rejected",
    ),
  );
}

export type CanonicalSessionMeta = {
  title: string | null;
  modelId: string | null;
  startedAt: string | null;
  piSessionId: string | null;
  usage?: SessionUsageTotals | null;
};

export type CanonicalSessionResult = {
  messages: Record<string, unknown>[];
  // Byte-offset cursor to pass as `before` to load the previous (older) page,
  // or null when this page already reaches the start of the session log.
  cursor: number | null;
  // Session metadata from a head-scan; present on an initial tail load only.
  meta: CanonicalSessionMeta | null;
};

// Default page size for the initial tail load — enough to fill a long scrollback
// while keeping a giant log from being read/parsed whole.
export const DEFAULT_SESSION_TAIL = 500;

export type LoadCanonicalSessionOptions = { tail?: number; before?: number };

export function loadCanonicalSession(
  piSessionId: string,
  cwd: string,
  options: LoadCanonicalSessionOptions = {},
): Promise<CanonicalSessionResult> {
  const params = new URLSearchParams({ cwd });
  const tail = options.before === undefined ? (options.tail ?? DEFAULT_SESSION_TAIL) : undefined;
  if (tail !== undefined) params.set("tail", String(tail));
  if (options.before !== undefined) params.set("before", String(options.before));
  return Effect.runPromise(
    requestDecodedEffect(
      `/api/agent/sessions/${encodeURIComponent(piSessionId)}?${params.toString()}`,
      (input) => {
        const payload = input as Partial<CanonicalSessionResult>;
        return {
          messages: payload.messages ?? [],
          cursor: payload.cursor ?? null,
          meta: payload.meta ?? null,
        };
      },
      { cache: "no-store" },
      "Failed to load session",
    ),
  );
}

export type CompactSessionArgs = {
  sessionId: string;
  modelId: string;
  thinkingLevel?: import("@/features/agent/contracts").AgentThinkingLevel;
  toolAccess?: AgentToolAccess;
  cwd?: string;
  piSessionId?: string | null;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  browserBackend?: BrowserBackend;
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

export type CompactSessionResult = {
  status?: RuntimeStatus;
};

export function compactSession(args: CompactSessionArgs): Promise<CompactSessionResult> {
  return Effect.runPromise(
    requestDecodedEffect(
      "/api/agent/compact",
      (input) => input as CompactSessionResult,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      },
      "Compaction failed",
    ),
  );
}

export type SubmitTurnArgs = {
  sessionId: string;
  modelId: string;
  thinkingLevel?: import("@/features/agent/contracts").AgentThinkingLevel;
  toolAccess: AgentToolAccess;
  message: string;
  images?: AgentImageInput[];
  cwd?: string;
  piSessionId?: string | null;
  /** Control mode for steer/follow-up; omitted for a normal prompt. */
  mode?: "steer" | "follow_up";
  queueAction?: AgentQueueAction;
  queueReplacement?: string;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  browserBackend?: BrowserBackend;
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

export function submitTurnCommand(args: SubmitTurnArgs): Promise<AgentTurnCommandResult> {
  return Effect.runPromise(
    requestDecodedEffect(
      "/api/agent/turn",
      (input) => {
        const parsed = parseAgentTurnCommandResult(input);
        if (!parsed) throw new Error("Agent response was invalid");
        if (parsed.outcome === "rejected")
          throw new Error(parsed.error || "Agent request was rejected");
        return parsed;
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      },
      "Agent request failed",
    ),
  );
}

export type RuntimeActivitySubscription = { close: () => void };

export function subscribeRuntimeActivity(
  onPayload: (payload: RuntimeActivityPayload) => void,
): RuntimeActivitySubscription {
  const source = new EventSource("/api/agent/runtime/activity");
  source.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    const payload = decodeRuntimeActivityPayload(parsed);
    if (!payload) return;
    onPayload(payload);
  };
  return {
    close: () => source.close(),
  };
}

export function subscribeRuntimeEvents(
  sessionId: string,
  after: number,
  piSessionId: string | null | undefined,
  handlers: {
    onPayload: (payload: RuntimeEventPayload) => void;
    onError: () => void;
  },
): RuntimeActivitySubscription {
  const params = new URLSearchParams({ sessionId, after: String(after) });
  if (piSessionId) params.set("piSessionId", piSessionId);
  const source = new EventSource(`/api/agent/runtime/events?${params.toString()}`);
  source.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    const payload = decodeRuntimeEventPayload(parsed);
    if (payload) handlers.onPayload(payload);
  };
  source.onerror = handlers.onError;
  return { close: () => source.close() };
}

const decodeSessionGoalResponseOption = Schema.decodeUnknownOption(SessionGoalResponseSchema, {
  onExcessProperty: "preserve",
});

function decodeSessionGoal(raw: unknown): SessionGoal | null {
  if (!raw || typeof raw !== "object") return null;
  const option = decodeSessionGoalResponseOption(raw);
  return option._tag === "Some" ? option.value.goal : null;
}

const sessionGoalUrl = (piSessionId: string) =>
  `/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`;

export function loadSessionGoal(piSessionId: string): Promise<SessionGoal | null> {
  return Effect.runPromise(
    requestDecodedEffect(sessionGoalUrl(piSessionId), decodeSessionGoal, {
      cache: "no-store",
    }).pipe(Effect.catch(() => Effect.succeed(null))),
  );
}

export function updateSessionGoal(
  piSessionId: string,
  patch: SessionGoalPatch,
): Promise<SessionGoal | null> {
  return Effect.runPromise(
    requestDecodedEffect(
      sessionGoalUrl(piSessionId),
      decodeSessionGoal,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
      "Failed to update the goal",
    ),
  );
}

export function clearSessionGoal(piSessionId: string): Promise<void> {
  return Effect.runPromise(
    requestDecodedEffect(
      sessionGoalUrl(piSessionId),
      () => undefined,
      { method: "DELETE" },
      "Failed to clear the goal",
    ),
  );
}
