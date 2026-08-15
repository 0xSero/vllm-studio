"use client";

import { useMemo } from "react";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import {
  sidebarStatusFromSnapshot,
  type SidebarStatusSnapshot,
} from "@/hooks/realtime-status-types";

export type { SidebarStatusSnapshot };

export function useSidebarStatus(): SidebarStatusSnapshot {
  const { connected, status, launchProgress } = useRealtimeStatusStore();
  return useMemo(
    () => sidebarStatusFromSnapshot({ connected, status, launchProgress }),
    [connected, status, launchProgress],
  );
}
