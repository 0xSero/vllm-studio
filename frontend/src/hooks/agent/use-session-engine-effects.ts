import { useEffect, type RefObject } from "react";

import type { Session, SessionId } from "@/lib/agent/sessions/types";
import * as sessionsApi from "@/lib/agent/sessions/api";
import {
  subscribeResumeRuntimeSession,
  type RuntimeResumeDeps,
} from "@/lib/agent/sessions/runtime-resume";

type PiEventBatch = {
  timer?: ReturnType<typeof setTimeout> | null;
};

type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

export function useSessionEngineBatchCleanupEffect({
  piEventBatchesRef,
}: {
  piEventBatchesRef: RefObject<Map<SessionId, PiEventBatch>>;
}): void {
  useEffect(
    () => () => {
      for (const batch of piEventBatchesRef.current.values()) {
        if (batch.timer) clearTimeout(batch.timer);
      }
      piEventBatchesRef.current.clear();
    },
    [piEventBatchesRef],
  );
}

export function useSessionEngineRuntimeResumeEffect({
  after,
  applyPiEvent,
  flushPiEvents,
  localStreamRef,
  onPiSessionIdChange,
  runtime,
  sessionId,
  submitPromptRef,
  tabsRef,
  updateSession,
}: {
  after: number;
  applyPiEvent: RuntimeResumeDeps["applyPiEvent"];
  flushPiEvents: (sessionId: SessionId) => void;
  localStreamRef: RefObject<Set<SessionId>>;
  onPiSessionIdChange?: (piSessionId: string) => void;
  runtime: string | null;
  sessionId: SessionId | null;
  submitPromptRef: RuntimeResumeDeps["submitPromptRef"];
  tabsRef: RefObject<Session[]>;
  updateSession: UpdateSession;
}): void {
  useEffect(() => {
    if (!sessionId || !runtime) return;
    if (localStreamRef.current.has(sessionId)) return;

    const sub = subscribeResumeRuntimeSession({
      after,
      api: sessionsApi,
      applyPiEvent,
      flushPiEvents,
      onPiSessionIdChange,
      runtime,
      sessionId,
      submitPromptRef,
      tabsRef,
      updateSession,
    });
    return sub.close;
  }, [
    after,
    applyPiEvent,
    flushPiEvents,
    localStreamRef,
    onPiSessionIdChange,
    runtime,
    sessionId,
    submitPromptRef,
    tabsRef,
    updateSession,
  ]);
}
