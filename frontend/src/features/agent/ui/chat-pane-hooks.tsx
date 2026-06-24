"use client";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { type UpdateTab } from "@/features/agent/ui/chat-pane-composer";
import { browserContextPrompt } from "@/features/agent/browser/context";
import {
  activeComposerPlugins,
  selectedContextPrompt,
  type ComposerMention,
  type ComposerPluginRef,
} from "@/features/agent/composer-context";
import { useProjectsNavSessionPrefs } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import {
  ChatPaneHandle,
  cleanSessionTitle,
  isPlaceholderSessionTitle,
  newId,
  nowLabel,
  runtimeStatusLooksActive,
  SessionTab,
  visibleQueuedMessages,
} from "@/features/agent/messages";
import { copySessionPref, patchSessionPref } from "@/features/agent/messages/prefs";
import { type SessionEngine } from "@/features/agent/runtime/engine";
import {
  beginSessionSubmit,
  endSessionSubmit,
  type SessionSubmitGuard,
} from "@/features/agent/runtime/selectors";
import { type ToolsContextValue } from "@/features/agent/tools/context";
import type { ContextAttachRequest } from "@/features/agent/tools/types";
import {
  attachmentDedupKey,
  attachmentPrompt,
  imageInputFromAttachment,
  type ChatAttachment,
} from "@/features/agent/ui/chat-attachments";

export function useChatPaneDerivedState({
  activeTabId,
  contextWindow,
  tabs,
}: {
  activeTabId: string;
  contextWindow: number;
  tabs: SessionTab[];
}) {
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const running = activeTab?.status === "running" || activeTab?.status === "starting";
  const showEmptyPrompt = activeTab && activeTab.messages.length === 0 && !running;
  const queue = activeTab?.queue ?? [];
  const sdkContextUsage = activeTab?.contextUsage ?? null;
  const currentContextTokens = sdkContextUsage?.tokens ?? activeTab?.tokenStats?.current ?? 0;
  const effectiveContextWindow =
    sdkContextUsage?.contextWindow && sdkContextUsage.contextWindow > 0
      ? sdkContextUsage.contextWindow
      : contextWindow;

  return {
    activeTab,
    currentContextTokens,
    effectiveContextWindow,
    running,
    showEmptyPrompt,
    visibleQueueItems: visibleQueuedMessages(queue),
  };
}

const getChatPaneSnapshot = (): number => 0;

type ChatPaneFileMentionRow = {
  id: string;
  name: string;
  rel: string;
  path: string;
  source: string;
};

export function useChatPaneStickToBottomEffect({
  activeTabId,
  setStickToBottom,
}: {
  activeTabId: string | null | undefined;
  setStickToBottom: Dispatch<SetStateAction<boolean>>;
}): void {
  const subscribeStickToBottom = useCallback(() => {
    setStickToBottom(true);
    return () => undefined;
  }, [activeTabId, setStickToBottom]);

  useSyncExternalStore(subscribeStickToBottom, getChatPaneSnapshot, getChatPaneSnapshot);
}

export function useChatPaneMentionEffects({
  cwd,
  mention,
  setFileMentionRows,
  setMentionIndex,
}: {
  cwd: string;
  mention: ComposerMention | null;
  setFileMentionRows: Dispatch<SetStateAction<ChatPaneFileMentionRow[]>>;
  setMentionIndex: Dispatch<SetStateAction<number>>;
}): void {
  const subscribeMentionIndex = useCallback(() => {
    setMentionIndex(0);
    return () => undefined;
  }, [mention?.kind, mention?.query, setMentionIndex]);

  const subscribeMentionRows = useCallback(() => {
    if (!mention || mention.kind !== "plugin" || !cwd) {
      setFileMentionRows([]);
      return () => undefined;
    }
    let cancelled = false;
    void fetch(`/api/agent/fs?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          payload: {
            entries?: Array<{ name: string; rel: string; path: string; kind: string }>;
          } | null,
        ) => {
          if (cancelled) return;
          const rows = (payload?.entries ?? [])
            .filter((entry) => entry.kind === "file")
            .map((entry) => ({
              id: `file:${entry.rel}`,
              name: entry.name,
              rel: entry.rel,
              path: entry.path,
              source: "project",
            }));
          setFileMentionRows(rows);
        },
      )
      .catch(() => {
        if (!cancelled) setFileMentionRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, mention, setFileMentionRows]);

  useSyncExternalStore(subscribeMentionIndex, getChatPaneSnapshot, getChatPaneSnapshot);
  useSyncExternalStore(subscribeMentionRows, getChatPaneSnapshot, getChatPaneSnapshot);
}

export function useChatPaneContextAttachEffect({
  contextAttachRequest,
  isFocused,
  setAttachments,
}: {
  contextAttachRequest: ContextAttachRequest | null;
  isFocused: boolean;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
}): void {
  const handledContextAttachRef = useRef(0);
  const subscribeContextAttach = useCallback(() => {
    if (
      contextAttachRequest &&
      isFocused &&
      handledContextAttachRef.current !== contextAttachRequest.id
    ) {
      handledContextAttachRef.current = contextAttachRequest.id;
      const attachment: ChatAttachment = {
        id: newId("ctx"),
        name: contextAttachRequest.label,
        type: "text/plain",
        size: contextAttachRequest.content.length,
        ...(contextAttachRequest.path ? { path: contextAttachRequest.path } : {}),
        mode: "text",
        content: contextAttachRequest.content,
        previewKind: "file",
      };
      setAttachments((current) => {
        const nextKey = attachmentDedupKey(attachment);
        if (current.some((file) => attachmentDedupKey(file) === nextKey)) return current;
        return [...current, attachment];
      });
    }
    return () => undefined;
  }, [contextAttachRequest, isFocused, setAttachments]);

  useSyncExternalStore(subscribeContextAttach, getChatPaneSnapshot, getChatPaneSnapshot);
}

function useChatPaneRegisterHandleEffect({
  handleRef,
  onRegisterHandle,
}: {
  handleRef: RefObject<ChatPaneHandle>;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
}): void {
  const subscribeHandle = useCallback(() => {
    if (!onRegisterHandle) return () => undefined;
    const handle: ChatPaneHandle = {
      loadAndReplay: (id) => handleRef.current.loadAndReplay(id),
      compact: () => handleRef.current.compact(),
    };
    onRegisterHandle(handle);
    return () => onRegisterHandle(null);
  }, [handleRef, onRegisterHandle]);

  useSyncExternalStore(subscribeHandle, getChatPaneSnapshot, getChatPaneSnapshot);
}

export function useChatPaneRuntimeHandle({
  activeTab,
  activeTabId,
  engine,
  modelId,
  onRegisterHandle,
  running,
}: {
  activeTab: SessionTab | null;
  activeTabId: string;
  engine: SessionEngine;
  modelId: string;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
  running: boolean;
}) {
  const [compacting, setCompacting] = useState(false);
  const loadAndReplay = useCallback(
    async (piSessionId: string) => {
      if (!activeTabId) return;
      await engine.loadAndReplay(piSessionId, activeTabId);
    },
    [activeTabId, engine],
  );
  const compactSession = useCallback(async () => {
    if (!activeTab || running || compacting || !modelId) return;
    setCompacting(true);
    try {
      await engine.compact(activeTab.id);
    } finally {
      setCompacting(false);
    }
  }, [activeTab, compacting, engine, modelId, running]);
  const handleRef = useRef<ChatPaneHandle>({ loadAndReplay, compact: compactSession });
  handleRef.current = { loadAndReplay, compact: compactSession };
  useChatPaneRegisterHandleEffect({ handleRef, onRegisterHandle });
}

export function useChatPaneSessionTitle({
  activeTab,
  activeTabId,
  paneId,
  running,
  onPiSessionIdChange,
  onRenameSession,
}: {
  activeTab: SessionTab | null;
  activeTabId: string;
  paneId: string;
  running: boolean;
  onPiSessionIdChange?: (sessionId: string) => void;
  onRenameSession: (tabId: string, title: string) => void;
}) {
  const sessionPrefs = useProjectsNavSessionPrefs();
  const sessionPrefKeys = useMemo(
    () =>
      [
        activeTab?.piSessionId,
        paneId && activeTab?.id ? `tab:${paneId}:${activeTab.id}` : null,
      ].filter((value): value is string => Boolean(value)),
    [activeTab?.id, activeTab?.piSessionId, paneId],
  );
  const sessionPrefTitle = sessionPrefKeys.reduce((title, key) => {
    const nextTitle = cleanSessionTitle(sessionPrefs[key]?.title);
    return nextTitle || title;
  }, "");
  // Empty starter/restored tabs stay visually untitled until user content arrives.
  const sessionLooksEmpty =
    !activeTab || (activeTab.messages.length === 0 && !activeTab.input.trim() && !running);
  const displayedSessionTitle = sessionLooksEmpty
    ? ""
    : sessionPrefTitle || cleanSessionTitle(activeTab?.title) || "";
  const sessionPinned = sessionPrefKeys.some((key) => Boolean(sessionPrefs[key]?.pinned));
  const patchActiveSessionPrefs = useCallback(
    (patch: { title?: string; pinned?: boolean }) => {
      for (const key of sessionPrefKeys) patchSessionPref(key, patch);
    },
    [sessionPrefKeys],
  );
  const togglePinnedSession = useCallback(() => {
    if (sessionPrefKeys.length === 0) return;
    patchActiveSessionPrefs({ pinned: !sessionPinned });
  }, [patchActiveSessionPrefs, sessionPinned, sessionPrefKeys.length]);
  const handlePiSessionIdChange = useCallback(
    (piSessionId: string) => {
      if (paneId && activeTabId) copySessionPref(`tab:${paneId}:${activeTabId}`, piSessionId);
      // Once a fresh chat earns its persistent id, swap the throwaway `?new=`
      // nonce in the address bar for `?session=<piSessionId>` so a reload
      // reattaches to (or at least reopens) this conversation instead of
      // restarting a blank chat and losing the in-flight turn from view. Use
      // replaceState — it's invisible to Next's `useSearchParams`, so the
      // running turn's nav effect never re-fires. Side-chat pane excluded.
      if (typeof window !== "undefined" && paneId !== "computer-side-chat" && piSessionId) {
        const params = new URLSearchParams(window.location.search);
        if (params.get("new") !== null && params.get("session") !== piSessionId) {
          params.delete("new");
          params.set("session", piSessionId);
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

  return {
    displayedSessionTitle,
    sessionPinned,
    togglePinnedSession,
    handlePiSessionIdChange,
    renameActiveSession,
  };
}

type UseChatPaneSendFlowOptions = {
  activeTab: SessionTab | null;
  attachments: ChatAttachment[];
  browserToolEnabled: boolean;
  clearAttachments: () => void;
  cwd: string;
  engine: SessionEngine;
  modelId: string;
  modelSupportsVision: boolean;
  readingAttachments: boolean;
  resetComposerHeight: () => void;
  running: boolean;
  runtimeSessionId: string;
  setMention: (mention: ComposerMention | null) => void;
  setStickToBottom: (stickToBottom: boolean) => void;
  tools: ToolsContextValue;
  updateTab: UpdateTab;
};

export function useChatPaneSendFlow({
  activeTab,
  attachments,
  browserToolEnabled,
  clearAttachments,
  cwd,
  engine,
  modelId,
  modelSupportsVision,
  readingAttachments,
  resetComposerHeight,
  running,
  runtimeSessionId,
  setMention,
  setStickToBottom,
  tools,
  updateTab,
}: UseChatPaneSendFlowOptions) {
  const composerSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const controlSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());

  const buildPromptArgs = useCallback(
    (sessionId: string, rawText: string, effectiveBrowserEnabled = browserToolEnabled) => {
      const text = rawText.trim();
      const attachedText = attachmentPrompt(attachments, { modelSupportsVision });
      const attachmentSummary =
        attachments.length > 0
          ? `Attached: ${attachments.map((file) => file.name).join(", ")}`
          : "";
      const userText = text || attachmentSummary;
      const displayText = [text, attachmentSummary].filter(Boolean).join("\n\n");
      const selection = tools.selectionFor(sessionId);
      const contextText = selectedContextPrompt(
        text,
        activeComposerPlugins(selection.plugins),
        selection.skills,
      );
      const browserContextText = browserContextPrompt({
        enabled: effectiveBrowserEnabled,
        backend: tools.browser.backend,
        url: tools.browser.url,
        modelId,
      });
      const prompt = [browserContextText, contextText, attachedText].filter(Boolean).join("\n\n");
      const images = modelSupportsVision
        ? attachments.flatMap((file) => {
            const image = imageInputFromAttachment(file);
            return image ? [image] : [];
          })
        : [];
      const messageAttachments = attachments.map((file) => {
        // Prefer the durable inline data URL over the ephemeral blob: URL when
        // available; blob URLs are tied to the composer document and can go stale
        // after a session is persisted and replayed.
        const durablePreviewUrl =
          file.mode === "data-url" && file.content.startsWith("data:")
            ? file.content
            : file.previewUrl;
        return {
          id: file.id,
          name: file.name,
          type: file.type,
          size: file.size,
          path: file.path,
          mode: file.mode,
          content: file.content,
          previewKind: file.previewKind,
          previewUrl: durablePreviewUrl,
        };
      });
      return {
        text,
        prompt,
        displayText,
        userText,
        images,
        attachments: messageAttachments,
        browserToolEnabled: effectiveBrowserEnabled,
        plugins: activeComposerPlugins(selection.plugins) as ComposerPluginRef[],
        skills: selection.skills,
        promptTemplates: selection.promptTemplates,
      };
    },
    [attachments, browserToolEnabled, modelId, modelSupportsVision, tools],
  );

  const submitPrompt = useCallback(
    async (rawText: string, targetTabId?: string) => {
      const targetId = targetTabId ?? activeTab?.id;
      if (!targetId) return;
      if ((!rawText.trim() && attachments.length === 0) || !modelId || readingAttachments) return;
      const args = buildPromptArgs(targetId, rawText, browserToolEnabled);
      const currentSelection = tools.selectionFor(targetId);
      if (currentSelection.skills.length > 0 || currentSelection.plugins.length > 0) {
        tools.setSelection(targetId, { ...currentSelection, skills: [], plugins: [] });
      }
      setStickToBottom(true);
      clearAttachments();
      resetComposerHeight();
      await engine.submitPrompt({ ...args, targetSessionId: targetId });
    },
    [
      activeTab,
      attachments.length,
      browserToolEnabled,
      buildPromptArgs,
      clearAttachments,
      engine,
      modelId,
      readingAttachments,
      resetComposerHeight,
      setStickToBottom,
      tools,
    ],
  );

  const queueAndSendControl = useCallback(
    async (
      mode: "steer" | "follow_up",
      text: string,
      tab: SessionTab,
      runtime: string,
      cwdHint?: string,
    ) => {
      const queuedId = newId("queue");
      // A steer lands in the transcript immediately, dimmed, so the user sees it
      // the moment they send it; the runtime echo clears `pending` once Pi shows
      // it to the model. (Follow-ups keep their own queue-chip affordance.)
      const pendingSteerId = mode === "steer" ? newId("user") : null;
      updateTab(tab.id, (t) => ({
        ...t,
        ...(cwdHint ? { cwd: t.cwd || cwdHint } : {}),
        input: "",
        error: "",
        queue:
          mode === "follow_up"
            ? [...(t.queue ?? []), { id: queuedId, mode, text, sent: true }]
            : t.queue,
        messages: pendingSteerId
          ? [
              ...t.messages,
              { id: pendingSteerId, role: "user", text, pending: true, timestamp: nowLabel() },
            ]
          : t.messages,
      }));
      resetComposerHeight();
      const result = await engine.sendControl(mode, text, runtime, tab.id, tab.piSessionId);
      updateTab(tab.id, (t) => ({
        ...t,
        queue: result.ok ? t.queue : (t.queue ?? []).filter((item) => item.id !== queuedId),
        // A rejected steer never reaches the model — drop its optimistic bubble
        // and hand the text back to the composer.
        messages:
          !result.ok && pendingSteerId
            ? t.messages.filter((message) => message.id !== pendingSteerId)
            : t.messages,
        ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
      }));
    },
    [engine, resetComposerHeight, updateTab],
  );

  const runtimeAcceptsControl = useCallback(
    async (tab: SessionTab, runtime: string) => {
      // A steer/control only applies while THIS session has an in-flight turn.
      // After a turn settles the pi SDK session stays loaded, so loadRuntimeStatus
      // keeps reporting active=true — trusting that alone misroutes the NEXT
      // prompt as a steer to an idle agent, which silently stalls (the message
      // is added but no turn starts). Gate on the local turn state first.
      if (tab.status !== "running" && tab.status !== "starting") return false;
      const status = await engine.loadRuntimeStatus(runtime, tab.piSessionId);
      if (!status) return true;
      if (!runtimeStatusLooksActive(status)) return false;
      return !status.piSessionId || !tab.piSessionId || status.piSessionId === tab.piSessionId;
    },
    [engine],
  );

  // Single-flight a submit through one of the in-flight guards: bail if this
  // session already has a submit pending, clear any open @mention, then run and
  // always release the guard. Shared by composer send, queue, and retry.
  const runGuardedSubmit = useCallback(
    async (guard: SessionSubmitGuard, sessionId: string, run: () => Promise<void>) => {
      if (!beginSessionSubmit(guard, sessionId)) return;
      setMention(null);
      try {
        await run();
      } finally {
        endSessionSubmit(guard, sessionId);
      }
    },
    [setMention],
  );

  const sendMessage = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return;
      const text = activeTab.input.trim();
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      if (
        ((!text || isPlaceholderSessionTitle(text)) && attachments.length === 0) ||
        readingAttachments
      ) {
        return;
      }
      if (!modelId) {
        updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
        return;
      }
      if (await runtimeAcceptsControl(activeTab, runtime)) {
        if (!text) return;
        await runGuardedSubmit(controlSubmitInFlightRef.current, activeTab.id, () =>
          queueAndSendControl("steer", text, activeTab, runtime),
        );
        return;
      }
      await runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, () =>
        submitPrompt(text, activeTab.id),
      );
    },
    [
      activeTab,
      attachments.length,
      modelId,
      queueAndSendControl,
      readingAttachments,
      runGuardedSubmit,
      runtimeAcceptsControl,
      runtimeSessionId,
      submitPrompt,
      updateTab,
    ],
  );

  const queueMessage = useCallback(async () => {
    if (!activeTab) return;
    const text = activeTab.input.trim();
    if (!text || isPlaceholderSessionTitle(text)) return;
    if (!modelId) {
      updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
      return;
    }
    const runtime = activeTab.runtimeSessionId || runtimeSessionId;
    if (await runtimeAcceptsControl(activeTab, runtime)) {
      await runGuardedSubmit(controlSubmitInFlightRef.current, activeTab.id, () =>
        queueAndSendControl("follow_up", text, activeTab, runtime, cwd),
      );
      return;
    }
    await runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, () =>
      submitPrompt(text, activeTab.id),
    );
  }, [
    activeTab,
    cwd,
    modelId,
    queueAndSendControl,
    runGuardedSubmit,
    runtimeAcceptsControl,
    runtimeSessionId,
    submitPrompt,
    updateTab,
  ]);

  const removeQueued = useCallback(
    (queueId: string) => {
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        queue: (tab.queue ?? []).filter((entry) => entry.id !== queueId),
      }));
    },
    [activeTab, updateTab],
  );

  const editQueued = useCallback(
    (queueId: string, text: string) => {
      if (!activeTab) return;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        queue: (tab.queue ?? []).map((entry) =>
          entry.id === queueId ? { ...entry, text } : entry,
        ),
      }));
    },
    [activeTab, updateTab],
  );

  const steerQueued = useCallback(
    async (queueId: string) => {
      if (!activeTab) return;
      const item = (activeTab.queue ?? []).find((entry) => entry.id === queueId);
      if (!item) return;
      const runtime = activeTab.runtimeSessionId || runtimeSessionId;
      removeQueued(queueId);
      const result = await engine.sendControl(
        "steer",
        item.text,
        runtime,
        activeTab.id,
        activeTab.piSessionId,
      );
      if (!result.ok) {
        updateTab(activeTab.id, (t) => ({
          ...t,
          queue: [...(t.queue ?? []), item],
          error: result.error || "Steer failed",
        }));
      }
    },
    [activeTab, engine, removeQueued, runtimeSessionId, updateTab],
  );

  const abortTurn = useCallback(async () => {
    if (!activeTab) return;
    await engine.abortTurn(activeTab.id);
  }, [activeTab, engine]);

  // Re-run the last user turn after a failure (a 503, a network blip). On a
  // *send* failure the text is restored to the composer, but a turn that errors
  // mid-stream leaves the prompt only in the transcript with an empty composer —
  // so retry resends the last user message directly.
  const retryLast = useCallback(async () => {
    if (!activeTab || !modelId) return;
    const lastUserText = [...activeTab.messages].reverse().find((m) => m.role === "user")?.text;
    const text = (lastUserText ?? activeTab.input).trim();
    if (!text) return;
    await runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, async () => {
      updateTab(activeTab.id, (t) => ({ ...t, error: "", input: "" }));
      await submitPrompt(text, activeTab.id);
    });
  }, [activeTab, modelId, runGuardedSubmit, submitPrompt, updateTab]);

  return { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn, retryLast };
}
