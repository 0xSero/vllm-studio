import type { SessionListChangedEvent } from "../../../shared/agent/session-list-changed";

type Listener = (event: SessionListChangedEvent) => void;

const listeners = new Set<Listener>();
let version = 0;

export function notifySessionListChanged(): void {
  version += 1;
  const event: SessionListChangedEvent = { type: "session_list_changed", version };
  for (const listener of [...listeners]) listener(event);
}

export function subscribeSessionListChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sessionListChangedStream(signal?: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = subscribeSessionListChanged((event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          if (unsubscribe) unsubscribe();
          try {
            controller.close();
          } catch {
            return;
          }
        }
      });
      if (signal) {
        if (signal.aborted) {
          controller.close();
          return;
        }
        signal.addEventListener("abort", () => controller.close(), { once: true });
      }
    },
    cancel() {
      if (unsubscribe) unsubscribe();
    },
  });
}
