"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { DesktopUpdateChannel, DesktopUpdateSnapshot } from "../../../desktop/types";

export type AppUpdatePhase = "idle" | "working" | "ready" | "failed";
export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export type AppUpdate = {
  currentVersion: string | null;
  releaseChannel: "dev" | "stable" | null;
  updateChannel: DesktopUpdateChannel | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  phase: AppUpdatePhase;
  status: AppUpdateStatus;
  progress: number | null;
  checkForUpdates: () => void;
  startUpdate: () => void;
  setUpdateChannel: (channel: DesktopUpdateChannel) => void;
};

const bridge = () => window.localStudioDesktop ?? {};

function phaseForStatus(status: string): AppUpdatePhase {
  if (status === "downloaded") return "ready";
  if (status === "checking" || status === "available" || status === "downloading") return "working";
  if (status === "error") return "failed";
  return "idle";
}

function normalizedStatus(status: string): AppUpdateStatus {
  if (
    status === "checking" ||
    status === "available" ||
    status === "not-available" ||
    status === "downloading" ||
    status === "downloaded" ||
    status === "error"
  ) {
    return status;
  }
  return "idle";
}

function snapshotProgress(snapshot: { progress?: number; message?: string }): number | null {
  const parsed =
    typeof snapshot.progress === "number"
      ? snapshot.progress
      : Number.parseFloat(snapshot.message ?? "");
  if (!Number.isFinite(parsed)) return null;
  return Math.min(100, Math.max(0, parsed));
}

export function useAppUpdate(): AppUpdate {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [releaseChannel, setReleaseChannel] = useState<"dev" | "stable" | null>(null);
  const [updateChannel, setUpdateChannelState] = useState<DesktopUpdateChannel | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<AppUpdatePhase>("idle");
  const [status, setStatus] = useState<AppUpdateStatus>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySnapshot = useCallback((snapshot: DesktopUpdateSnapshot) => {
    const nextStatus = normalizedStatus(snapshot.status);
    setStatus(nextStatus);
    setPhase(phaseForStatus(nextStatus));
    setProgress(nextStatus === "downloading" ? snapshotProgress(snapshot) : null);
    setUpdateChannelState(snapshot.channel);
    if (snapshot.version) setLatestVersion(snapshot.version);
  }, []);

  const syncDesktopPhase = useCallback(() => {
    const getStatus = bridge().getUpdateStatus;
    if (!getStatus) return;
    void getStatus().then(
      (snapshot) => {
        applySnapshot(snapshot);
        if (pollTimer.current) clearTimeout(pollTimer.current);
        pollTimer.current = setTimeout(syncDesktopPhase, 2_000);
      },
      () => {
        setStatus("error");
        setPhase("failed");
        setProgress(null);
        if (pollTimer.current) clearTimeout(pollTimer.current);
        pollTimer.current = setTimeout(syncDesktopPhase, 2_000);
      },
    );
  }, [applySnapshot]);

  useMountSubscription(() => {
    let cancelled = false;
    const desktop = bridge();
    const loadPublishedVersion = () =>
      fetch("/api/app-update", { cache: "no-store" })
        .then((response) => response.json() as Promise<{ latest?: string }>)
        .then((body) => {
          if (!cancelled) setLatestVersion(body.latest ?? null);
        })
        .catch(() => undefined);
    const runtime = desktop.getRuntime?.();
    if (runtime) {
      void runtime
        .then((value) => {
          if (cancelled) return;
          if (!value.packaged) return loadPublishedVersion();
          setCurrentVersion(value.appVersion);
          setReleaseChannel(value.releaseChannel);
        })
        .catch(loadPublishedVersion);
    } else {
      void loadPublishedVersion();
    }
    syncDesktopPhase();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [syncDesktopPhase]);

  const updateAvailable =
    releaseChannel === "stable" &&
    (status === "available" || status === "downloading" || status === "downloaded");

  const startUpdate = useCallback(() => {
    const desktop = bridge();
    if (!desktop.startUpdate) {
      setStatus("error");
      setPhase("failed");
      return;
    }
    setStatus("checking");
    setPhase("working");
    setProgress(null);
    void desktop.startUpdate().then(syncDesktopPhase, () => {
      setStatus("error");
      setPhase("failed");
      setProgress(null);
    });
  }, [syncDesktopPhase]);

  const checkForUpdates = useCallback(() => {
    const desktop = bridge();
    if (!desktop.checkForUpdates) {
      setStatus("error");
      setPhase("failed");
      return;
    }
    setStatus("checking");
    setPhase("working");
    setProgress(null);
    void desktop.checkForUpdates().then(applySnapshot, () => {
      setStatus("error");
      setPhase("failed");
      setProgress(null);
    });
  }, [applySnapshot]);

  const setUpdateChannel = useCallback(
    (channel: DesktopUpdateChannel) => {
      const desktop = bridge();
      if (!desktop.setUpdateChannel) {
        setStatus("error");
        setPhase("failed");
        return;
      }
      setUpdateChannelState(channel);
      setLatestVersion(null);
      setStatus("checking");
      setPhase("working");
      setProgress(null);
      void desktop.setUpdateChannel(channel).then(applySnapshot, () => {
        setStatus("error");
        setPhase("failed");
        setProgress(null);
      });
    },
    [applySnapshot],
  );

  return {
    currentVersion,
    releaseChannel,
    updateChannel,
    latestVersion,
    updateAvailable,
    phase,
    status,
    progress,
    checkForUpdates,
    startUpdate,
    setUpdateChannel,
  };
}
