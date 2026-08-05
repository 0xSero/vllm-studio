"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type AppUpdatePhase = "idle" | "working" | "ready" | "failed";

export type AppUpdate = {
  currentVersion: string | null;
  releaseChannel: "dev" | "stable" | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  phase: AppUpdatePhase;
  startUpdate: () => void;
};

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = current.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export function isAppUpdateAvailable(
  latestVersion: string | null,
  currentVersion: string | null,
): boolean {
  return Boolean(latestVersion && currentVersion && isNewerVersion(latestVersion, currentVersion));
}

export function isReleaseUpdateAvailable(
  latestVersion: string | null,
  currentVersion: string | null,
  releaseChannel: "dev" | "stable" | null,
): boolean {
  return releaseChannel === "stable" && isAppUpdateAvailable(latestVersion, currentVersion);
}

const bridge = () => window.localStudioDesktop ?? {};

function phaseForStatus(status: string): AppUpdatePhase {
  if (status === "downloaded") return "ready";
  if (status === "checking" || status === "available" || status === "downloading") return "working";
  if (status === "error") return "failed";
  return "idle";
}

export function useAppUpdate(): AppUpdate {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [releaseChannel, setReleaseChannel] = useState<"dev" | "stable" | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<AppUpdatePhase>("idle");
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncDesktopPhase = useCallback(() => {
    const getStatus = bridge().getUpdateStatus;
    if (!getStatus) return;
    void getStatus().then(
      (snapshot) => {
        const next = phaseForStatus(snapshot.status);
        setPhase(next);
        if (next === "working") {
          if (pollTimer.current) clearTimeout(pollTimer.current);
          pollTimer.current = setTimeout(syncDesktopPhase, 2_000);
        }
      },
      () => setPhase("failed"),
    );
  }, []);

  useMountSubscription(() => {
    let cancelled = false;
    void fetch("/api/app-update", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ latest?: string }>)
      .then((body) => {
        if (!cancelled) setLatestVersion(body.latest ?? null);
      })
      .catch(() => undefined);
    void bridge()
      .getRuntime?.()
      .then((runtime) => {
        if (!cancelled && runtime.packaged) {
          setCurrentVersion(runtime.appVersion);
          setReleaseChannel(runtime.releaseChannel);
        }
      })
      .catch(() => undefined);
    syncDesktopPhase();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [syncDesktopPhase]);

  const updateAvailable = isReleaseUpdateAvailable(latestVersion, currentVersion, releaseChannel);

  const startUpdate = useCallback(() => {
    const desktop = bridge();
    if (!desktop.startUpdate) {
      setPhase("failed");
      return;
    }
    setPhase("working");
    void desktop.startUpdate().then(syncDesktopPhase, () => setPhase("failed"));
  }, [syncDesktopPhase]);

  return {
    currentVersion,
    releaseChannel,
    latestVersion,
    updateAvailable,
    phase,
    startUpdate,
  };
}
