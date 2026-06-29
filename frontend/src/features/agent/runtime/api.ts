import { Effect } from "effect";
import { safeJson } from "@/features/agent/safe-json";
import {
  parseAgentTurnCommandResult,
  type AgentTurnCommandResult,
  type RuntimeLoggedEvent,
} from "@/features/agent/messages";
import type { AgentImageInput } from "@/features/agent/contracts";
import type { BrowserBackend } from "@/features/agent/tools/types";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";

import {
  decodeRuntimeEventPayload,
  type RuntimeContextUsage,
} from "@/features/agent/runtime/runtime-schema";
export type { RuntimeContextUsage };
export type RuntimeStatus = {
  active?: boolean;
  running?: boolean;
  piSessionId?: string | null;
  modelId?: string | null;
  eventSeq?: number;
  events?: RuntimeLoggedEvent[];
  contextUsage?: RuntimeContextUsage | null;
};

export function runtimeContextUsage(
  status: RuntimeStatus | null | undefined,
  fallback: RuntimeContextUsage | null | undefined,
): RuntimeContextUsage | null {
  if (status) return status.contextUsage ?? null;
  return fallback ?? null;
}

const fetchEffect = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Effect.Effect<Response, unknown> =>
  Effect.tryPromise({
    try: () => fetch(input, init),
    catch: (error) => error,
  });

const safeJsonEffect = <T>(response: Response): Effect.Effect<T, unknown> =>
  Effect.tryPromise({
    try: () => safeJson<T>(response),
    catch: (error) => error,
  });

export type RuntimeSessionSummary = {
  sessionId: string;
  status: RuntimeStatus;
};

export function listRuntimeSessions(): Promise<RuntimeSessionSummary[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect("/api/agent/runtime/sessions", { cache: "no-store" });
      const payload = yield* safeJsonEffect<{ sessions?: RuntimeSessionSummary[] }>(response);
      return Array.isArray(payload.sessions) ? payload.sessions : [];
    }).pipe(Effect.catch(() => Effect.succeed([]))),
  );
}

export function loadRuntimeStatus(
  sessionId: string,
  piSessionId?: string | null,
): Promise<RuntimeStatus | null> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const params = new URLSearchParams({ sessionId });
      if (piSessionId) params.set("piSessionId", piSessionId);
      const response = yield* fetchEffect(`/api/agent/runtime/status?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = yield* safeJsonEffect<{
        status?: {
          active?: boolean;
          running?: boolean;
          piSessionId?: string | null;
          modelId?: string | null;
          eventSeq?: number;
          contextUsage?: RuntimeContextUsage | null;
        };
        events?: RuntimeLoggedEvent[];
      }>(response);
      return payload.status ? { ...payload.status, events: payload.events ?? [] } : null;
    }).pipe(Effect.catch(() => Effect.succeed(null))),
  );
}

export function abortSession(sessionId: string): Promise<void> {
  return Effect.runPromise(
    fetchEffect("/api/agent/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).pipe(
      Effect.map(() => undefined),
      Effect.catch(() => Effect.succeed(undefined)),
    ),
  );
}

export type CanonicalSessionResult = {
  events: Record<string, unknown>[];
};

export function loadCanonicalSession(
  piSessionId: string,
  cwd: string,
): Promise<CanonicalSessionResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `/api/agent/sessions/${encodeURIComponent(piSessionId)}?cwd=${encodeURIComponent(cwd)}`,
        { cache: "no-store" },
      );
      const payload = yield* safeJsonEffect<{ events?: Record<string, unknown>[]; error?: string }>(
        response,
      );
      if (!response.ok)
        return yield* Effect.fail(new Error(payload.error || "Failed to load session"));
      return { events: payload.events ?? [] };
    }),
  );
}

export type CompactSessionArgs = {
  sessionId: string;
  modelId: string;
  cwd?: string;
  piSessionId?: string | null;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  browserBackend?: BrowserBackend;
  canvasEnabled?: boolean;
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

export type CompactSessionResult = {
  status?: RuntimeStatus;
};

export function compactSession(args: CompactSessionArgs): Promise<CompactSessionResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect("/api/agent/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const payload = yield* safeJsonEffect<{
        error?: string;
        status?: RuntimeStatus;
      }>(response);
      if (!response.ok) return yield* Effect.fail(new Error(payload.error || "Compaction failed"));
      return payload;
    }),
  );
}

export type SubmitTurnArgs = {
  sessionId: string;
  modelId: string;
  message: string;
  images?: AgentImageInput[];
  cwd?: string;
  piSessionId?: string | null;
  /** Control mode for steer/follow-up; omitted for a normal prompt. */
  mode?: "steer" | "follow_up";
  browserToolEnabled: boolean;
  browserSessionId?: string;
  browserBackend?: BrowserBackend;
  canvasEnabled?: boolean;
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

export function submitTurnCommand(args: SubmitTurnArgs): Promise<AgentTurnCommandResult> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* fetchEffect("/api/agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const payload = yield* safeJsonEffect<{ error?: string } & Partial<AgentTurnCommandResult>>(
        response,
      );
      const parsed = parseAgentTurnCommandResult(payload);
      if (!response.ok || !parsed) {
        return yield* Effect.fail(
          new Error(payload.error || `Agent request failed: ${response.status}`),
        );
      }
      if (parsed.outcome === "rejected") {
        return yield* Effect.fail(new Error(parsed.error || "Agent request was rejected"));
      }
      return parsed;
    }),
  );
}

/**
 * Subscribe to the runtime's per-session event stream. Returns an
 * unsubscribe function that closes the EventSource. Callers handle `onError`
 * (e.g. probe runtime status to see if the session still exists).
 */
export type RuntimeEventPayload =
  | { type: "status"; phase: string; session?: RuntimeStatus }
  | { type: "pi"; seq?: number; event: Record<string, unknown> };

export type RuntimeEventSubscription = { close: () => void };

export function subscribeRuntimeEvents(
  sessionId: string,
  after: number,
  piSessionId: string | null | undefined,
  handlers: {
    onPayload: (payload: RuntimeEventPayload) => void;
    onError: () => void;
  },
): RuntimeEventSubscription {
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
    if (!payload) return;
    handlers.onPayload(payload as unknown as RuntimeEventPayload);
  };
  source.onerror = handlers.onError;
  return {
    close: () => {
      source.close();
    },
  };
}
