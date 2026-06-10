import {
  reduceSessionEvent,
  type SessionStreamContext,
} from "@/features/agent/runtime/pi-event-applier";
import type { Session } from "@/features/agent/runtime/types";
import type { WorkspaceState } from "@/features/agent/workspace/types";

export function makeSession(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    runtimeSessionId: `rt-${id}`,
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
    ...patch,
  };
}

export function makeState(session = makeSession("s-main")): WorkspaceState {
  return {
    sessions: new Map([[session.id, session]]),
    models: [],
    selectedModel: "",
    modelsLoading: false,
    layout: { kind: "leaf", paneId: "p-main" },
    panesById: new Map([["p-main", { sessionId: session.id }]]),
    focusedPaneId: "p-main",
    setupWarning: "",
    error: "",
    hydrated: true,
    lastHandledNavKey: "",
  };
}

export function makePiEventApplierHarness(
  initialSession: Session,
  assistantId = "a-main",
): {
  apply: (
    sessionId: string,
    assistantId: string,
    event: Record<string, unknown>,
  ) => void;
  session: () => Session;
} {
  let session = initialSession;
  const ctx: SessionStreamContext = {
    liveAssistantIds: new Map([[initialSession.id, assistantId]]),
  };
  const apply = (
    sessionId: string,
    targetAssistantId: string,
    event: Record<string, unknown>,
  ) => {
    if (sessionId !== session.id) return;
    session = reduceSessionEvent(session, ctx, targetAssistantId, event);
  };
  return { apply, session: () => session };
}
