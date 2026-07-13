"use client";

import type { ProjectsContextValue } from "@/features/agent/projects/context";
import { ExternalLink } from "@/ui/icon-registry";
import { getQuickPanelBridge } from "@/features/agent/ui/quick-panel/quick-panel-bridge";
import { QuickProjectPicker } from "@/features/agent/ui/quick-panel/quick-project-picker";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

/** Resizes the OS-level quick-composer panel from its tiny composer-only
 * "home" bounds to its resizable "thread" bounds the first time a message
 * lands in the focused pane. No-op outside the quick panel (bridge absent). */
export function useQuickPanelExpandEffect(compact: boolean, focusedMessageCount: number): void {
  useMountSubscription(() => {
    if (compact && focusedMessageCount > 0) {
      void getQuickPanelBridge()?.expand();
    }
  }, [compact, focusedMessageCount]);
}

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
    // The bar doubles as the frameless window's drag handle; interactive
    // children opt back out so clicks don't start a window drag.
    <div
      className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-(--border) px-2 [-webkit-app-region:drag]"
      onDoubleClick={(event) => event.preventDefault()}
    >
      <div className="[-webkit-app-region:no-drag]">
        <QuickProjectPicker projects={projects} />
      </div>
      {hasThread && projectId ? (
        <button
          type="button"
          onClick={() =>
            void getQuickPanelBridge()?.focusMainAndNavigate(projectId, sessionId ?? undefined)
          }
          title="Open in Local Studio"
          aria-label="Open in Local Studio"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--dim) transition-colors [-webkit-app-region:no-drag] hover:bg-(--hover) hover:text-(--fg)"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
