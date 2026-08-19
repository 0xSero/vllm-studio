"use client";

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  exclusiveLaneOf,
  shouldRequestLaneSwitch,
  type ExclusiveLane,
  type ResidentLane,
} from "@shared/agent/lane-identity";
import { CONTROLLER_EVENTS } from "@/lib/controller-events-contract";
import api from "@/lib/api/client";
import type { LaneStatus, LaneSwitchJob } from "@/lib/api/studio";
import { LaneEnableSwitchDialog } from "@/features/agent/ui/lane-enable-switch-dialog";

export type LaneSnapshot = LaneStatus | "unknown";
type Callbacks = { setError: (error: string) => void; setSessionError?: (error: string) => void };
type Pending = {
  nextId: string;
  target: ExclusiveLane;
  resident: ResidentLane;
  commit: (id: string) => void;
};
type PollContext = Pending & Callbacks & { onDone: () => void };
type Decision =
  | { action: "commit" }
  | { action: "block"; error: "lane_status_unavailable" }
  | { action: "confirm"; target: ExclusiveLane; resident: ResidentLane };

const UNAVAILABLE = "Lane status unavailable.";
const IN_PROGRESS = "Lane switch in progress.";
const listeners = new Set<() => void>();
let lastEnabled: boolean | null = null;
let snapshot: LaneSnapshot = "unknown";
let pendingGet: Promise<LaneStatus> | null = null;
let browserOn = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollBusy = false;
let pollContext: PollContext | null = null;

const emit = () => {
  for (const listener of listeners) listener();
};
const busy = (state: string | null | undefined) => state === "running" || state === "restoring";
const errMsg = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback;

const getLaneSnapshot = (): LaneSnapshot => snapshot;
const getLastEnabled = (): boolean | null => lastEnabled;

export function decideModelChange(
  nextId: string,
  nextSnapshot: LaneSnapshot,
  enabled: boolean | null,
): Decision {
  const exclusive = exclusiveLaneOf(nextId);
  if (nextSnapshot === "unknown") {
    return exclusive && enabled === true
      ? { action: "block", error: "lane_status_unavailable" }
      : { action: "commit" };
  }
  if (!nextSnapshot.enabled) return { action: "commit" };
  const target = shouldRequestLaneSwitch(nextId, nextSnapshot.resident_lane);
  return target
    ? { action: "confirm", target, resident: nextSnapshot.resident_lane }
    : { action: "commit" };
}

export function notResident(modelId: string, nextSnapshot: LaneSnapshot = snapshot): boolean {
  if (nextSnapshot === "unknown" || nextSnapshot.resident_lane === "conflict") return false;
  const lane = exclusiveLaneOf(modelId);
  return lane !== null && lane !== nextSnapshot.resident_lane;
}

export function composerLaneBlockReason(
  modelId: string,
  nextSnapshot: LaneSnapshot = snapshot,
  enabled: boolean | null = lastEnabled,
): string | null {
  const lane = exclusiveLaneOf(modelId);
  if (!lane || enabled !== true) return null;
  if (nextSnapshot === "unknown") return UNAVAILABLE;
  if (busy(nextSnapshot.switch.state)) return IN_PROGRESS;
  if (nextSnapshot.resident_lane === lane) return null;
  return lane === "ds4"
    ? "DeepSeek V4 Flash is not loaded. Pick it in the model list to switch lanes."
    : "oMLX (Laguna) is not loaded. Pick it in the model list to switch lanes.";
}

export function laneSwitchDialogCopy(resident: ResidentLane, target: ExclusiveLane) {
  const none = resident === "none";
  if (target === "ds4") {
    return {
      title: "Switch to DeepSeek V4 Flash?",
      body: none
        ? "This loads DeepSeek V4 Flash (~81 GB). The switch takes several minutes."
        : "This unloads the oMLX pool (Laguna-S, Laguna-XS, and Qwen3.8) and loads DeepSeek V4 Flash (~81 GB). They cannot be resident together on this machine. The switch takes several minutes.",
    };
  }
  return {
    title: "Switch to oMLX (Laguna)?",
    body: none
      ? "This loads the oMLX pool (Laguna-S, Laguna-XS, and Qwen3.8). The switch takes a few minutes."
      : "This stops DeepSeek V4 Flash (~81 GB) and reloads the oMLX pool (Laguna-S, Laguna-XS, and Qwen3.8). The switch takes a few minutes.",
  };
}

export const interpretLaneSwitchJob = (job: LaneSwitchJob) =>
  job.state === "ready"
    ? ("commit" as const)
    : busy(job.state)
      ? ("poll" as const)
      : ("error" as const);

export const interpretPolledLanes = (status: LaneStatus, target: ExclusiveLane) =>
  status.switch.state === "failed"
    ? ("fail" as const)
    : status.resident_lane === target && !busy(status.switch.state)
      ? ("commit" as const)
      : busy(status.switch.state)
        ? ("poll" as const)
        : ("fail" as const);

export async function refreshLaneSnapshot(): Promise<"ok" | "fail"> {
  try {
    pendingGet ??= api.getLanes().finally(() => {
      pendingGet = null;
    });
    const body = await pendingGet;
    lastEnabled = body.enabled;
    snapshot = body;
    emit();
    return "ok";
  } catch {
    snapshot = "unknown";
    emit();
    return "fail";
  }
}

function stopPoll() {
  if (pollTimer != null) clearTimeout(pollTimer);
  pollTimer = null;
  pollBusy = false;
  pollContext = null;
}

function failPoll(message: string) {
  const ctx = pollContext;
  if (!ctx) return;
  ctx.setError(message);
  ctx.setSessionError?.(message);
  ctx.onDone();
  stopPoll();
}

async function pollTick() {
  const ctx = pollContext;
  if (!ctx) return stopPoll();
  pollBusy = true;
  const ok = (await refreshLaneSnapshot()) === "ok";
  const current = pollContext;
  if (!current) {
    pollBusy = false;
    return;
  }
  const status = snapshot;
  if (!ok || status === "unknown") return failPoll(UNAVAILABLE);
  const step = interpretPolledLanes(status, current.target);
  if (step === "commit") {
    current.commit(current.nextId);
    current.onDone();
    return stopPoll();
  }
  if (step === "fail") return failPoll(status.switch.error?.trim() || "Lane switch failed.");
  pollBusy = false;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollTick();
  }, 1_000);
}

function startPoll(ctx: PollContext) {
  pollContext = ctx;
  if (pollTimer == null && !pollBusy) void pollTick();
}

function onFocus() {
  void refreshLaneSnapshot();
}
function onVisible() {
  if (document.visibilityState === "visible") void refreshLaneSnapshot();
}
function onControllerEvent(event: Event) {
  if ((event as CustomEvent<{ type?: string }>).detail?.type === CONTROLLER_EVENTS.LANE_SWITCH) {
    void refreshLaneSnapshot();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    browserOn = true;
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("vllm:controller-event", onControllerEvent);
    void refreshLaneSnapshot();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size !== 0 || typeof window === "undefined") return;
    browserOn = false;
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("vllm:controller-event", onControllerEvent);
  };
}

export function useLaneSnapshot(): LaneSnapshot {
  return useSyncExternalStore(subscribe, getLaneSnapshot, getLaneSnapshot);
}

export function useLaneEnableSwitch({ setError, setSessionError }: Callbacks): {
  requestModelChange: (nextId: string, commit: (id: string) => void) => void;
  notResident: (modelId: string) => boolean;
  dialog: ReactNode;
} {
  const snap = useLaneSnapshot();
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [progress, setProgress] = useState<Pending | null>(null);
  const requestModelChange = useCallback(
    (nextId: string, commit: (id: string) => void) => {
      const decision = decideModelChange(nextId, getLaneSnapshot(), getLastEnabled());
      if (decision.action === "commit") return commit(nextId);
      if (decision.action === "block") {
        setError("lane_status_unavailable");
        setSessionError?.(UNAVAILABLE);
        return;
      }
      setConfirm({ nextId, target: decision.target, resident: decision.resident, commit });
    },
    [setError, setSessionError],
  );
  const onConfirm = useCallback(() => {
    if (!confirm) return;
    const pending = confirm;
    setConfirm(null);
    setProgress(pending);
    void (async () => {
      try {
        const switched = await api.switchLane(pending.target);
        const action = interpretLaneSwitchJob(switched);
        if (action === "commit") {
          pending.commit(pending.nextId);
          setProgress(null);
          void refreshLaneSnapshot();
          return;
        }
        if (action === "poll") {
          startPoll({
            ...pending,
            setError,
            setSessionError,
            onDone: () => setProgress(null),
          });
          return;
        }
        const message = switched.error?.trim() || "Lane switch failed.";
        setError(message);
        setSessionError?.(message);
        setProgress(null);
      } catch (error) {
        const message = errMsg(error, "Lane switch failed.");
        setError(message);
        setSessionError?.(message);
        setProgress(null);
      }
    })();
  }, [confirm, setError, setSessionError]);
  const active = progress ?? confirm;
  const copy = active
    ? laneSwitchDialogCopy(active.resident, active.target)
    : { title: "", body: "" };
  return {
    requestModelChange,
    notResident: (modelId) => notResident(modelId, snap),
    dialog: (
      <LaneEnableSwitchDialog
        isOpen={Boolean(active)}
        progress={Boolean(progress)}
        title={copy.title}
        body={
          progress ? (snap !== "unknown" && snap.switch.message?.trim()) || IN_PROGRESS : copy.body
        }
        onCancel={() => setConfirm(null)}
        onConfirm={onConfirm}
      />
    ),
  };
}
