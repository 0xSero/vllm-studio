"use client";

import { Suspense, useCallback, useSyncExternalStore } from "react";
import { AgentWorkspace } from "@/features/agent/ui/agent-workspace-shell";
import { getQuickPanelBridge } from "@/features/agent/ui/quick-panel/quick-panel-bridge";

function getDismissOnEscapeSnapshot(): number {
  return 0;
}

function useDismissOnEscape(): void {
  const subscribe = useCallback((_notify: () => void) => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const bridge = getQuickPanelBridge();
      if (!bridge) return;
      event.preventDefault();
      void bridge.dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useSyncExternalStore(subscribe, getDismissOnEscapeSnapshot, getDismissOnEscapeSnapshot);
}

export default function QuickPanelPage() {
  useDismissOnEscape();
  return (
    <Suspense fallback={null}>
      <AgentWorkspace compact />
    </Suspense>
  );
}
