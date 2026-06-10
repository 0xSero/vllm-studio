// Pure HTTP/SSE clients for the agent session endpoints. No React state, no
// component coupling — engine code calls into these and reacts to the results.

import { safeJson } from "@/lib/safe-json";
import {
  parseAgentTurnCommandResult,
  type AgentTurnCommandResult,
  type RuntimeLoggedEvent,
} from "@/features/agent/messages";
import type { AgentImageInput } from "@/features/agent/contracts";
import type { BrowserBackend } from "@/features/agent/tools/types";
import type {
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";

export type RuntimeContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  shouldCompact: boolean;
};

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

export type RuntimeSessionSummary = {
  sessionId: string;
  status: RuntimeStatus;
};

export async function listRuntimeSessions(): Promise<RuntimeSessionSummary[]> {
  try {
    const response = await fetch("/api/agent/runtime/sessions", { cache: "no-store" });
    const payload = await safeJson<{ sessions?: RuntimeSessionSummary[] }>(response);
    return Array.isArray(payload.sessions) ? payload.sessions : [];
  } catch {
    return [];
  }
}

export async function loadRuntimeStatus(
  sessionId: string,
  piSessionId?: string | null,
): Promise<RuntimeStatus | null> {
  try {
    const params = new URLSearchParams({ sessionId });
    if (piSessionId) params.set("piSessionId", piSessionId);
    const response = await fetch(`/api/agent/runtime/status?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = await safeJson<{
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
  } catch {
    return null;
  }
}

export async function abortSession(sessionId: string): Promise<void> {
  await fetch("/api/agent/abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  }).catch(() => undefined);
}

export type CanonicalSessionResult = {
  events: Record<string, unknown>[];
};

export async function loadCanonicalSession(
  piSessionId: string,
  cwd: string,
): Promise<CanonicalSessionResult> {
  const response = await fetch(
    `/api/agent/sessions/${encodeURIComponent(piSessionId)}?cwd=${encodeURIComponent(cwd)}`,
    { cache: "no-store" },
  );
  const payload = await safeJson<{ events?: Record<string, unknown>[]; error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to load session");
  return { events: payload.events ?? [] };
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
  plugins: ComposerPluginRef[];
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

export type CompactSessionResult = {
  status?: RuntimeStatus;
};

export async function compactSession(args: CompactSessionArgs): Promise<CompactSessionResult> {
  const response = await fetch("/api/agent/compact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = await safeJson<{
    error?: string;
    status?: RuntimeStatus;
  }>(response);
  if (!response.ok) throw new Error(payload.error || "Compaction failed");
  return payload;
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
  plugins: ComposerPluginRef[];
  skills: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

export async function submitTurnCommand(args: SubmitTurnArgs): Promise<AgentTurnCommandResult> {
  const response = await fetch("/api/agent/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const payload = await safeJson<{ error?: string } & Partial<AgentTurnCommandResult>>(response);
  const parsed = parseAgentTurnCommandResult(payload);
  if (!response.ok || !parsed) {
    throw new Error(payload.error || `Agent request failed: ${response.status}`);
  }
  if (parsed.outcome === "rejected") {
    throw new Error(parsed.error || "Agent request was rejected");
  }
  return parsed;
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
    let payload: RuntimeEventPayload;
    try {
      payload = JSON.parse(event.data) as RuntimeEventPayload;
    } catch {
      return;
    }
    handlers.onPayload(payload);
  };
  source.onerror = handlers.onError;
  return {
    close: () => {
      source.close();
    },
  };
}
