// useSessionEngine — owns the network/state side of running an agent session.
// ChatPane only handles composer UX (input, attachments, focus); everything
// from "send a turn" downward — SSE plumbing, pi-event accumulation, queue
// drain, runtime status polling, replay — lives here.
//
// The hook deliberately mirrors the chat-pane internals it replaces. Callers
// pass session state (`tabs`, `activeTabId`) and a write callback (`updateTab`);
// the hook returns the action functions.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { isAgentEndEvent } from "@/lib/agent/pi-events";
import {
  appendDelta,
  appendEventBlock,
  compactionTextFromEvent,
  drainQueueAfterAgentEnd,
  extractToolText,
  mergeCanonicalAndRuntimeEvents,
  messageText,
  newId,
  nowLabel,
  piSessionIdFromEvent,
  reconcileQueueWithPiEvent,
  replayCursorAfterRuntimeHydration,
  replaySessionEvents,
  runtimeStatusAcceptsControl,
  runtimeStatusLooksActive,
  sessionTitleFromPrompt,
  statusAfterControlPhase,
  stringifyToolArgs,
  toolCallDeltaFromUpdate,
  toolCallSnapshotFromUpdate,
  upsertTool,
  usageFromEvent,
  visibleUserTextFromPi,
} from "@/lib/agent/session";
import {
  activeComposerPlugins,
  selectedContextPrompt,
  type ComposerPluginRef,
  type ComposerSkillRef,
} from "@/lib/agent/composer-context";
import type { ChatMessage, TokenStats, ToolBlock } from "@/lib/agent/session";
import type { Session, SessionId, SessionStatus } from "@/lib/agent/sessions/types";
import type { ToolSelection } from "@/lib/agent/tools/types";
import * as api from "./api";

const EMPTY_PLUGINS: ComposerPluginRef[] = [];
const EMPTY_SKILLS: ComposerSkillRef[] = [];

type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

type SubmitArgs = {
  text: string;
  /** Pre-resolved prompt text (with attachments / context already merged). */
  prompt: string;
  displayText: string;
  userText: string;
  targetSessionId?: SessionId;
};

export type UseSessionEngineDeps = {
  /** Latest `tabs` snapshot — engine reads via a ref so it doesn't restart on every frame. */
  tabs: Session[];
  activeTabId: SessionId;
  /** Runtime session id used when a session doesn't carry its own. */
  runtimeSessionId: string;
  modelId: string;
  cwd: string;
  browserToolEnabled: boolean;
  onPiSessionIdChange?: (piSessionId: string) => void;
  /** Mutate a single session record. */
  updateSession: UpdateSession;
  /** Look up the per-session tool selection from the tools subsystem. */
  selectionFor: (sessionId: SessionId) => ToolSelection;
};

export type SessionEngine = {
  /** Send a freshly-typed prompt — orchestrates optimistic update + streaming. */
  submitPrompt: (args: SubmitArgs) => Promise<void>;
  /** Send a steer/follow-up control message while a turn is in progress. */
  sendControl: (
    mode: "steer" | "follow_up",
    text: string,
    runtime: string,
    sessionId: SessionId,
    piSessionId?: string | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  loadRuntimeStatus: (runtime: string) => Promise<api.RuntimeStatus | null>;
  abortTurn: (sessionId: SessionId) => Promise<void>;
  loadAndReplay: (piSessionId: string, sessionId: SessionId) => Promise<void>;
  compact: (sessionId: SessionId) => Promise<void>;
  /** Helpers exposed for the composer's send/queue logic. */
  acceptsControl: typeof runtimeStatusAcceptsControl;
};

export function useSessionEngine(deps: UseSessionEngineDeps): SessionEngine {
  const {
    tabs,
    activeTabId,
    runtimeSessionId,
    modelId,
    cwd,
    browserToolEnabled,
    onPiSessionIdChange,
    updateSession,
    selectionFor,
  } = deps;

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  const selectionForRef = useRef(selectionFor);
  selectionForRef.current = selectionFor;

  // Tracks which sessions own their stream right now (we own = don't double-
  // subscribe via the resume-runtime SSE). Keyed by session id.
  const localStreamRef = useRef<Set<SessionId>>(new Set());
  // The "live" assistant message id we're currently appending to, per session.
  // Pi can split a single user turn across multiple assistant messages (after
  // a queue_update / message_start), and we need a stable id to patch.
  const liveAssistantIdsRef = useRef<Map<SessionId, string>>(new Map());

  const patchAssistant = useCallback(
    (sessionId: SessionId, assistantId: string, patch: (msg: ChatMessage) => ChatMessage) => {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((m) => (m.id === assistantId ? patch(m) : m)),
      }));
    },
    [updateSession],
  );

  // Apply a single pi event to a session — the meaty accumulator: routes the
  // event by type into delta-merge / tool-block / queue updates.
  const applyPiEvent = useCallback(
    (sessionId: SessionId, assistantId: string, event: Record<string, unknown>) => {
      const eventType = event.type;
      const currentAssistantId = () => liveAssistantIdsRef.current.get(sessionId) ?? assistantId;
      const ensureNextAssistant = () => {
        const id = newId("assistant");
        liveAssistantIdsRef.current.set(sessionId, id);
        updateSession(sessionId, (session) => ({
          ...session,
          activeAssistantId: id,
          messages: [
            ...session.messages,
            { id, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
          ],
        }));
        return id;
      };
      const patchCurrentAssistant = (patch: (msg: ChatMessage) => ChatMessage) => {
        patchAssistant(sessionId, currentAssistantId(), patch);
      };

      if (eventType === "queue_update") {
        updateSession(sessionId, (session) => ({
          ...session,
          queue: reconcileQueueWithPiEvent(session.queue ?? [], event),
        }));
        return;
      }
      if (eventType === "message_start" || eventType === "message_end") {
        const msg = event.message as
          | { role?: string; content?: string | Record<string, unknown>[] }
          | undefined;
        if (msg?.role === "user") {
          const text = visibleUserTextFromPi(messageText(msg.content));
          if (!text) return;
          const current = tabsRef.current.find((tab) => tab.id === sessionId);
          const lastUser = [...(current?.messages ?? [])]
            .reverse()
            .find((entry) => entry.role === "user");
          if (lastUser && (lastUser.text === text || text.includes(lastUser.text))) return;
          updateSession(sessionId, (session) => ({
            ...session,
            messages: [
              ...session.messages,
              { id: newId("user"), role: "user", text, timestamp: nowLabel() },
            ],
          }));
          ensureNextAssistant();
          return;
        }
      }
      const usage = usageFromEvent(event);
      if (usage) {
        updateSession(sessionId, (session) => ({ ...session, tokenStats: usage }));
      }

      const compactionText = compactionTextFromEvent(event);
      if (compactionText) {
        patchCurrentAssistant((msg) => ({
          ...msg,
          blocks: appendEventBlock(msg.blocks ?? [], compactionText),
        }));
        return;
      }

      if (eventType === "message_update") {
        const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
        const updateType = ame?.type;
        if (updateType === "text_delta" && typeof ame?.delta === "string") {
          const delta = ame.delta;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: appendDelta(msg.blocks ?? [], "text", delta),
          }));
          return;
        }
        if (updateType === "thinking_delta" && typeof ame?.delta === "string") {
          const delta = ame.delta;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: appendDelta(msg.blocks ?? [], "thinking", delta),
          }));
          return;
        }
        if (updateType === "toolcall_start") {
          const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
          if (!snapshot) return;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: upsertTool(
              msg.blocks ?? [],
              snapshot.id,
              (existing) => ({
                ...existing,
                name: snapshot.name,
                args: snapshot.args ?? existing.args,
              }),
              () => ({
                kind: "tool",
                id: snapshot.id,
                name: snapshot.name,
                status: "running",
                text: "",
                argsText: stringifyToolArgs(snapshot.args) ?? "",
                args: snapshot.args,
              }),
            ),
          }));
          return;
        }
        if (updateType === "toolcall_delta") {
          const snapshot = toolCallSnapshotFromUpdate(ame, event.message);
          const delta = toolCallDeltaFromUpdate(ame);
          if (!snapshot || (!delta && !snapshot.args)) return;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: upsertTool(
              msg.blocks ?? [],
              snapshot.id,
              (existing) => ({
                ...existing,
                name: snapshot.name || existing.name,
                args: snapshot.args ?? existing.args,
                argsText: delta
                  ? (existing.argsText ?? "") + delta
                  : existing.argsText || stringifyToolArgs(snapshot.args),
              }),
              () => ({
                kind: "tool",
                id: snapshot.id,
                name: snapshot.name,
                status: "running",
                text: "",
                argsText: delta || stringifyToolArgs(snapshot.args) || "",
                args: snapshot.args,
              }),
            ),
          }));
          return;
        }
        if (updateType === "toolcall_end") {
          const toolCall = ame?.toolCall as
            | { id?: string; name?: string; arguments?: unknown }
            | undefined;
          if (!toolCall) return;
          const id = toolCall.id || newId("tool");
          const name = toolCall.name || "tool";
          const argsText = JSON.stringify(toolCall.arguments ?? {}, null, 2);
          const argsObj =
            toolCall.arguments && typeof toolCall.arguments === "object"
              ? (toolCall.arguments as Record<string, unknown>)
              : undefined;
          patchCurrentAssistant((msg) => ({
            ...msg,
            blocks: upsertTool(
              msg.blocks ?? [],
              id,
              (existing) => ({
                ...existing,
                name,
                argsText,
                args: argsObj ?? existing.args,
                text: existing.text || argsText,
              }),
              () => ({
                kind: "tool",
                id,
                name,
                status: "running",
                argsText,
                args: argsObj,
                text: argsText,
              }),
            ),
          }));
          return;
        }
      }

      if (eventType === "tool_execution_start") {
        const id = String(event.toolCallId || newId("tool"));
        const name = String(event.toolName || "tool");
        patchCurrentAssistant((msg) => ({
          ...msg,
          blocks: upsertTool(
            msg.blocks ?? [],
            id,
            (existing) => existing,
            () => ({ kind: "tool", id, name, status: "running", text: "" }),
          ),
        }));
        return;
      }

      if (eventType === "tool_execution_update" || eventType === "tool_execution_end") {
        const id = String(event.toolCallId || "");
        if (!id) return;
        const resultText = extractToolText(event.partialResult || event.result);
        patchCurrentAssistant((msg) => ({
          ...msg,
          blocks: upsertTool(
            msg.blocks ?? [],
            id,
            (existing) => ({
              ...existing,
              status:
                eventType === "tool_execution_end"
                  ? ((event.isError ? "error" : "done") as ToolBlock["status"])
                  : existing.status,
              resultText: resultText || existing.resultText,
              text: existing.argsText || existing.text || resultText,
            }),
            () => ({
              kind: "tool",
              id,
              name: "tool",
              status:
                eventType === "tool_execution_end"
                  ? ((event.isError ? "error" : "done") as ToolBlock["status"])
                  : "running",
              resultText,
              text: resultText,
            }),
          ),
        }));
      }
    },
    [patchAssistant, updateSession],
  );

  const loadRuntimeStatusCb = useCallback(api.loadRuntimeStatus, []);

  const sendControl = useCallback(
    async (
      mode: "steer" | "follow_up",
      text: string,
      runtime: string,
      sessionId: SessionId,
      piSessionId?: string | null,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!text.trim() || !modelId) return { ok: false };
      const selection = selectionForRef.current(sessionId);
      const plugins = activeComposerPlugins(selection.plugins ?? EMPTY_PLUGINS);
      const skills = selection.skills ?? EMPTY_SKILLS;
      const message = selectedContextPrompt(text, plugins, skills);
      const ensureAssistantId = () => {
        const current = tabsRef.current.find((tab) => tab.id === sessionId);
        const existing =
          (current?.activeAssistantId &&
            current.messages.some((entry) => entry.id === current.activeAssistantId) &&
            current.activeAssistantId) ||
          [...(current?.messages ?? [])].reverse().find((entry) => entry.role === "assistant")?.id;
        if (existing) return existing;
        const assistantId = newId("assistant");
        updateSession(sessionId, (session) => ({
          ...session,
          activeAssistantId: assistantId,
          messages: [
            ...session.messages,
            { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
          ],
        }));
        return assistantId;
      };
      try {
        let controlError = "";
        await api.submitTurnStream(
          {
            sessionId: runtime,
            modelId,
            message,
            cwd: cwd.trim() || undefined,
            piSessionId,
            mode,
            browserToolEnabled,
            plugins: plugins as ComposerPluginRef[],
            skills,
          },
          (payload) => {
            if (payload.type === "error") controlError = payload.error;
            if (payload.type === "status") {
              updateSession(sessionId, (session) => ({
                ...session,
                piSessionId: payload.piSessionId || session.piSessionId,
                status: statusAfterControlPhase(session.status, payload.phase),
              }));
            }
            if (payload.type === "pi") {
              const eventId = piSessionIdFromEvent(payload.event);
              const assistantId = ensureAssistantId();
              const agentEnded = isAgentEndEvent(payload.event);
              updateSession(sessionId, (session) => ({
                ...session,
                piSessionId: eventId || session.piSessionId,
                lastEventSeq:
                  typeof payload.seq === "number" ? payload.seq : session.lastEventSeq,
                status: agentEnded ? "idle" : session.status,
                activeAssistantId: agentEnded ? undefined : assistantId,
              }));
              if (eventId) onPiSessionIdChange?.(eventId);
              applyPiEvent(sessionId, assistantId, payload.event);
            }
          },
        );
        if (controlError) throw new Error(controlError);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Message failed" };
      }
    },
    [applyPiEvent, browserToolEnabled, cwd, modelId, onPiSessionIdChange, updateSession],
  );

  // Stable ref for the queue-drain self-call from inside submitPrompt and the
  // resume-runtime SSE handler.
  const submitPromptRef = useRef<(args: SubmitArgs) => Promise<void>>(() => Promise.resolve());

  const submitPrompt = useCallback(
    async (args: SubmitArgs) => {
      const sessionId = args.targetSessionId ?? activeTabId;
      const selected = tabsRef.current.find((tab) => tab.id === sessionId);
      if (!selected || !modelId) return;

      const userId = newId("user");
      const assistantId = newId("assistant");
      const runtime = selected.runtimeSessionId || runtimeSessionId;

      // Optimistic: push a user message + a blank assistant placeholder so the
      // UI shows "we received it" even before the first SSE chunk lands.
      updateSession(sessionId, (session) => ({
        ...session,
        cwd: session.cwd || cwd,
        modelId: session.modelId || modelId,
        startedAt: session.startedAt ?? new Date().toISOString(),
        input: "",
        error: "",
        status: "starting",
        activeAssistantId: assistantId,
        title:
          session.messages.filter((m) => m.role === "user").length === 0
            ? sessionTitleFromPrompt(args.userText)
            : session.title,
        messages: [
          ...session.messages,
          { id: userId, role: "user", text: args.displayText, timestamp: nowLabel() },
          { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
        ],
      }));

      let agentEnded = false;
      let streamError = "";
      liveAssistantIdsRef.current.set(sessionId, assistantId);
      localStreamRef.current.add(sessionId);
      try {
        await api.submitTurnStream(
          {
            sessionId: runtime,
            modelId,
            message: args.prompt,
            cwd: cwd.trim() || undefined,
            piSessionId:
              tabsRef.current.find((tab) => tab.id === sessionId)?.piSessionId ??
              selected.piSessionId,
            browserToolEnabled,
            plugins: activeComposerPlugins(
              selectionForRef.current(sessionId).plugins ?? EMPTY_PLUGINS,
            ) as ComposerPluginRef[],
            skills: selectionForRef.current(sessionId).skills ?? EMPTY_SKILLS,
          },
          (payload) => {
            if (payload.type === "status") {
              const phase = payload.phase;
              updateSession(sessionId, (session) => ({
                ...session,
                piSessionId: payload.piSessionId || session.piSessionId,
                status: (phase === "done" ? "idle" : phase) as SessionStatus,
                activeAssistantId: phase === "done" ? undefined : session.activeAssistantId,
              }));
              if (payload.piSessionId) onPiSessionIdChange?.(payload.piSessionId);
            } else if (payload.type === "error") {
              streamError = payload.error;
              updateSession(sessionId, (session) => ({
                ...session,
                error: payload.error,
                status: "idle",
              }));
            } else if (payload.type === "pi") {
              const piEvent = payload.event;
              const eventId = piSessionIdFromEvent(piEvent);
              if (eventId) {
                updateSession(sessionId, (session) => ({ ...session, piSessionId: eventId }));
                onPiSessionIdChange?.(eventId);
              }
              if (typeof payload.seq === "number") {
                updateSession(sessionId, (session) => ({
                  ...session,
                  lastEventSeq: payload.seq,
                }));
              }
              if (isAgentEndEvent(piEvent)) {
                agentEnded = true;
                const latestPiSessionId =
                  eventId ??
                  tabsRef.current.find((tab) => tab.id === sessionId)?.piSessionId ??
                  selected.piSessionId ??
                  "";
                onPiSessionIdChange?.(latestPiSessionId);
              }
              applyPiEvent(sessionId, assistantId, piEvent);
            }
          },
        );
      } catch (err) {
        streamError = err instanceof Error ? err.message : "Agent request failed";
      } finally {
        localStreamRef.current.delete(sessionId);
        liveAssistantIdsRef.current.delete(sessionId);
        const runtimeStatus = agentEnded ? null : await api.loadRuntimeStatus(runtime);
        const currentPiSessionId =
          tabsRef.current.find((tab) => tab.id === sessionId)?.piSessionId ??
          selected.piSessionId ??
          null;
        const runtimeStillActive = runtimeStatus
          ? runtimeStatusLooksActive(runtimeStatus) &&
            (!runtimeStatus.piSessionId ||
              !currentPiSessionId ||
              runtimeStatus.piSessionId === currentPiSessionId)
          : false;
        updateSession(sessionId, (session) => ({
          ...session,
          status: runtimeStillActive ? "running" : "idle",
          activeAssistantId: runtimeStillActive ? assistantId : undefined,
          error: streamError
            ? runtimeStillActive
              ? `${streamError}; reattaching to the running session.`
              : streamError
            : session.error,
        }));
      }

      // Drain the per-session queue once the agent finished its turn.
      if (agentEnded) {
        const queued = (tabsRef.current.find((tab) => tab.id === sessionId)?.queue ?? []).slice();
        const { next, remaining } = drainQueueAfterAgentEnd(queued);
        if (next) {
          updateSession(sessionId, (session) => ({ ...session, queue: remaining }));
          setTimeout(
            () =>
              void submitPromptRef.current({
                text: next.text,
                prompt: next.text,
                displayText: next.text,
                userText: next.text,
                targetSessionId: sessionId,
              }),
            0,
          );
        } else if (queued.length > 0) {
          updateSession(sessionId, (session) => ({ ...session, queue: remaining }));
        }
      }
    },
    [
      activeTabId,
      modelId,
      runtimeSessionId,
      cwd,
      browserToolEnabled,
      onPiSessionIdChange,
      applyPiEvent,
      updateSession,
    ],
  );

  useEffect(() => {
    submitPromptRef.current = submitPrompt;
  }, [submitPrompt]);

  const abortTurn = useCallback(
    async (sessionId: SessionId) => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      const runtime = session?.runtimeSessionId || runtimeSessionId;
      await api.abortSession(runtime);
      updateSession(sessionId, (s) => ({ ...s, status: "idle" }));
    },
    [runtimeSessionId, updateSession],
  );

  const loadAndReplay = useCallback(
    async (piSessionId: string, sessionId: SessionId) => {
      if (!cwd) return;
      updateSession(sessionId, (session) => ({ ...session, status: "loading", error: "" }));
      try {
        const { events } = await api.loadCanonicalSession(piSessionId, cwd);
        const runtimeId =
          tabsRef.current.find((tab) => tab.id === sessionId)?.runtimeSessionId ||
          runtimeSessionId;
        const runtimeStatus = await api.loadRuntimeStatus(runtimeId);
        const runtimeActive =
          runtimeStatus?.active === true &&
          (!runtimeStatus.piSessionId || runtimeStatus.piSessionId === piSessionId);
        const replayEvents = mergeCanonicalAndRuntimeEvents(
          events,
          runtimeActive ? runtimeStatus?.events : [],
        );
        const { messages, title, startedAt } = replaySessionEvents(replayEvents);
        const tokenStats = [...replayEvents]
          .reverse()
          .map(usageFromEvent)
          .find((stats): stats is TokenStats => Boolean(stats));
        const replaySeq = replayCursorAfterRuntimeHydration(runtimeActive, runtimeStatus?.eventSeq);
        updateSession(sessionId, (session) => ({
          ...session,
          messages,
          piSessionId,
          cwd: session.cwd || cwd,
          modelId: session.modelId || modelId,
          title: title ?? session.title,
          startedAt: startedAt ?? session.startedAt,
          tokenStats: tokenStats ?? session.tokenStats,
          status: runtimeActive ? "running" : "idle",
          activeAssistantId: undefined,
          lastEventSeq: replaySeq,
          error: "",
        }));
      } catch (err) {
        updateSession(sessionId, (session) => ({
          ...session,
          error: err instanceof Error ? err.message : "Failed to load session",
          status: "idle",
        }));
      }
    },
    [cwd, modelId, runtimeSessionId, updateSession],
  );

  const compact = useCallback(
    async (sessionId: SessionId) => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      if (!session || !modelId) return;
      updateSession(sessionId, (s) => ({ ...s, error: "" }));
      try {
        const result = await api.compactSession({
          sessionId: session.runtimeSessionId || runtimeSessionId,
          modelId,
          cwd: cwd.trim() || undefined,
          piSessionId: session.piSessionId,
          browserToolEnabled,
          plugins: activeComposerPlugins(
            selectionForRef.current(sessionId).plugins ?? EMPTY_PLUGINS,
          ) as ComposerPluginRef[],
          skills: selectionForRef.current(sessionId).skills ?? EMPTY_SKILLS,
        });
        const nextSessionId = result.status?.piSessionId || session.piSessionId;
        if (nextSessionId) await loadAndReplay(nextSessionId, sessionId);
      } catch (error) {
        updateSession(sessionId, (s) => ({
          ...s,
          error: error instanceof Error ? error.message : "Compaction failed",
        }));
      }
    },
    [browserToolEnabled, cwd, loadAndReplay, modelId, runtimeSessionId, updateSession],
  );

  // Resume an in-flight runtime session via SSE — fires when the active
  // session's status flips to running/starting and we *don't* own the local
  // stream (e.g. after a refresh, or when a different pane joins a running
  // session).
  const resumeRuntimeId =
    tabsRef.current.find((tab) => tab.id === activeTabId)?.status === "running" ||
    tabsRef.current.find((tab) => tab.id === activeTabId)?.status === "starting"
      ? activeTabId
      : null;
  const resumeRuntimeSessionId = resumeRuntimeId
    ? tabsRef.current.find((tab) => tab.id === resumeRuntimeId)?.runtimeSessionId ||
      runtimeSessionId
    : null;

  useEffect(() => {
    if (!resumeRuntimeId || !resumeRuntimeSessionId) return;
    if (localStreamRef.current.has(resumeRuntimeId)) return;
    const sessionId = resumeRuntimeId;
    const runtime = resumeRuntimeSessionId;
    const after = tabsRef.current.find((tab) => tab.id === sessionId)?.lastEventSeq ?? 0;

    let closed = false;
    const ensureAssistantId = (): string => {
      const current = tabsRef.current.find((tab) => tab.id === sessionId);
      const existing =
        (current?.activeAssistantId &&
          current.messages.some((message) => message.id === current.activeAssistantId) &&
          current.activeAssistantId) ||
        [...(current?.messages ?? [])].reverse().find((message) => message.role === "assistant")
          ?.id;
      if (existing) {
        updateSession(sessionId, (session) => ({ ...session, activeAssistantId: existing }));
        return existing;
      }
      const assistantId = newId("assistant");
      updateSession(sessionId, (session) => ({
        ...session,
        activeAssistantId: assistantId,
        messages: [
          ...session.messages,
          { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
        ],
      }));
      return assistantId;
    };

    const sub = api.subscribeRuntimeEvents(runtime, after, {
      onPayload: (payload) => {
        if (closed) return;
        if (payload.type === "status") {
          updateSession(sessionId, (session) => ({
            ...session,
            piSessionId: payload.session?.piSessionId || session.piSessionId,
            status: payload.phase === "done" || payload.phase === "idle" ? "idle" : "running",
            activeAssistantId:
              payload.phase === "done" || payload.phase === "idle"
                ? undefined
                : session.activeAssistantId,
          }));
          return;
        }
        if (payload.type === "pi") {
          const eventId = piSessionIdFromEvent(payload.event);
          const assistantId = ensureAssistantId();
          const agentEnded = isAgentEndEvent(payload.event);
          updateSession(sessionId, (session) => ({
            ...session,
            piSessionId: eventId || session.piSessionId,
            lastEventSeq:
              typeof payload.seq === "number" ? payload.seq : session.lastEventSeq,
            status: agentEnded ? "idle" : "running",
            activeAssistantId: agentEnded ? undefined : assistantId,
          }));
          if (eventId) onPiSessionIdChange?.(eventId);
          applyPiEvent(sessionId, assistantId, payload.event);
          if (agentEnded) {
            const queued = (
              tabsRef.current.find((tab) => tab.id === sessionId)?.queue ?? []
            ).slice();
            const { next, remaining } = drainQueueAfterAgentEnd(queued);
            if (next) {
              updateSession(sessionId, (session) => ({ ...session, queue: remaining }));
              setTimeout(
                () =>
                  void submitPromptRef.current({
                    text: next.text,
                    prompt: next.text,
                    displayText: next.text,
                    userText: next.text,
                    targetSessionId: sessionId,
                  }),
                0,
              );
            } else if (queued.length > 0) {
              updateSession(sessionId, (session) => ({ ...session, queue: remaining }));
            }
          }
        }
      },
      onError: () => {
        if (closed) return;
        // Probe runtime status — if the session genuinely went away, downgrade
        // to idle. Transient drops fall through to EventSource's auto-retry.
        void api.loadRuntimeStatus(runtime).then((status) => {
          if (closed) return;
          if (status?.active) {
            updateSession(sessionId, (session) => ({
              ...session,
              piSessionId: status.piSessionId || session.piSessionId,
              status: "running",
            }));
            return;
          }
          sub.close();
          updateSession(sessionId, (session) =>
            session.status === "running" || session.status === "starting"
              ? { ...session, status: "idle", activeAssistantId: undefined }
              : session,
          );
        });
      },
    });
    return () => {
      closed = true;
      sub.close();
    };
  }, [applyPiEvent, onPiSessionIdChange, resumeRuntimeId, resumeRuntimeSessionId, updateSession]);

  return useMemo<SessionEngine>(
    () => ({
      submitPrompt,
      sendControl,
      loadRuntimeStatus: loadRuntimeStatusCb,
      abortTurn,
      loadAndReplay,
      compact,
      acceptsControl: runtimeStatusAcceptsControl,
    }),
    [submitPrompt, sendControl, loadRuntimeStatusCb, abortTurn, loadAndReplay, compact],
  );
}
