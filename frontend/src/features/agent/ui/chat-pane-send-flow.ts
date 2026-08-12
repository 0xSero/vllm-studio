import { useCallback, useRef, type FormEvent } from "react";
import { Effect } from "effect";
import { type UpdateTab } from "@/features/agent/ui/chat-pane-composer";
import { browserContextPrompt } from "@/features/agent/browser/context";
import { selectedContextPrompt, type ComposerMention } from "@/features/agent/composer-context";
import {
  isPlaceholderSessionTitle,
  newId,
  nowLabel,
  type SessionTab,
} from "@/features/agent/messages";
import { type SessionEngine } from "@/features/agent/runtime/engine";
import {
  beginSessionSubmit,
  endSessionSubmit,
  type SessionSubmitGuard,
} from "@/features/agent/runtime/prompt-stream";
import { type ToolsContextValue } from "@/features/agent/tools/store";
import {
  attachmentPrompt,
  imageInputsFromAttachments,
  type ChatAttachment,
} from "@/features/agent/ui/chat-attachments";
import {
  messagesToResumeAfterAbort,
  removePendingSteersClearedByAbort,
} from "@/features/agent/ui/chat-pane-send-flow-model";

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
  setMention,
  setStickToBottom,
  tools,
  updateTab,
}: UseChatPaneSendFlowOptions) {
  const composerSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const controlSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());
  const abortSubmitInFlightRef = useRef<SessionSubmitGuard>(new Set());

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
      const contextText = selectedContextPrompt(text, selection.skills);
      const browserContextText = browserContextPrompt({
        enabled: effectiveBrowserEnabled,
        backend: tools.browser.backend,
        url: tools.browser.url,
        vision: modelSupportsVision,
      });
      const prompt = [browserContextText, contextText, attachedText].filter(Boolean).join("\n\n");
      const images = modelSupportsVision ? imageInputsFromAttachments(attachments) : [];
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
        skills: selection.skills,
        promptTemplates: selection.promptTemplates,
      };
    },
    [attachments, browserToolEnabled, modelId, modelSupportsVision, tools],
  );

  const submitPrompt = useCallback(
    (rawText: string, targetTabId?: string) => {
      const targetId = targetTabId ?? activeTab?.id;
      if (!targetId) return Promise.resolve();
      if ((!rawText.trim() && attachments.length === 0) || !modelId || readingAttachments) {
        return Promise.resolve();
      }
      const args = buildPromptArgs(targetId, rawText, browserToolEnabled);
      const currentSelection = tools.selectionFor(targetId);
      if (currentSelection.skills.length > 0) {
        tools.setSelection(targetId, { ...currentSelection, skills: [] });
      }
      setStickToBottom(true);
      clearAttachments();
      resetComposerHeight();
      return engine.submitPrompt({ ...args, targetSessionId: targetId });
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
    (
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
              {
                id: pendingSteerId,
                role: "user",
                text,
                pending: true,
                awaitingEcho: true,
                timestamp: nowLabel(),
              },
            ]
          : t.messages,
      }));
      resetComposerHeight();
      return Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              engine.sendControl({
                mode,
                text,
                runtime,
                sessionId: tab.id,
                piSessionId: tab.piSessionId,
              }),
            catch: (error) => error,
          });
          updateTab(tab.id, (t) => ({
            ...t,
            queue: result.ok ? t.queue : (t.queue ?? []).filter((item) => item.id !== queuedId),
            messages:
              !result.ok && pendingSteerId
                ? t.messages.filter((message) => message.id !== pendingSteerId)
                : t.messages,
            ...(result.ok ? {} : { input: text, error: result.error || "Message failed" }),
          }));
        }),
      );
    },
    [engine, resetComposerHeight, updateTab],
  );

  // Single-flight a submit through one of the in-flight guards: bail if this
  // session already has a submit pending, clear any open @mention, then run and
  // always release the guard. Shared by composer send, queue, and retry.
  const runGuardedSubmit = useCallback(
    (guard: SessionSubmitGuard, sessionId: string, run: () => Promise<void>) => {
      if (!beginSessionSubmit(guard, sessionId)) return Promise.resolve();
      setMention(null);
      return Effect.runPromise(
        Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
          Effect.ensuring(Effect.sync(() => endSessionSubmit(guard, sessionId))),
        ),
      );
    },
    [setMention],
  );

  const sendPromptOrControl = useCallback(
    (tab: SessionTab, text: string, mode: "steer" | "follow_up", cwdHint?: string) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const runtime = tab.id;
          const acceptsControl = yield* Effect.tryPromise({
            try: () => engine.acceptsControl(tab, runtime),
            catch: () => running,
          });
          if (acceptsControl && !text) return;
          const guard = acceptsControl
            ? controlSubmitInFlightRef.current
            : composerSubmitInFlightRef.current;
          yield* Effect.tryPromise({
            try: () =>
              runGuardedSubmit(guard, tab.id, () =>
                acceptsControl
                  ? queueAndSendControl(mode, text, tab, runtime, cwdHint)
                  : submitPrompt(text, tab.id),
              ),
            catch: (error) => error,
          });
        }),
      ),
    [engine, queueAndSendControl, runGuardedSubmit, running, submitPrompt],
  );

  const sendMessage = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!activeTab) return Promise.resolve();
      const text = activeTab.input.trim();
      if (
        ((!text || isPlaceholderSessionTitle(text)) && attachments.length === 0) ||
        readingAttachments
      ) {
        return Promise.resolve();
      }
      if (!modelId) {
        updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
        return Promise.resolve();
      }
      return sendPromptOrControl(activeTab, text, "steer");
    },
    [activeTab, attachments.length, modelId, readingAttachments, sendPromptOrControl, updateTab],
  );

  const queueMessage = useCallback(() => {
    if (!activeTab) return Promise.resolve();
    const text = activeTab.input.trim();
    if (!text || isPlaceholderSessionTitle(text)) return Promise.resolve();
    if (!modelId) {
      updateTab(activeTab.id, (t) => ({ ...t, error: "Select a model to send." }));
      return Promise.resolve();
    }
    return sendPromptOrControl(activeTab, text, "follow_up", cwd);
  }, [activeTab, cwd, modelId, sendPromptOrControl, updateTab]);

  const mutateQueued = useCallback(
    (queueId: string, queueAction: "remove" | "replace" | "promote", queueReplacement?: string) => {
      if (!activeTab) return Promise.resolve();
      const item = (activeTab.queue ?? []).find((entry) => entry.id === queueId);
      if (!item) return Promise.resolve();
      const fallback =
        queueAction === "remove"
          ? "Remove failed"
          : queueAction === "replace"
            ? "Edit failed"
            : "Steer failed";
      return engine
        .sendControl({
          mode: queueAction === "promote" ? "steer" : "follow_up",
          text: item.text,
          runtime: activeTab.id,
          sessionId: activeTab.id,
          piSessionId: activeTab.piSessionId,
          queueAction,
          ...(queueReplacement === undefined ? {} : { queueReplacement }),
        })
        .then((result) => {
          if (result.ok) return;
          updateTab(activeTab.id, (tab) => ({ ...tab, error: result.error || fallback }));
        });
    },
    [activeTab, engine, updateTab],
  );

  const removeQueued = useCallback(
    (queueId: string) => mutateQueued(queueId, "remove"),
    [mutateQueued],
  );

  const editQueued = useCallback(
    (queueId: string, text: string) => mutateQueued(queueId, "replace", text),
    [mutateQueued],
  );

  const steerQueued = useCallback(
    (queueId: string) => mutateQueued(queueId, "promote"),
    [mutateQueued],
  );

  const abortTurn = useCallback(() => {
    if (!activeTab) return Promise.resolve();
    const tab = activeTab;
    return runGuardedSubmit(abortSubmitInFlightRef.current, tab.id, async () => {
      const cleared = await engine.abortTurn(tab.id);
      const pending = messagesToResumeAfterAbort(tab.queue ?? [], cleared);
      if (pending.length === 0) return;
      updateTab(tab.id, (current) => ({
        ...current,
        queue: [],
        messages: removePendingSteersClearedByAbort(current.messages, cleared),
      }));
      const [next, ...remaining] = pending;
      if (!next) return;
      await submitPrompt(next, tab.id);
      for (const text of remaining) {
        await queueAndSendControl("follow_up", text, tab, tab.id, cwd);
      }
    });
  }, [activeTab, cwd, engine, queueAndSendControl, runGuardedSubmit, submitPrompt, updateTab]);

  // Re-run the last user turn after a failure (a 503, a network blip). On a
  // *send* failure the text is restored to the composer, but a turn that errors
  // mid-stream leaves the prompt only in the transcript with an empty composer —
  // so retry resends the last user message directly.
  const retryLast = useCallback(() => {
    if (!activeTab || !modelId) return Promise.resolve();
    const lastUserText = [...activeTab.messages].reverse().find((m) => m.role === "user")?.text;
    const text = (lastUserText ?? activeTab.input).trim();
    if (!text) return Promise.resolve();
    return runGuardedSubmit(composerSubmitInFlightRef.current, activeTab.id, () => {
      updateTab(activeTab.id, (t) => ({ ...t, error: "", input: "" }));
      return submitPrompt(text, activeTab.id);
    });
  }, [activeTab, modelId, runGuardedSubmit, submitPrompt, updateTab]);

  return { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn, retryLast };
}
