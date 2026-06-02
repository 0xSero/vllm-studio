import { useCallback, useSyncExternalStore, type RefObject } from "react";

import type { SessionId } from "@/lib/agent/sessions/types";
import type { TextDeltaCoalescer } from "@/lib/agent/sessions/text-delta-coalescer";

type PiEventBatch = {
  timer?: ReturnType<typeof setTimeout> | null;
};

const getSessionEngineSnapshot = (): number => 0;

export function useSessionEngineBatchCleanupEffect({
  piEventBatchesRef,
}: {
  piEventBatchesRef: RefObject<Map<SessionId, PiEventBatch>>;
}): void {
  const subscribeBatchCleanup = useCallback(
    () => () => {
      for (const batch of piEventBatchesRef.current.values()) {
        if (batch.timer) clearTimeout(batch.timer);
      }
      piEventBatchesRef.current.clear();
    },
    [piEventBatchesRef],
  );

  useSyncExternalStore(subscribeBatchCleanup, getSessionEngineSnapshot, getSessionEngineSnapshot);
}

export function useSessionEngineTextDeltaCleanupEffect({
  textDeltaCoalescerRef,
}: {
  textDeltaCoalescerRef: RefObject<TextDeltaCoalescer | null>;
}): void {
  const subscribeTextDeltaCleanup = useCallback(
    () => () => {
      textDeltaCoalescerRef.current?.flushAll();
      textDeltaCoalescerRef.current?.dispose();
    },
    [textDeltaCoalescerRef],
  );

  useSyncExternalStore(
    subscribeTextDeltaCleanup,
    getSessionEngineSnapshot,
    getSessionEngineSnapshot,
  );
}

export function useSessionEnginePromptStreamCleanupEffect({
  promptStreamControllersRef,
}: {
  promptStreamControllersRef: RefObject<Map<string, AbortController>>;
}): void {
  const subscribePromptStreamCleanup = useCallback(
    () => () => {
      for (const controller of promptStreamControllersRef.current.values()) {
        controller.abort();
      }
      promptStreamControllersRef.current.clear();
    },
    [promptStreamControllersRef],
  );

  useSyncExternalStore(
    subscribePromptStreamCleanup,
    getSessionEngineSnapshot,
    getSessionEngineSnapshot,
  );
}
