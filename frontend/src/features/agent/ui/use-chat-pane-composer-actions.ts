"use client";

import { useCallback } from "react";
import { respondExtensionUi } from "@/features/agent/runtime/api";
import type { SessionTab } from "@/features/agent/messages";

type UpdateTab = (id: string, update: (tab: SessionTab) => SessionTab) => void;

/** Composer actions that only touch the active tab's text or its pending
 *  extension prompt. Lifted out of ChatPane so the component reads as
 *  composition rather than a wall of one-off callbacks. */
export function useChatPaneComposerActions({
  activeTab,
  updateTab,
}: {
  activeTab: SessionTab | undefined;
  updateTab: UpdateTab;
}): {
  handleExtensionUiResponse: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
} {
  /** Clear the prompt optimistically; a failed round-trip surfaces as the
   *  session error rather than leaving a dead dialog on screen. */
  const handleExtensionUiResponse = useCallback(
    (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      const request = activeTab?.extensionUiRequest;
      if (!activeTab || !request) return;
      updateTab(activeTab.id, (session) => ({ ...session, extensionUiRequest: undefined }));
      void respondExtensionUi(activeTab.id, request.requestId, response).catch((error) => {
        updateTab(activeTab.id, (session) => ({
          ...session,
          error: error instanceof Error ? error.message : "Extension response failed",
        }));
      });
    },
    [activeTab, updateTab],
  );

  return { handleExtensionUiResponse };
}
