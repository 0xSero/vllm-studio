"use client";

import { Effect, Fiber } from "effect";
import {
  CONTROLLER_STREAM_EVENT_TYPES as CONTROLLER_EVENT_TYPES,
  getBrowserEventChannelForControllerEvent,
  isControllerStreamEventType,
  type ControllerBrowserEventChannel,
} from "@/lib/controller-events-contract";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  BACKEND_URL_CHANGED_EVENT,
  getApiKey,
  resolveControllerEventsBaseUrl,
} from "@/lib/api/connection";

interface SSEPayload<T = unknown> {
  data: T;
  timestamp: string;
}

export function useControllerEvents(apiBaseUrl: string = resolveControllerEventsBaseUrl()) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const [backendRevision, setBackendRevision] = useState(0);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const payload = JSON.parse(event.data) as SSEPayload<Record<string, unknown>>;
      const eventType = (event as { type?: string }).type || "message";
      const data = payload.data ?? {};

      const handled = dispatchControllerDomainEvent(eventType, data, dispatchCustomEvent);
      if (!handled && !isKnownControllerEvent(eventType)) {
        logUnknownControllerEvent(eventType, data);
      }
    } catch (err) {
      console.error("[Controller SSE] Failed to parse event:", err);
    }
  }, []);

  const apiKey = getApiKey();
  const sseUrl = apiKey
    ? `${apiBaseUrl}/events?api_key=${encodeURIComponent(apiKey)}`
    : `${apiBaseUrl}/events`;

  const subscribeControllerEvents = useCallback(
    (_notify: () => void) => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      let disposed = false;
      let reconnectFiber: Fiber.RuntimeFiber<void, unknown> | null = null;

      const open = () => {
        if (disposed) return;
        const es = new EventSource(sseUrl);
        eventSourceRef.current = es;
        let failureStreak = 0;

        const onDelivered = (event: MessageEvent) => {
          // A delivered event proves this backend's /events actually streams, so
          // reset the backoff — a genuine mid-stream drop should reconnect fast.
          failureStreak = 0;
          handleMessage(event);
        };

        for (const type of CONTROLLER_EVENT_TYPES) {
          es.addEventListener(type, (event) => onDelivered(event as MessageEvent));
        }
        es.onmessage = (event) => onDelivered(event as MessageEvent);

        es.onerror = () => {
          if (disposed) return;
          es.close();
          // The browser's native EventSource reconnects immediately. On a backend
          // whose /events never streams (e.g. CDN-buffered SSE behind Cloudflare),
          // that pins a long hung request every few seconds for nothing. Take over
          // reconnection with capped exponential backoff via Effect.sleep on a
          // tracked fiber; the realtime-status store's polling fallback keeps data
          // fresh meanwhile.
          failureStreak = Math.min(failureStreak + 1, 6);
          const delay = Math.min(60_000, 3_000 * 2 ** failureStreak);
          const program = Effect.gen(function* () {
            yield* Effect.sleep(delay);
            open();
          });
          if (reconnectFiber) void Promise.resolve(Fiber.interrupt(reconnectFiber as never));
          reconnectFiber = Effect.runFork(program) as never;
        };
      };

      open();

      return () => {
        disposed = true;
        if (reconnectFiber) void Promise.resolve(Fiber.interrupt(reconnectFiber as never));
        eventSourceRef.current?.close();
      };
    },
    [backendRevision, handleMessage, sseUrl],
  );

  const subscribeBackendChanges = useCallback((_notify: () => void) => {
    const reconnect = () => setBackendRevision((value) => value + 1);
    window.addEventListener(BACKEND_URL_CHANGED_EVENT, reconnect);
    return () => window.removeEventListener(BACKEND_URL_CHANGED_EVENT, reconnect);
  }, []);

  useSyncExternalStore(
    subscribeControllerEvents,
    getControllerEventsSnapshot,
    getControllerEventsSnapshot,
  );
  useSyncExternalStore(
    subscribeBackendChanges,
    getControllerEventsSnapshot,
    getControllerEventsSnapshot,
  );
}

const getControllerEventsSnapshot = (): number => 0;

export const dispatchCustomEvent = (name: string, detail: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
};

export type UnknownControllerEventLogger = (
  message: string,
  detail: { eventType: string; data: Record<string, unknown> },
) => void;

export const resolveControllerEventChannel = (
  eventType: string,
): ControllerBrowserEventChannel | null => {
  return getBrowserEventChannelForControllerEvent(eventType);
};

export const dispatchControllerDomainEvent = (
  eventType: string,
  data: Record<string, unknown>,
  dispatch: (name: string, detail: Record<string, unknown>) => void,
): boolean => {
  const channel = resolveControllerEventChannel(eventType);
  if (!channel) {
    return false;
  }
  dispatch(channel, { type: eventType, data });
  return true;
};

export const logUnknownControllerEvent = (
  eventType: string,
  data: Record<string, unknown>,
  logger: UnknownControllerEventLogger = (message, detail) => {
    console.warn(message, detail);
  },
): void => {
  logger("[Controller SSE] Unhandled event type", { eventType, data });
};

export const isKnownControllerEvent = (eventType: string): boolean => {
  return isControllerStreamEventType(eventType);
};
