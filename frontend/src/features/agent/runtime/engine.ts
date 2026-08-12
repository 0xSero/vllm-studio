import { useCallback, useMemo, useRef } from "react";
import { Effect } from "effect";
import { runtimeStatusAcceptsControl } from "@/features/agent/messages";
import { settleTurnFinalizingTools } from "@/features/agent/runtime/session-status";
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
import { projectRuntimeStatus } from "@/features/agent/runtime/session-runtime-controller";

const EMPTY_SKILLS: ComposerSkillRef[] = [];
const EMPTY_PROMPT_TEMPLATES: ComposerPromptTemplateRef[] = [];

export type UseSessionEngineDeps = {
  /** Latest `tabs` snapshot — engine reads via a ref so it doesn't restart on every frame. */
  tabs: Session[];
  activeTabId: SessionId;
  modelId: string;
  thinkingLevel: AgentThinkingLevel;
  toolAccess: AgentToolAccess;
  cwd: string;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
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
  sendControl: (request: AgentControlRequest) => Promise<{ ok: boolean; error?: string }>;
  loadRuntimeStatus: (
    runtime: string,
    piSessionId?: string | null,
  ) => Promise<api.RuntimeStatus | null>;
  abortTurn: (sessionId: SessionId) => Promise<api.AbortSessionResult>;
  /** Fetch and prepend the previous page of older history (tail paging). */
  loadEarlier: (sessionId: SessionId) => Promise<void>;
  compact: (sessionId: SessionId) => Promise<void>;
  /** Probe whether the session's live runtime accepts steer/follow-up right
   * now: running/starting locally, and the runtime's reported pi session (if
   * any) matches ours. A failed probe counts as accepting — the turn API
   * itself is the authority and will reject if not. */
  acceptsControl: (
    tab: { status: Session["status"]; piSessionId?: string | null },
    runtime: string,
  ) => Promise<boolean>;
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
  // Sessions with an in-flight "load earlier" page, so a double click / repeated
  // scroll doesn't fetch and prepend the same chunk twice.
  const loadingEarlierRef = useRef<Set<SessionId>>(new Set());

  const loadRuntimeStatusCb = useCallback(api.loadRuntimeStatus, []);

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
          updateSession(sessionId, (session) => ({
            ...session,
            piSessionId: result.piSessionId || session.piSessionId,
            contextUsage: api.runtimeContextUsage(result.status, session.contextUsage),
            status: "running",
          }));
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
          const cleared = yield* Effect.tryPromise({
            try: () => api.abortSession(sessionId, session?.piSessionId),
            catch: (error) => error,
          });
          // Settle the session fully. A direct status write bypasses the reducer
          // that normally finalizes tool badges on agent_end, and idling the
          // session detaches the SSE — so if the runtime's terminal event never
          // lands, any in-flight tool would render a perpetual "running" badge
          // and activeAssistantId would linger. Flush pending deltas first so the
          // last streamed text is committed before we finalize.
          updateSession(sessionId, settleTurnFinalizingTools);
          return cleared;
        }),
      ),
    [updateSession],
  );

  // Page the previous (older) chunk of a tail-loaded transcript into view and
  // prepend it. Each page is snapped to a user-turn boundary and abuts the
  // current first message exactly (cursor = first loaded byte), so folding the
  // page on its own and prepending is equivalent to a single larger fold.
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
          updateSession(sessionId, (s) => ({
            ...(result.status ? projectRuntimeStatus(s, result.status) : s),
            contextUsage: api.runtimeContextUsage(result.status ?? null, null),
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
    async (
      tab: { status: Session["status"]; piSessionId?: string | null },
      runtime: string,
    ): Promise<boolean> => {
      // "stopping" counts: the composer still draws itself as running there, and
      // a turn being torn down can still take a follow-up for the next one.
      if (tab.status !== "running" && tab.status !== "starting" && tab.status !== "stopping") {
        return false;
      }
      const status = await loadRuntimeStatusCb(runtime, tab.piSessionId).catch(() => null);
      return runtimeStatusAcceptsControl(status, tab.piSessionId);
    },
    [loadRuntimeStatusCb],
  );

  return useMemo<SessionEngine>(
    () => ({
      submitPrompt,
      sendControl,
      loadRuntimeStatus: loadRuntimeStatusCb,
      abortTurn,
      loadEarlier,
      compact,
      acceptsControl,
    }),
    [
      submitPrompt,
      sendControl,
      loadRuntimeStatusCb,
      abortTurn,
      loadEarlier,
      compact,
      acceptsControl,
    ],
  );
}
