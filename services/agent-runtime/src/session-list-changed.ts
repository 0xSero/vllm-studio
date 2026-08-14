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
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let unsubscribe: (() => void) | null = null;
  let onAbort: (() => void) | null = null;
  let closed = false;
  const teardown = (): void => {
    if (closed) return;
    closed = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (onAbort && signal) {
      signal.removeEventListener("abort", onAbort);
      onAbort = null;
    }
    if (streamController) {
      try {
        streamController.close();
      } catch {
        return;
      }
    }
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      unsubscribe = subscribeSessionListChanged((event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          teardown();
        }
      });
      if (signal) {
        if (signal.aborted) {
          teardown();
          return;
        }
        onAbort = teardown;
        signal.addEventListener("abort", onAbort, { once: true });
      }
    },
    cancel() {
      teardown();
    },
  });
}
