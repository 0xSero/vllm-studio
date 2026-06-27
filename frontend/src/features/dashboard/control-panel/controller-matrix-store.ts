"use client";

import { useSyncExternalStore } from "react";
import { Effect, Fiber, Schedule } from "effect";
import { createApiClient } from "@/lib/api/create-api-client";
import {
  BACKEND_URL_CHANGED_EVENT,
  getStoredBackendUrl,
  setApiKey,
  setStoredBackendUrl,
} from "@/lib/api/connection";
import {
  CONTROLLERS_CHANGED_EVENT,
  loadSavedControllers,
  normalizeControllerUrl,
  type SavedController,
} from "@/lib/api/controllers";
import type { GPU, ProcessInfo } from "@/lib/types";

const POLL_INTERVAL_MS = 5_000;
const POLL_REQUEST = { timeout: 4_000, retries: 0 } as const;

export type ControllerSnapshot = SavedController & {
  index: number;
  primary: boolean;
  online: boolean;
  authRequired: boolean;
  running: boolean;
  process: ProcessInfo | null;
  gpus: GPU[];
  inferencePort?: number;
  error?: string;
};

export interface ControllerMatrixSnapshot {
  rows: ControllerSnapshot[];
  activeUrl: string;
  visible: boolean;
}

type SnapshotExtras = {
  online: boolean;
  authRequired: boolean;
  running: boolean;
  process: ProcessInfo | null;
  gpus: GPU[];
  inferencePort?: number;
  error?: string;
};

const hidden: ControllerMatrixSnapshot = { rows: [], activeUrl: "", visible: false };

let controllers: SavedController[] = [];
let snapshot: ControllerMatrixSnapshot = hidden;
const listeners = new Set<() => void>();
let started = false;
let pollFiber: Fiber.Fiber<void, unknown> | null = null;
let pollSeq = 0;

function sameUrl(a: string, b: string): boolean {
  return normalizeControllerUrl(a) === normalizeControllerUrl(b);
}

function activeUrlFor(): string {
  return normalizeControllerUrl(getStoredBackendUrl() || controllers[0]?.url || "") ?? "";
}

function buildSnapshot(
  controller: SavedController,
  index: number,
  extras: SnapshotExtras,
): ControllerSnapshot {
  return { ...controller, index, primary: index === 0, ...extras };
}

function pendingSnapshot(controller: SavedController, index: number): ControllerSnapshot {
  return buildSnapshot(controller, index, {
    online: false,
    authRequired: false,
    running: false,
    process: null,
    gpus: [],
  });
}

function loadControllers(): SavedController[] {
  const saved = loadSavedControllers();
  const byUrl = new Map<string, SavedController>();
  const activeUrl = normalizeControllerUrl(getStoredBackendUrl());
  for (const controller of saved) {
    const url = normalizeControllerUrl(controller.url);
    if (!url) continue;
    byUrl.set(url, { ...controller, url });
  }
  if (activeUrl && !byUrl.has(activeUrl)) byUrl.set(activeUrl, { url: activeUrl });
  if (byUrl.size === 0) {
    const primary = normalizeControllerUrl(getStoredBackendUrl() || "http://127.0.0.1:8080");
    if (primary) byUrl.set(primary, { url: primary });
  }
  return [...byUrl.values()];
}

function emit(rows: ControllerSnapshot[]): void {
  snapshot = { rows, activeUrl: activeUrlFor(), visible: controllers.length > 1 };
  for (const listener of listeners) listener();
}

function reload(): void {
  controllers = loadControllers();
  const kept = snapshot.rows.filter((row) =>
    controllers.some((controller) => sameUrl(controller.url, row.url)),
  );
  emit(kept.length ? kept : controllers.map(pendingSnapshot));
  void pollOnce();
}

async function pollOnce(): Promise<void> {
  if (controllers.length === 0) return;
  const seq = ++pollSeq;
  const rows = await Promise.all(controllers.map(pollController));
  if (seq !== pollSeq) return;
  emit(rows);
}

async function pollController(
  controller: SavedController,
  index: number,
): Promise<ControllerSnapshot> {
  const api = createApiClient({
    baseUrl: "/api/proxy",
    useProxy: true,
    backendUrlOverride: controller.url,
    apiKeyOverride: controller.apiKey,
  });
  const [statusResult, gpuResult] = await Promise.allSettled([
    api.getStatus(POLL_REQUEST),
    api.getGPUs(POLL_REQUEST),
  ]);
  if (statusResult.status === "rejected") {
    const auth = isAuthRequiredError(statusResult.reason);
    return buildSnapshot(controller, index, {
      online: false,
      authRequired: auth,
      running: false,
      process: null,
      gpus: [],
      error: auth ? "auth required" : errorMessage(statusResult.reason),
    });
  }
  return buildSnapshot(controller, index, {
    online: true,
    authRequired: false,
    running: statusResult.value.running,
    process: statusResult.value.process,
    inferencePort: statusResult.value.inference_port,
    gpus: gpuResult.status === "fulfilled" ? gpuResult.value.gpus : [],
  });
}

function isAuthRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  reload();
  window.addEventListener("storage", reload);
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, reload);
  window.addEventListener(CONTROLLERS_CHANGED_EVENT, reload);
  pollFiber = Effect.runFork(
    Effect.sync(() => void pollOnce()).pipe(Effect.repeat(Schedule.spaced(POLL_INTERVAL_MS))),
  ) as Fiber.Fiber<void, unknown>;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getMatrixSnapshot(): ControllerMatrixSnapshot {
  return snapshot;
}

export function useControllerMatrixStore(): ControllerMatrixSnapshot {
  start();
  return useSyncExternalStore(subscribe, getMatrixSnapshot, getMatrixSnapshot);
}

export function activateController(controller: ControllerSnapshot): void {
  if (controller.apiKey) setApiKey(controller.apiKey);
  setStoredBackendUrl(controller.url);
  void fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backendUrl: controller.url, apiKey: controller.apiKey || "" }),
  }).finally(() => window.dispatchEvent(new Event("storage")));
}
