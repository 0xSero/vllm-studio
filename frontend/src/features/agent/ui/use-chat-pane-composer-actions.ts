"use client";

import { useCallback, type RefObject } from "react";
import { respondExtensionUi } from "@/features/agent/runtime/api";
import type { SessionTab } from "@/features/agent/messages";

type UpdateTab = (id: string, update: (tab: SessionTab) => SessionTab) => void;

/** Composer actions that only touch the active tab's text or its pending
 *  extension prompt. Lifted out of ChatPane so the component reads as
 *  composition rather than a wall of one-off callbacks. */
export function useChatPaneComposerActions({
  activeTab,
  updateTab,
  textareaRef,
}: {
  activeTab: SessionTab | undefined;
  updateTab: UpdateTab;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}): {
  handleTranscript: (transcript: string) => void;
  handleExtensionUiResponse: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
} {
  /** Dictation appends to whatever is already typed, then puts the caret at
   *  the end so the user can keep going without reaching for the mouse. */
  const handleTranscript = useCallback(
    (transcript: string) => {
      if (!activeTab) return;
      const current = activeTab.input.trimEnd();
      const next = current ? `${current} ${transcript}` : transcript;
      updateTab(activeTab.id, (tab) => ({ ...tab, input: next }));
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(next.length, next.length);
      });
    },
    [activeTab, textareaRef, updateTab],
  );

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

  return { handleTranscript, handleExtensionUiResponse };
}
