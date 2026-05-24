import { useEffect } from "react";
import type { BrowserEventsSubscription } from "@/lib/agent/workspace/effects";

export function useBrowserEventsEffects({
  browserEvents,
  enabled,
}: {
  browserEvents: BrowserEventsSubscription;
  enabled: boolean;
}) {
  useEffect(() => {
    browserEvents.setEnabled(enabled);
    return () => browserEvents.setEnabled(false);
  }, [browserEvents, enabled]);
}
