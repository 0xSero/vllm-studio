import { useCallback, useMemo } from "react";
import {
  cleanSessionTitle,
  messageTextFromBlocks,
  type SessionTab,
} from "@/features/agent/messages";
import { patchCanonicalSessionPref } from "@/features/agent/messages/prefs";
import { useProjectsNavSessionPrefs } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { readAgentDefaults } from "@/features/agent/workspace/model-preference";
import { generateThreadTitle } from "@/features/agent/runtime/thread-title-generator";

const titleGenerationSessions = new Set<string>();

export function useChatPaneSessionTitle({
  activeTab,
  activeTabId,
  projectId,
  paneId,
  running,
  onPiSessionIdChange,
  onRenameSession,
}: {
  activeTab: SessionTab | null;
  activeTabId: string;
  projectId: string | null;
  paneId: string;
  running: boolean;
  onPiSessionIdChange?: (sessionId: string) => void;
  onRenameSession: (tabId: string, title: string) => void;
}) {
  const sessionPrefs = useProjectsNavSessionPrefs();
  const localPrefKey = paneId && activeTab?.id ? `tab:${paneId}:${activeTab.id}` : null;
  const sessionPrefKeys = useMemo(
    () =>
      [activeTab?.id, localPrefKey, activeTab?.piSessionId].filter((value): value is string =>
        Boolean(value),
      ),
    [activeTab?.id, activeTab?.piSessionId, localPrefKey],
  );
  const sessionPrefTitle = sessionPrefKeys.reduce((title, key) => {
    const nextTitle = cleanSessionTitle(sessionPrefs[key]?.title);
    return nextTitle || title;
  }, "");
  const sessionLooksEmpty =
    !activeTab || (activeTab.messages.length === 0 && !activeTab.input.trim() && !running);
  const emptySessionTitle =
    projectId === "chats" || activeTab?.executionKind === "chat" || activeTab?.projectId === "chats"
      ? "New chat"
      : "New task";
  const displayedSessionTitle = sessionLooksEmpty
    ? emptySessionTitle
    : sessionPrefTitle || cleanSessionTitle(activeTab?.title) || "";
  const sessionPinned = sessionPrefKeys.some((key) => Boolean(sessionPrefs[key]?.pinned));
  const patchActiveSessionPrefs = useCallback(
    (patch: { title?: string; pinned?: boolean }) => {
      const primary = activeTab?.piSessionId ?? localPrefKey ?? activeTab?.id;
      if (primary) patchCanonicalSessionPref(primary, sessionPrefKeys, patch);
    },
    [activeTab?.id, activeTab?.piSessionId, localPrefKey, sessionPrefKeys],
  );
  const togglePinnedSession = useCallback(() => {
    if (sessionPrefKeys.length === 0) return;
    patchActiveSessionPrefs({ pinned: !sessionPinned });
  }, [patchActiveSessionPrefs, sessionPinned, sessionPrefKeys.length]);
  const handlePiSessionIdChange = useCallback(
    (piSessionId: string) => {
      patchCanonicalSessionPref(piSessionId, [activeTabId, `tab:${paneId}:${activeTabId}`]);
      // Once a fresh chat earns its persistent id, swap the throwaway `?new=`
      // nonce in the address bar for `?session=<piSessionId>` so a reload
      // reattaches to (or at least reopens) this conversation instead of
      // restarting a blank chat and losing the in-flight turn from view. Use
      // replaceState — it's invisible to Next's `useSearchParams`, so the
      // running turn's nav effect never re-fires. Side-chat pane excluded.
      if (typeof window !== "undefined" && paneId !== "computer-side-chat" && piSessionId) {
        const params = new URLSearchParams(window.location.search);
        if (params.get("session") !== activeTabId) {
          params.delete("new");
          params.set("session", activeTabId);
          window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
        }
      }
      onPiSessionIdChange?.(piSessionId);
    },
    [activeTabId, onPiSessionIdChange, paneId],
  );
  const renameActiveSession = useCallback(
    (nextTitle: string) => {
      if (!activeTab) return;
      const trimmed = cleanSessionTitle(nextTitle);
      if (!trimmed || trimmed === displayedSessionTitle) return;
      onRenameSession(activeTab.id, trimmed);
      patchActiveSessionPrefs({ title: trimmed });
    },
    [activeTab, displayedSessionTitle, onRenameSession, patchActiveSessionPrefs],
  );
  useMountSubscription(() => {
    if (!activeTab || running || sessionPrefTitle || activeTab.status !== "idle") return;
    if (!readAgentDefaults(window.localStorage).autoTitle) return;
    const users = activeTab.messages.filter((message) => message.role === "user");
    const assistant = activeTab.messages.findLast((message) => message.role === "assistant");
    if (users.length !== 1 || !assistant || titleGenerationSessions.has(activeTab.id)) return;
    const assistantText = assistant.text || messageTextFromBlocks(assistant.blocks ?? []);
    const userText = users[0]?.text.trim() ?? "";
    if (!userText || !assistantText.trim() || !activeTab.modelId) return;
    titleGenerationSessions.add(activeTab.id);
    void generateThreadTitle({
      userText,
      assistantText,
      currentModelId: activeTab.modelId,
      currentRouteId: activeTab.modelRouteId ?? "",
    }).then((title) => {
      if (!title) return;
      onRenameSession(activeTab.id, title);
      const primary = activeTab.piSessionId ?? localPrefKey ?? activeTab.id;
      patchCanonicalSessionPref(primary, sessionPrefKeys, { title });
    });
  }, [activeTab, localPrefKey, onRenameSession, running, sessionPrefKeys, sessionPrefTitle]);

  return {
    displayedSessionTitle,
    sessionPinned,
    togglePinnedSession,
    handlePiSessionIdChange,
    renameActiveSession,
  };
}
