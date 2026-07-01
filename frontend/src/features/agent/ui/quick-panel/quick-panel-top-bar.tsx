"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import { getQuickPanelBridge } from "@/features/agent/ui/quick-panel/quick-panel-bridge";
import { QuickProjectPicker } from "@/features/agent/ui/quick-panel/quick-project-picker";

/** Resizes the OS-level quick-composer panel from its tiny composer-only
 * "home" bounds to its resizable "thread" bounds the first time a message
 * lands in the focused pane. No-op outside the quick panel (bridge absent). */
export function useQuickPanelExpandEffect(compact: boolean, focusedMessageCount: number): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      if (compact && focusedMessageCount > 0) {
        void getQuickPanelBridge()?.expand();
      }
      return () => {};
    },
    [compact, focusedMessageCount],
  );
  useSyncExternalStore(subscribe, getQuickPanelExpandSnapshot, getQuickPanelExpandSnapshot);
}

const getQuickPanelExpandSnapshot = (): number => 0;

export function QuickPanelTopBar({
  projects,
  projectId,
  sessionId,
  hasThread,
}: {
  projects: ProjectsContextValue;
  projectId: string | null;
  sessionId: string | null;
  hasThread: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-(--border) px-2 py-1">
      <QuickProjectPicker projects={projects} />
      {hasThread && projectId ? (
        <button
          type="button"
          onClick={() =>
            void getQuickPanelBridge()?.focusMainAndNavigate(projectId, sessionId ?? undefined)
          }
          className="shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[length:var(--fs-xs)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        >
          Open in Local Studio
        </button>
      ) : null}
    </div>
  );
}
