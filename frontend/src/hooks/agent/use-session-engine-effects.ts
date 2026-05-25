import { useEffect, type RefObject } from "react";

import type { Session, SessionId } from "@/lib/agent/sessions/types";
import { loadRuntimeStatus, subscribeRuntimeEvents } from "@/lib/agent/sessions/api";
import {
  subscribeResumeRuntimeSession,
  type RuntimeResumeDeps,
} from "@/lib/agent/sessions/runtime-resume";
import { hasRuntimePromptStream } from "@/lib/agent/sessions/stream-ownership";
import type { TextDeltaCoalescer } from "@/lib/agent/sessions/text-delta-coalescer";

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

export function useSessionEngineTextDeltaCleanupEffect({
  textDeltaCoalescerRef,
}: {
  textDeltaCoalescerRef: RefObject<TextDeltaCoalescer | null>;
}): void {
  useEffect(
    () => () => {
      textDeltaCoalescerRef.current?.flushAll();
      textDeltaCoalescerRef.current?.dispose();
    },
    [textDeltaCoalescerRef],
  );
}

export function useSessionEnginePromptStreamCleanupEffect({
  promptStreamControllersRef,
}: {
  promptStreamControllersRef: RefObject<Map<string, AbortController>>;
}): void {
  useEffect(
    () => () => {
      for (const controller of promptStreamControllersRef.current.values()) {
        controller.abort();
      }
      promptStreamControllersRef.current.clear();
    },
    [promptStreamControllersRef],
  );
}

export function useSessionEngineRuntimeResumeEffect({
  after,
  applyPiEvent,
  flushPiEvents,
  localStreamRef,
  onPiSessionIdChange,
  runtime,
  piSessionId,
  sessionId,
  shouldApplySeq,
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
  piSessionId?: string | null;
  sessionId: SessionId | null;
  shouldApplySeq?: RuntimeResumeDeps["shouldApplySeq"];
  submitPromptRef: RuntimeResumeDeps["submitPromptRef"];
  tabsRef: RefObject<Session[]>;
  updateSession: UpdateSession;
}): void {
  useEffect(() => {
    if (!sessionId || !runtime) return;
    if (localStreamRef.current.has(sessionId)) return;
    if (hasRuntimePromptStream(runtime)) return;

    const sub = subscribeResumeRuntimeSession({
      after,
      api: { loadRuntimeStatus, subscribeRuntimeEvents },
      applyPiEvent,
      flushPiEvents,
      onPiSessionIdChange,
      piSessionId,
      runtime,
      sessionId,
      shouldApplySeq,
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
    piSessionId,
    runtime,
    sessionId,
    shouldApplySeq,
    submitPromptRef,
    tabsRef,
    updateSession,
  ]);
}
