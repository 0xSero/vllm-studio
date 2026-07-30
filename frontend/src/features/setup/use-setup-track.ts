"use client";

import { useCallback, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export const SETUP_TRACKS = [
  "access",
  "credentials",
  "environment",
  "inference",
  "review",
] as const;
export type SetupTrack = (typeof SETUP_TRACKS)[number];

export function decodeSetupTrack(value: string | null): SetupTrack {
  return SETUP_TRACKS.find((track) => track === value) ?? "access";
}

const currentTrack = () =>
  typeof window === "undefined"
    ? "access"
    : decodeSetupTrack(new URL(window.location.href).searchParams.get("track"));

export function useSetupTrack() {
  const [track, setTrackState] = useState<SetupTrack>("access");

  useMountSubscription(() => {
    const sync = () => setTrackState(currentTrack());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const setTrack = useCallback((next: SetupTrack) => {
    setTrackState(next);
    const url = new URL(window.location.href);
    url.searchParams.set("track", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  return { track, setTrack };
}
