"use client";

import { useSyncExternalStore } from "react";
import { Effect, Fiber, Schedule } from "effect";
import type { SpeechStatus, SpeechVoiceProfile } from "@local-studio/contracts/speech";
import api from "@/lib/api/client";
import { BACKEND_URL_CHANGED_EVENT, getStoredBackendUrl } from "@/lib/api/connection";

export interface SpeechSnapshot {
  status: SpeechStatus | null;
  voices: readonly SpeechVoiceProfile[];
  loading: boolean;
  available: boolean;
  controllerKey: string;
  error: string;
}

const emptySnapshot = (key = ""): SpeechSnapshot => ({
  status: null,
  voices: [],
  loading: true,
  available: false,
  controllerKey: key,
  error: "",
});

const serverSnapshot = emptySnapshot();
let snapshot = serverSnapshot;
let requestSequence = 0;
let controllerKey = "";
let pollFiber: Fiber.Fiber<void, never> | null = null;
const listeners = new Set<() => void>();

function publish(next: SpeechSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Voice service is unavailable";
}

export async function refreshSpeechStore(): Promise<void> {
  resetForController();
  const requestedController = controllerKey;
  const sequence = ++requestSequence;
  if (!snapshot.status) publish({ ...snapshot, loading: true });
  const [status, voices] = await Promise.allSettled([
    api.getSpeechStatus(),
    api.listSpeechVoices(),
  ]);
  if (sequence !== requestSequence || requestedController !== controllerKey) return;
  const failures = [status, voices].filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  publish({
    status: status.status === "fulfilled" ? status.value : snapshot.status,
    voices: voices.status === "fulfilled" ? voices.value : snapshot.voices,
    loading: false,
    available: status.status === "fulfilled",
    controllerKey,
    error: failures[0] ? errorMessage(failures[0].reason) : "",
  });
}

function resetForController(): void {
  const nextKey = getStoredBackendUrl() || "default";
  if (controllerKey === nextKey) return;
  controllerKey = nextKey;
  requestSequence += 1;
  publish(emptySnapshot(nextKey));
}

function handleControllerChange(): void {
  resetForController();
  void refreshSpeechStore();
}

function startPolling(): void {
  if (pollFiber || typeof window === "undefined") return;
  resetForController();
  pollFiber = Effect.runFork(
    Effect.promise(refreshSpeechStore).pipe(Effect.repeat(Schedule.spaced(3_000)), Effect.asVoid),
  );
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, handleControllerChange);
}

function stopPolling(): void {
  if (!pollFiber) return;
  void Effect.runPromise(Fiber.interrupt(pollFiber));
  pollFiber = null;
  window.removeEventListener(BACKEND_URL_CHANGED_EVENT, handleControllerChange);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startPolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

export function useSpeechStore(): SpeechSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => serverSnapshot,
  );
}
