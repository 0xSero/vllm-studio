import { useCallback, useMemo, useRef } from "react";
import { Effect } from "effect";
import { projectRuntimeStatus, settleTurn } from "@/features/agent/runtime/session-status";
import {
  selectedContextPrompt,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { Session, SessionId, UpdateSession } from "@/features/agent/runtime/types";
import type { BrowserBackend, ToolSelection } from "@/features/agent/tools/types";
import type {
  AgentQueueAction,
  AgentThinkingLevel,
  AgentToolAccess,
} from "@shared/agent/agent-turn";
import * as api from "@/features/agent/runtime/api";
import { submitPromptTurn, type SubmitArgs } from "@/features/agent/runtime/prompt-stream";

const EMPTY_SKILLS: ComposerSkillRef[] = [];
const EMPTY_PROMPT_TEMPLATES: ComposerPromptTemplateRef[] = [];

export type UseSessionEngineDeps = {
  tabs: Session[];
  activeTabId: SessionId;
  modelId: string;
  thinkingLevel: AgentThinkingLevel;
  toolAccess: AgentToolAccess;
  cwd: string;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  onPiSessionIdChange?: (piSessionId: string) => void;
  updateSession: UpdateSession;
  selectionFor: (sessionId: SessionId) => ToolSelection;
};

export type SessionEngine = {
  submitPrompt: (args: SubmitArgs) => Promise<void>;
  sendControl: (request: AgentControlRequest) => Promise<{ ok: boolean; error?: string }>;
  abortTurn: (sessionId: SessionId) => Promise<api.AbortSessionResult>;
  hydrate: (sessionId: SessionId) => Promise<void>;
  loadEarlier: (sessionId: SessionId) => Promise<void>;
  compact: (sessionId: SessionId) => Promise<void>;
  acceptsControl: (tab: { status: Session["status"] }) => boolean;
};

export type AgentControlRequest = {
  mode: "steer" | "follow_up";
  text: string;
  runtime: string;
  sessionId: SessionId;
  piSessionId?: string | null;
  queueAction?: AgentQueueAction;
  queueReplacement?: string;
};

export function useSessionEngine(deps: UseSessionEngineDeps): SessionEngine {
  const {
    tabs,
    activeTabId,
    modelId,
    thinkingLevel,
    toolAccess,
    cwd,
    browserToolEnabled,
    browserBackend,
    onPiSessionIdChange,
    updateSession,
    selectionFor,
  } = deps;

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const selectionForRef = useRef(selectionFor);
  selectionForRef.current = selectionFor;
  const hydratingRef = useRef<Set<SessionId>>(new Set());
  const loadingEarlierRef = useRef<Set<SessionId>>(new Set());

  const sendControl = useCallback(
    (request: AgentControlRequest): Promise<{ ok: boolean; error?: string }> => {
      const { mode, text, runtime, sessionId, piSessionId, queueAction, queueReplacement } =
        request;
      if (!text.trim() || !modelId) return Promise.resolve({ ok: false });
      return Effect.runPromise(
        Effect.gen(function* () {
          const selection = selectionForRef.current(sessionId);
          const skills = selection.skills ?? EMPTY_SKILLS;
          const promptTemplates = selection.promptTemplates ?? EMPTY_PROMPT_TEMPLATES;
          const browserEnabledForTurn = browserToolEnabled;
          const message = selectedContextPrompt(text, skills);
          const contextualQueueReplacement = queueReplacement
            ? selectedContextPrompt(queueReplacement, skills)
            : undefined;
          const result = yield* Effect.tryPromise({
            try: () =>
              api.submitTurnCommand({
                sessionId: runtime,
                modelId,
                thinkingLevel,
                toolAccess,
                message,
                cwd: cwd.trim() || undefined,
                piSessionId,
                mode,
                queueAction,
                queueReplacement: contextualQueueReplacement,
                browserToolEnabled: browserEnabledForTurn,
                browserSessionId: runtime,
                browserBackend,
                skills,
                promptTemplates,
              }),
            catch: (error) => error,
          });
          updateSession(sessionId, (session) =>
            result.status
              ? projectRuntimeStatus(session, result.status)
              : {
                  ...session,
                  piSessionId: result.piSessionId || session.piSessionId,
                  status: "running",
                },
          );
          if (result.piSessionId) onPiSessionIdChange?.(result.piSessionId);
          return { ok: true };
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              ok: false,
              error: error instanceof Error ? error.message : "Message failed",
            }),
          ),
        ),
      );
    },
    [
      browserToolEnabled,
      browserBackend,
      cwd,
      modelId,
      thinkingLevel,
      toolAccess,
      onPiSessionIdChange,
      updateSession,
    ],
  );

  const submitPrompt = useCallback(
    (args: SubmitArgs) =>
      submitPromptTurn(
        {
          activeTabId,
          browserToolEnabled,
          browserBackend,
          cwd,
          modelId,
          thinkingLevel,
          toolAccess,
          onPiSessionIdChange,
          selectionFor: selectionForRef.current,
          tabsRef,
          updateSession,
        },
        args,
      ),
    [
      activeTabId,
      modelId,
      thinkingLevel,
      toolAccess,
      cwd,
      browserToolEnabled,
      browserBackend,
      onPiSessionIdChange,
      updateSession,
    ],
  );

  const abortTurn = useCallback(
    (sessionId: SessionId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const session = tabsRef.current.find((entry) => entry.id === sessionId);
          updateSession(sessionId, (session) => ({ ...session, status: "stopping" }));
          const result = yield* Effect.tryPromise({
            try: () => api.abortSession(sessionId, session?.piSessionId),
            catch: (error) => error,
          });
          updateSession(sessionId, (current) =>
            result.status ? projectRuntimeStatus(current, result.status) : settleTurn(current),
          );
          return result;
        }),
      ),
    [updateSession],
  );

  const hydrate = useCallback(
    (sessionId: SessionId): Promise<void> => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      const sessionCwd = session?.cwd || cwd;
      if (
        !session?.piSessionId ||
        !sessionCwd ||
        session.messages.length > 0 ||
        hydratingRef.current.has(sessionId)
      ) {
        return Promise.resolve();
      }
      hydratingRef.current.add(sessionId);
      const piSessionId = session.piSessionId;
      updateSession(sessionId, (current) => ({ ...current, status: "loading", error: "" }));
      return Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => api.loadCanonicalSession(piSessionId, sessionCwd),
            catch: (error) => error,
          }).pipe(Effect.result);
          updateSession(sessionId, (current) => {
            if (current.piSessionId !== piSessionId) return current;
            if (result._tag !== "Success") {
              return {
                ...current,
                status: current.status === "loading" ? "idle" : current.status,
                error:
                  result.failure instanceof Error
                    ? result.failure.message
                    : "Failed to load session",
              };
            }
            const { messages, tokenStats, cursor, meta } = result.success;
            return {
              ...current,
              messages: current.messages.length > 0 ? current.messages : messages,
              tokenStats: tokenStats ?? current.tokenStats,
              historyCursor: messages.length > 0 ? cursor : current.historyCursor,
              title: meta?.title ?? current.title,
              modelId: current.modelId || meta?.modelId || undefined,
              startedAt: meta?.startedAt ?? current.startedAt,
              usageTotals: meta?.usage ?? current.usageTotals,
              status: current.status === "loading" ? "idle" : current.status,
              error: "",
            };
          });
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              hydratingRef.current.delete(sessionId);
            }),
          ),
        ),
      );
    },
    [cwd, updateSession],
  );

  const loadEarlier = useCallback(
    (sessionId: SessionId): Promise<void> => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      const cursor = session?.historyCursor;
      if (!session || !session.piSessionId || !cwd || cursor == null) return Promise.resolve();
      if (loadingEarlierRef.current.has(sessionId)) return Promise.resolve();
      loadingEarlierRef.current.add(sessionId);
      const piSessionId = session.piSessionId;
      return Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => api.loadCanonicalSession(piSessionId, cwd, { before: cursor }),
            catch: (error) => error,
          }).pipe(Effect.result);
          if (result._tag !== "Success") return;
          const earlier = result.success.messages;
          updateSession(sessionId, (current) => ({
            ...current,
            messages: earlier.length > 0 ? [...earlier, ...current.messages] : current.messages,
            historyCursor: result.success.cursor,
          }));
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              loadingEarlierRef.current.delete(sessionId);
            }),
          ),
        ),
      );
    },
    [cwd, updateSession],
  );

  const compact = useCallback(
    (sessionId: SessionId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const session = tabsRef.current.find((tab) => tab.id === sessionId);
          if (!session || !modelId) return;
          updateSession(sessionId, (s) => ({ ...s, error: "" }));
          const result = yield* Effect.tryPromise({
            try: () =>
              api.compactSession({
                sessionId: session.id,
                modelId,
                thinkingLevel,
                toolAccess,
                cwd: cwd.trim() || undefined,
                piSessionId: session.piSessionId,
                browserToolEnabled,
                browserSessionId: session.id,
                browserBackend,
                skills: selectionForRef.current(sessionId).skills ?? EMPTY_SKILLS,
                promptTemplates:
                  selectionForRef.current(sessionId).promptTemplates ?? EMPTY_PROMPT_TEMPLATES,
              }),
            catch: (error) => error,
          });
          updateSession(sessionId, (current) => ({
            ...(result.status ? projectRuntimeStatus(current, result.status) : current),
            contextUsage: result.status?.contextUsage ?? null,
            tokenStats: undefined,
          }));
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              updateSession(sessionId, (s) => ({
                ...s,
                error: error instanceof Error ? error.message : "Compaction failed",
              }));
            }),
          ),
        ),
      ),
    [browserToolEnabled, browserBackend, cwd, modelId, thinkingLevel, updateSession],
  );

  const acceptsControl = useCallback(
    (tab: { status: Session["status"] }): boolean =>
      tab.status === "running" || tab.status === "starting" || tab.status === "stopping",
    [],
  );

  return useMemo<SessionEngine>(
    () => ({
      submitPrompt,
      sendControl,
      abortTurn,
      hydrate,
      loadEarlier,
      compact,
      acceptsControl,
    }),
    [submitPrompt, sendControl, abortTurn, hydrate, loadEarlier, compact, acceptsControl],
  );
}
