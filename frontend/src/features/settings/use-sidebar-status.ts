"use client";

import { useMemo } from "react";
import {
  sidebarStatusFromSnapshot,
  useRealtimeStatusStore,
  type SidebarStatusSnapshot,
} from "@/hooks/realtime-status-store";

export type { SidebarStatusSnapshot };

/** Sidebar/server-page view over the realtime status store: a pure derivation,
 *  no listener or poll of its own. */
export function useSidebarStatus(): SidebarStatusSnapshot {
  const { connected, status, launchProgress } = useRealtimeStatusStore();
  return useMemo(
    () => sidebarStatusFromSnapshot({ connected, status, launchProgress }),
    [connected, status, launchProgress],
  );
}
