"use client";

import { useSyncExternalStore } from "react";
import { Effect, Result } from "effect";
import { effectInterval, effectTimeout, type EffectTimer } from "@/lib/effect-timers";
import type {
  GPU,
  LaunchProgressData,
  Metrics,
  ProcessInfo,
  RuntimeBackendInfo,
} from "@/lib/types";

import api from "@/lib/api/client";
import { BACKEND_URL_CHANGED_EVENT, getStoredBackendUrl } from "@/lib/api/connection";
import { normalizeGpuAliases } from "@/lib/api/system";
import {
  isActiveLaunchStage,
  type LeaseInfo,
  type RealtimeStatusSnapshot,
  type RuntimeSummaryData,
  type ServiceEntry,
} from "./realtime-status-types";

const FAST_REQUEST = { timeout: 5_000, retries: 0 } as const;

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
type SnapshotPatch = Partial<Omit<RealtimeStatusSnapshot, "lastEventAt">>;

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
const snapshotsByController = new Map<string, RealtimeStatusSnapshot>();
const listeners = new Set<() => void>();
let started = false;
let clearLaunchTimer: EffectTimer | null = null;
let pollFailureStreak = 0;
let pollBackoffUntil = 0;
let activeControllerKey = currentControllerKey();
let statusRequestSeq = 0;

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

function currentControllerKey(): string {
  if (typeof window === "undefined") return "server";
  return getStoredBackendUrl() || "default";
}

function cacheActiveSnapshot(): void {
  snapshotsByController.set(activeControllerKey, snapshot);
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
    JSON.stringify({ ...snapshot, lastEventAt: 0 }) !== JSON.stringify({ ...next, lastEventAt: 0 });

  snapshot = changed ? next : { ...snapshot, lastEventAt: next.lastEventAt };
  cacheActiveSnapshot();
  if (!changed) return;

  for (const l of listeners) l();
}

function emitPatch(patch: SnapshotPatch, lastEventAt = Date.now()) {
  emitIfChanged({ ...snapshot, ...patch, lastEventAt });
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
  clearLaunchTimer?.cancel();
  clearLaunchTimer = null;
  if (stage === "ready" || stage === "error" || stage === "cancelled") {
    clearLaunchTimer = effectTimeout(() => emitPatch({ launchProgress: null }), 5000);
  }
}

function emitStatusLoading() {
  if (snapshot.statusLoading) return;
  emitPatch({ statusLoading: true });
}

const requestEffect = <T>(load: () => Promise<T>): Effect.Effect<T, unknown> =>
  Effect.tryPromise({ try: load, catch: (error) => error });

function fetchPollResultsEffect(): Effect.Effect<PollResults> {
  return Effect.gen(function* () {
    const [statusResult, compatibilityResult, gpuResult, metricsResult] = yield* Effect.all([
      Effect.result(requestEffect(() => api.getStatus(FAST_REQUEST))),
      Effect.result(requestEffect(() => api.getCompatibility(FAST_REQUEST))),
      Effect.result(requestEffect(() => api.getGPUs(FAST_REQUEST))),
      Effect.result(
        requestEffect(() => api.getMetrics()).pipe(Effect.catch(() => Effect.succeed(null))),
      ),
    ] as const);
    const status = Result.isSuccess(statusResult) ? statusResult.success : null;
    return {
      compatibility: Result.isSuccess(compatibilityResult) ? compatibilityResult.success : null,
      gpus: Result.isSuccess(gpuResult) ? (gpuResult.success.gpus ?? snapshot.gpus) : snapshot.gpus,
      metrics: pollMetrics(metricsResult, status),
      status,
      statusConnected: Result.isSuccess(statusResult),
    };
  });
}

function pollMetrics(
  result: Result.Result<Metrics | null, unknown>,
  status: PolledStatus | null,
): Metrics | null {
  if (Result.isSuccess(result) && result.success) return result.success;
  return processKey(snapshot.status?.process) === processKey(status?.process)
    ? snapshot.metrics
    : null;
}

function fallbackRuntimeVendor(
  kind: RuntimeSummaryData["platform"]["kind"] | null | undefined,
): RuntimeSummaryData["platform"]["vendor"] {
  if (kind === "cuda") return "nvidia";
  if (kind === "rocm") return "amd";
  if (kind === "metal") return "apple";
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
  const hasCachedStatus = Boolean(
    snapshot.status || snapshot.runtimeSummary || snapshot.gpus.length,
  );
  emitPatch({
    statusLoading: false,
    connected: hasCachedStatus && pollFailureStreak <= 3 ? snapshot.connected : false,
  });
}

function emitPolledStatus({ compatibility, gpus, metrics, status }: PollResults) {
  if (!status) return emitNoPolledStatus();
  const { running, process, inference_port } = status;
  const launching = status.launching ?? null;
  emitPatch({
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

function statusEventPatch(data: Record<string, unknown>): SnapshotPatch {
  const status = statusFromEventData(data);
  return {
    status,
    statusLoading: false,
    connected: true,
    metrics: metricsForEventProcess(status.process),
    launchProgress: reconcileLaunchProgress(snapshot.launchProgress, {
      process: status.process,
      launching: status.launching,
    }),
  };
}

type RuntimeSummaryEventPlatform = { kind?: string; vendor?: string | null };
const RUNTIME_PLATFORM_KINDS = new Set<RuntimeSummaryData["platform"]["kind"]>([
  "cuda",
  "rocm",
  "metal",
  "unknown",
]);
const RUNTIME_PLATFORM_VENDORS = new Set<Exclude<RuntimeSummaryData["platform"]["vendor"], null>>([
  "nvidia",
  "amd",
  "apple",
]);

function runtimeSummaryEventPatch(data: Record<string, unknown>): SnapshotPatch {
  const platform = data["platform"] as RuntimeSummaryEventPlatform | undefined;
  const nextKind =
    platform?.kind &&
    RUNTIME_PLATFORM_KINDS.has(platform.kind as RuntimeSummaryData["platform"]["kind"])
      ? (platform.kind as RuntimeSummaryData["platform"]["kind"])
      : snapshot.platformKind;
  const nextVendor =
    platform?.vendor &&
    RUNTIME_PLATFORM_VENDORS.has(
      platform.vendor as Exclude<RuntimeSummaryData["platform"]["vendor"], null>,
    )
      ? (platform.vendor as Exclude<RuntimeSummaryData["platform"]["vendor"], null>)
      : fallbackRuntimeVendor(nextKind);
  const gpuMon = data["gpu_monitoring"] as RuntimeSummaryData["gpu_monitoring"] | undefined;
  const backends = data["backends"] as Partial<RuntimeSummaryData["backends"]> | undefined;
  const rawServices = data["services"] as ServiceEntry[] | undefined;
  const rawLease = data["lease"] as LeaseInfo | undefined;

  return {
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
  };
}

const controllerEventHandlers: Record<string, (data: Record<string, unknown>) => SnapshotPatch> = {
  status: statusEventPatch,
  gpu: (data) => ({ gpus: normalizeGpuAliases(data["gpus"]) }),
  metrics: (data) => ({ metrics: data as Metrics }),
  launch_progress: (data) => ({
    connected: true,
    launchProgress: data as unknown as LaunchProgressData,
  }),
  runtime_summary: runtimeSummaryEventPatch,
};

function handleControllerEvent(detail: ControllerEventDetail | undefined) {
  const type = detail?.type ?? "";
  const handler = controllerEventHandlers[type];
  if (!handler) return;
  const patch = handler(detail?.data ?? {});
  if (type === "status") notePollOutcome(true);
  if (patch.launchProgress) scheduleLaunchClear(patch.launchProgress.stage);
  emitPatch(patch);
}

function fetchStatusNow(controllerKey = activeControllerKey): Promise<void> {
  return Effect.runPromise(fetchStatusNowEffect(controllerKey));
}

function fetchStatusNowEffect(controllerKey = activeControllerKey): Effect.Effect<void> {
  return Effect.gen(function* () {
    const requestSeq = ++statusRequestSeq;
    if (controllerKey !== activeControllerKey) return;
    emitStatusLoading();
    const results = yield* fetchPollResultsEffect();
    if (controllerKey !== activeControllerKey || requestSeq !== statusRequestSeq) return;
    notePollOutcome(results.statusConnected);
    emitPolledStatus(results);
  });
}

function resetForControllerSwitch() {
  cacheActiveSnapshot();
  activeControllerKey = currentControllerKey();
  statusRequestSeq += 1;
  pollFailureStreak = 0;
  pollBackoffUntil = 0;
  const cached = snapshotsByController.get(activeControllerKey);
  emitIfChanged({
    ...(cached ?? initialSnapshot),
    statusLoading: true,
    lastEventAt: Date.now(),
  });
  void fetchStatusNow(activeControllerKey);
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

  void fetchStatusNow();
  effectInterval(() => {
    const now = Date.now();
    if (now - snapshot.lastEventAt < 10_000) return;
    if (now < pollBackoffUntil) return;
    void fetchStatusNow();
  }, POLL_BASE_INTERVAL_MS);

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
