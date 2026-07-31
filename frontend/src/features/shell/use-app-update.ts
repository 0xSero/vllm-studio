"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type AppUpdatePhase = "idle" | "working" | "ready" | "failed";

export type AppUpdate = {
  /** Installed app version (desktop bridge); null on the plain web app. */
  currentVersion: string | null;
  /** Newest published release, when reachable. */
  latestVersion: string | null;
  downloadUrl: string | null;
  updateAvailable: boolean;
  phase: AppUpdatePhase;
  /**
   * Desktop: download the update in place (data is untouched), then a second
   * activation relaunches into the new version. Web: open the DMG download.
   */
  startUpdate: () => void;
};

// "2.10.1" vs "2.9.0" — numeric per segment, missing segments are 0.
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

const bridge = () => window.localStudioDesktop ?? {};

function phaseForStatus(status: string): AppUpdatePhase {
  if (status === "downloaded") return "ready";
  if (status === "checking" || status === "available" || status === "downloading") return "working";
  if (status === "error") return "failed";
  return "idle";
}

export function useAppUpdate(): AppUpdate {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [latest, setLatest] = useState<{ version: string | null; url: string | null }>({
    version: null,
    url: null,
  });
  const [phase, setPhase] = useState<AppUpdatePhase>("idle");
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll the desktop updater snapshot while a download is in flight. The main
  // process auto-downloads in the background, so this also catches an update
  // that finished before the user clicked anything.
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
      .then((response) => response.json() as Promise<{ latest?: string; downloadUrl?: string }>)
      .then((body) => {
        if (!cancelled) setLatest({ version: body.latest ?? null, url: body.downloadUrl ?? null });
      })
      .catch(() => undefined);
    void bridge()
      .getRuntime?.()
      .then((runtime) => {
        // An unpackaged dev run reports the repo's package.json version, which
        // trails every published release — it must not claim an update.
        if (!cancelled && runtime.packaged) setCurrentVersion(runtime.appVersion);
      })
      .catch(() => undefined);
    syncDesktopPhase();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [syncDesktopPhase]);

  const updateAvailable = isAppUpdateAvailable(latest.version, currentVersion);

  const startUpdate = useCallback(() => {
    const desktop = bridge();
    if (phase === "ready" && desktop.installUpdate) {
      void desktop.installUpdate();
      return;
    }
    // A failed in-place update (or no desktop bridge) falls back to the plain
    // DMG download in the browser — reinstalling keeps user data as well.
    if (!desktop.checkForUpdates || phase === "failed") {
      if (latest.url) window.open(latest.url, "_blank", "noopener");
      return;
    }
    setPhase("working");
    void desktop.checkForUpdates().then(syncDesktopPhase, () => setPhase("failed"));
  }, [latest.url, phase, syncDesktopPhase]);

  return {
    currentVersion,
    latestVersion: latest.version,
    downloadUrl: latest.url,
    updateAvailable,
    phase,
    startUpdate,
  };
}
