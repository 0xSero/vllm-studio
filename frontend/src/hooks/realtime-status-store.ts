"use client";

// THE single owner of controller-level status: reachability, running process,
// GPUs, metrics, launch progress, runtime summary. Fed by the controller SSE
// (vllm:controller-event, dispatched by use-controller-events) with a 5s
// poll+backoff fallback. Views derive from the snapshot via
// realtime-status-store/derive.ts — nothing else may poll getStatus or listen
// to controller events for status.

import { useSyncExternalStore } from "react";
import { Effect, Fiber, Schedule } from "effect";
import type {
  GPU,
  LaunchProgressData,
  Metrics,
  ProcessInfo,
  RuntimePlatformKind,
  RuntimeGpuMonitoringInfo,
  RuntimeBackendInfo,
} from "@/lib/types";

import api from "@/lib/api/client";
import { BACKEND_URL_CHANGED_EVENT } from "@/lib/api/connection";

const FAST_STATUS_REQUEST = { timeout: 5_000, retries: 0 } as const;
const FAST_COMPAT_REQUEST = { timeout: 5_000, retries: 0 } as const;
const FAST_GPU_REQUEST = { timeout: 5_000, retries: 0 } as const;

type ControllerEventDetail = { type?: string; data?: Record<string, unknown> };
type PolledStatus = Awaited<ReturnType<typeof api.getStatus>>;
type PolledCompatibility = Awaited<ReturnType<typeof api.getCompatibility>>;
type PollResults = {
  compatibility: PolledCompatibility | null;
  gpus: GPU[];
  metrics: Metrics | null;
  status: PolledStatus | null;
  statusConnected: boolean;
};

const unavailableBackend = (): RuntimeBackendInfo => ({
  installed: false,
  version: null,
});

function normalizeRuntimeBackends(
  backends: Partial<RuntimeSummaryData["backends"]> | null | undefined,
): RuntimeSummaryData["backends"] {
  return {
    vllm: backends?.vllm ?? unavailableBackend(),
    sglang: backends?.sglang ?? unavailableBackend(),
    llamacpp: backends?.llamacpp ?? unavailableBackend(),
    ...(backends?.mlx ? { mlx: backends.mlx } : {}),
  };
}

const initialSnapshot: RealtimeStatusSnapshot = {
  status: null,
  statusLoading: true,
  connected: false,
  gpus: [],
  metrics: null,
  launchProgress: null,
  platformKind: null,
  runtimeSummary: null,
  services: [],
  lease: null,
  lastEventAt: 0,
};

let snapshot: RealtimeStatusSnapshot = initialSnapshot;
const listeners = new Set<() => void>();
let started = false;
let pollFiber: Fiber.RuntimeFiber<void, unknown> | null = null;
let clearLaunchTimer: ReturnType<typeof setTimeout> | null = null;
let pollFailureStreak = 0;
let pollBackoffUntil = 0;

const POLL_BASE_INTERVAL_MS = 5_000;
const POLL_MAX_BACKOFF_MS = 30_000;

function notePollOutcome(connected: boolean) {
  if (connected) {
    pollFailureStreak = 0;
    pollBackoffUntil = 0;
    return;
  }
  pollFailureStreak = Math.min(pollFailureStreak + 1, 6);
  const backoff = Math.min(
    POLL_MAX_BACKOFF_MS,
    POLL_BASE_INTERVAL_MS * 2 ** (pollFailureStreak - 1),
  );
  pollBackoffUntil = Date.now() + backoff;
}

function processKey(process: ProcessInfo | null | undefined): string {
  if (!process) return "";
  return [
    process.pid,
    process.backend,
    process.port,
    process.served_model_name ?? "",
    process.model_path ?? "",
  ].join("|");
}

function emitIfChanged(next: RealtimeStatusSnapshot) {
  const changed =
    !areStatusEqual(snapshot.status, next.status) ||
    snapshot.statusLoading !== next.statusLoading ||
    snapshot.connected !== next.connected ||
    !areGpusEqual(snapshot.gpus, next.gpus) ||
    !areMetricsEqual(snapshot.metrics, next.metrics) ||
    !areLaunchProgressEqual(snapshot.launchProgress, next.launchProgress) ||
    !arePlatformKindsEqual(snapshot.platformKind, next.platformKind) ||
    !areRuntimeSummariesEqual(snapshot.runtimeSummary, next.runtimeSummary) ||
    !areServicesEqual(snapshot.services, next.services) ||
    !areLeasesEqual(snapshot.lease, next.lease);

  snapshot = changed ? next : { ...snapshot, lastEventAt: next.lastEventAt };
  if (!changed) return;

  for (const l of listeners) l();
}

function reconcileLaunchProgress(
  progress: LaunchProgressData | null,
  status: { process: ProcessInfo | null; launching: string | null } | null,
): LaunchProgressData | null {
  if (!progress || !isActiveLaunchStage(progress.stage)) return progress;
  if (!status) return progress;
  if (status.process || status.launching) return progress;
  return null;
}

function scheduleLaunchClear(stage: LaunchProgressData["stage"]) {
  if (clearLaunchTimer) {
    clearTimeout(clearLaunchTimer);
    clearLaunchTimer = null;
  }
  if (stage === "ready" || stage === "error" || stage === "cancelled") {
    clearLaunchTimer = setTimeout(() => {
      emitIfChanged({
        ...snapshot,
        launchProgress: null,
        lastEventAt: Date.now(),
      });
    }, 5000);
  }
}

function emitStatusLoading() {
  if (snapshot.statusLoading) return;
  emitIfChanged({
    ...snapshot,
    statusLoading: true,
    lastEventAt: Date.now(),
  });
}

async function fetchPollResults(): Promise<PollResults> {
  const [statusResult, compatibilityResult, gpuResult, metricsResult] = await Promise.allSettled([
    api.getStatus(FAST_STATUS_REQUEST),
    api.getCompatibility(FAST_COMPAT_REQUEST),
    api.getGPUs(FAST_GPU_REQUEST),
    api.getMetrics().catch(() => null),
  ]);
  const status = statusResult.status === "fulfilled" ? statusResult.value : null;
  return {
    compatibility: compatibilityResult.status === "fulfilled" ? compatibilityResult.value : null,
    gpus:
      gpuResult.status === "fulfilled" ? (gpuResult.value.gpus ?? snapshot.gpus) : snapshot.gpus,
    metrics: pollMetrics(metricsResult, status),
    status,
    statusConnected: statusResult.status === "fulfilled",
  };
}

function pollMetrics(
  result: PromiseSettledResult<Metrics | null>,
  status: PolledStatus | null,
): Metrics | null {
  if (result.status === "fulfilled" && result.value) return result.value;
  return processKey(snapshot.status?.process) === processKey(status?.process)
    ? snapshot.metrics
    : null;
}

function fallbackRuntimeVendor(
  kind: RuntimeSummaryData["platform"]["kind"] | null | undefined,
): RuntimeSummaryData["platform"]["vendor"] {
  if (kind === "cuda") return "nvidia";
  if (kind === "rocm") return "amd";
  return null;
}

function runtimeSummaryFromCompatibility(
  current: RuntimeSummaryData | null,
  compatibility: PolledCompatibility | null,
): RuntimeSummaryData | null {
  if (current || !compatibility) return current;
  const kind = compatibility.platform.kind;
  return {
    platform: { kind, vendor: fallbackRuntimeVendor(kind) },
    gpu_monitoring: compatibility.gpu_monitoring,
    backends: normalizeRuntimeBackends(compatibility.backends),
  };
}

function emitNoPolledStatus() {
  emitIfChanged({
    ...snapshot,
    statusLoading: false,
    connected: false,
    lastEventAt: Date.now(),
  });
}

function emitPolledStatus({ compatibility, gpus, metrics, status }: PollResults) {
  if (!status) return emitNoPolledStatus();
  const { running, process, inference_port } = status;
  const launching = status.launching ?? null;
  emitIfChanged({
    status: { running, process, inference_port, launching },
    statusLoading: false,
    connected: true,
    gpus,
    metrics,
    launchProgress: reconcileLaunchProgress(snapshot.launchProgress, {
      process: process ?? null,
      launching,
    }),
    platformKind: compatibility?.platform?.kind ?? snapshot.platformKind,
    runtimeSummary: runtimeSummaryFromCompatibility(snapshot.runtimeSummary, compatibility),
    services: snapshot.services,
    lease: snapshot.lease,
    lastEventAt: Date.now(),
  });
}

function statusFromEventData(
  data: Record<string, unknown>,
): NonNullable<RealtimeStatusSnapshot["status"]> {
  const process = (data["process"] ?? null) as ProcessInfo | null;
  return {
    running: Boolean(data["running"] ?? process),
    process,
    inference_port: Number(data["inference_port"] ?? 8000),
    launching:
      typeof data["launching"] === "string" && data["launching"] ? data["launching"] : null,
  };
}

function metricsForEventProcess(process: ProcessInfo | null): Metrics | null {
  return processKey(snapshot.status?.process) === processKey(process) ? snapshot.metrics : null;
}

function handleStatusEvent(data: Record<string, unknown>, now: number) {
  // A live status event means the selected backend is reachable; clear any
  // poll backoff so a recovered connection resumes fast polling.
  notePollOutcome(true);
  const status = statusFromEventData(data);
  emitIfChanged({
    ...snapshot,
    status,
    statusLoading: false,
    connected: true,
    metrics: metricsForEventProcess(status.process),
    launchProgress: reconcileLaunchProgress(snapshot.launchProgress, {
      process: status.process,
      launching: status.launching,
    }),
    lastEventAt: now,
  });
}

function handleGpuEvent(data: Record<string, unknown>, now: number) {
  const list = (data["gpus"] ?? []) as GPU[];
  emitIfChanged({
    ...snapshot,
    gpus: Array.isArray(list) ? list : [],
    lastEventAt: now,
  });
}

function handleMetricsEvent(data: Record<string, unknown>, now: number) {
  emitIfChanged({
    ...snapshot,
    metrics: data as Metrics,
    lastEventAt: now,
  });
}

function handleLaunchProgressEvent(data: Record<string, unknown>, now: number) {
  const progress = data as unknown as LaunchProgressData;
  scheduleLaunchClear(progress.stage);
  emitIfChanged({
    ...snapshot,
    // A live launch event proves the controller is reachable even before the
    // first successful status poll.
    connected: true,
    launchProgress: progress,
    lastEventAt: now,
  });
}

type RuntimeSummaryEventPlatform = { kind?: string; vendor?: string | null };

function handleRuntimeSummaryEvent(data: Record<string, unknown>, now: number) {
  const platform = data["platform"] as RuntimeSummaryEventPlatform | undefined;
  const nextKind =
    platform?.kind === "cuda" || platform?.kind === "rocm" || platform?.kind === "unknown"
      ? platform.kind
      : snapshot.platformKind;
  const nextVendor =
    platform?.vendor === "nvidia" || platform?.vendor === "amd"
      ? platform.vendor
      : fallbackRuntimeVendor(nextKind);
  const gpuMon = data["gpu_monitoring"] as RuntimeSummaryData["gpu_monitoring"] | undefined;
  const backends = data["backends"] as Partial<RuntimeSummaryData["backends"]> | undefined;
  const rawServices = data["services"] as ServiceEntry[] | undefined;
  const rawLease = data["lease"] as LeaseInfo | undefined;

  emitIfChanged({
    status: snapshot.status,
    statusLoading: snapshot.statusLoading,
    connected: snapshot.connected,
    gpus: snapshot.gpus,
    metrics: snapshot.metrics,
    launchProgress: snapshot.launchProgress,
    platformKind: nextKind,
    runtimeSummary:
      platform && gpuMon && backends
        ? {
            platform: { kind: nextKind ?? "unknown", vendor: nextVendor },
            gpu_monitoring: gpuMon,
            backends: normalizeRuntimeBackends(backends),
          }
        : snapshot.runtimeSummary,
    services: Array.isArray(rawServices) ? rawServices : snapshot.services,
    lease: rawLease ?? snapshot.lease,
    lastEventAt: now,
  });
}

const controllerEventHandlers: Record<
  string,
  (data: Record<string, unknown>, now: number) => void
> = {
  status: handleStatusEvent,
  gpu: handleGpuEvent,
  metrics: handleMetricsEvent,
  launch_progress: handleLaunchProgressEvent,
  runtime_summary: handleRuntimeSummaryEvent,
};

function handleControllerEvent(detail: ControllerEventDetail | undefined) {
  controllerEventHandlers[detail?.type ?? ""]?.(detail?.data ?? {}, Date.now());
}

async function fetchStatusNow() {
  emitStatusLoading();
  const results = await fetchPollResults();
  notePollOutcome(results.statusConnected);
  emitPolledStatus(results);
}

function resetForControllerSwitch() {
  emitIfChanged({
    ...initialSnapshot,
    lastEventAt: Date.now(),
  });
  void fetchStatusNow();
}

function start() {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  const onControllerEvent = (event: Event) => {
    handleControllerEvent((event as CustomEvent<ControllerEventDetail>).detail);
  };

  window.addEventListener("vllm:controller-event", onControllerEvent as EventListener);
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, resetForControllerSwitch);

  // Initial fetch + polling fallback in case SSE is blocked. Runs as an Effect
  // fiber on a fixed schedule — the poll body checks the SSE freshness window
  // and backoff gate before firing, same logic as the old setInterval.
  void fetchStatusNow();
  const pollProgram = Effect.sync(() => {
    const now = Date.now();
    if (now - snapshot.lastEventAt < 10_000) return;
    if (now < pollBackoffUntil) return;
    void fetchStatusNow();
  }).pipe(Effect.repeat(Schedule.spaced(POLL_BASE_INTERVAL_MS)));
  pollFiber = Effect.runFork(pollProgram) as never;

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      void fetchStatusNow();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) void fetchStatusNow();
  };
  window.addEventListener("pageshow", onPageShow);
}

export function useRealtimeStatusStore(): RealtimeStatusSnapshot {
  start();
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => snapshot,
    () => initialSnapshot,
  );
}

export interface StatusData {
  running: boolean;
  process: ProcessInfo | null;
  inference_port: number;
  launching: string | null;
}

export interface RuntimeSummaryData {
  platform: { kind: RuntimePlatformKind; vendor: "nvidia" | "amd" | null };
  gpu_monitoring: RuntimeGpuMonitoringInfo;
  backends: {
    vllm: RuntimeBackendInfo;
    sglang: RuntimeBackendInfo;
    llamacpp: RuntimeBackendInfo;
    mlx?: RuntimeBackendInfo;
  };
}

export interface ServiceEntry {
  id: string;
  kind: string;
  status: string;
  last_error?: string | null;
}

export interface LeaseInfo {
  holder: string | null;
  since: string | null;
}

export interface RealtimeStatusSnapshot {
  status: StatusData | null;
  statusLoading: boolean;
  /** Controller reachability: the last poll succeeded or a live event arrived. */
  connected: boolean;
  gpus: GPU[];
  metrics: Metrics | null;
  launchProgress: LaunchProgressData | null;
  platformKind: RuntimePlatformKind | null;
  runtimeSummary: RuntimeSummaryData | null;
  services: ServiceEntry[];
  lease: LeaseInfo | null;
  lastEventAt: number;
}

// Pure derivations over the realtime status snapshot. No state, no IO — the
// realtime-status-store owns the data; consumers derive their views here.

export function isActiveLaunchStage(
  stage: LaunchProgressData["stage"] | null | undefined,
): boolean {
  return (
    stage === "preempting" || stage === "evicting" || stage === "launching" || stage === "waiting"
  );
}

export type SidebarStatusSnapshot = {
  online: boolean;
  inferenceOnline: boolean;
  model: string | null;
  activityLine: string;
};

function computeModelName(process: ProcessInfo | null | undefined): string | null {
  if (!process) return null;
  const served = process.served_model_name;
  if (typeof served === "string" && served.trim()) return served.trim();
  const modelPath = process.model_path;
  if (typeof modelPath === "string" && modelPath.trim())
    return modelPath.split("/").pop() ?? modelPath;
  return null;
}

export function sidebarStatusFromSnapshot(
  snapshot: Pick<RealtimeStatusSnapshot, "connected" | "status" | "launchProgress">,
): SidebarStatusSnapshot {
  const { connected, status, launchProgress } = snapshot;
  const inferenceOnline = Boolean(status?.running || status?.process);
  const model = computeModelName(status?.process);
  const launchMessage =
    launchProgress && isActiveLaunchStage(launchProgress.stage) ? launchProgress.message : null;

  const activityLine = launchMessage
    ? launchMessage
    : inferenceOnline
      ? model || "Ready"
      : connected
        ? "No model"
        : "Offline";

  return { online: connected, inferenceOnline, model, activityLine };
}

function areProcessInfosEqual(a: ProcessInfo | null, b: ProcessInfo | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.pid === b.pid &&
    a.backend === b.backend &&
    a.model_path === b.model_path &&
    a.port === b.port &&
    (a.served_model_name ?? null) === (b.served_model_name ?? null)
  );
}

export function areStatusEqual(a: StatusData | null, b: StatusData | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.running === b.running &&
    a.inference_port === b.inference_port &&
    areProcessInfosEqual(a.process, b.process)
  );
}

const GPU_STABLE_KEYS = [
  "index",
  "name",
  "memory_total",
  "memory_used",
  "memory_free",
  "utilization",
] as const satisfies ReadonlyArray<keyof GPU>;

const GPU_NULLABLE_KEYS = [
  "temperature",
  "power_draw",
  "power_limit",
] as const satisfies ReadonlyArray<keyof GPU>;

function areGpuEntriesEqual(left: GPU, right: GPU): boolean {
  return (
    GPU_STABLE_KEYS.every((key) => left[key] === right[key]) &&
    GPU_NULLABLE_KEYS.every((key) => (left[key] ?? null) === (right[key] ?? null))
  );
}

export function areGpusEqual(a: GPU[], b: GPU[]) {
  if (a === b) return true;
  return a.length === b.length && a.every((left, index) => areGpuEntriesEqual(left, b[index]!));
}

export function arePlatformKindsEqual(
  a: RuntimePlatformKind | null,
  b: RuntimePlatformKind | null,
) {
  return a === b;
}

export function areMetricsEqual(a: Metrics | null, b: Metrics | null) {
  if (a === b) return true;
  if (!a || !b) return false;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!(key in b)) return false;
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }

  return true;
}

export function areLaunchProgressEqual(a: LaunchProgressData | null, b: LaunchProgressData | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.recipe_id === b.recipe_id &&
    a.stage === b.stage &&
    a.message === b.message &&
    (a.progress ?? null) === (b.progress ?? null)
  );
}

export function areRuntimeSummariesEqual(
  a: RuntimeSummaryData | null,
  b: RuntimeSummaryData | null,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.platform.kind !== b.platform.kind) return false;
  if (a.gpu_monitoring.available !== b.gpu_monitoring.available) return false;
  if (a.gpu_monitoring.tool !== b.gpu_monitoring.tool) return false;
  for (const key of ["vllm", "sglang", "llamacpp", "mlx"] as const) {
    if (!a.backends[key] && !b.backends[key]) continue;
    if (!a.backends[key] || !b.backends[key]) return false;
    if (a.backends[key].installed !== b.backends[key].installed) return false;
    if (a.backends[key].version !== b.backends[key].version) return false;
  }
  return true;
}

export function areServicesEqual(a: ServiceEntry[], b: ServiceEntry[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const l = a[i]!;
    const r = b[i]!;
    if (l.id !== r.id || l.kind !== r.kind || l.status !== r.status) return false;
  }
  return true;
}

export function areLeasesEqual(a: LeaseInfo | null, b: LeaseInfo | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.holder === b.holder;
}
