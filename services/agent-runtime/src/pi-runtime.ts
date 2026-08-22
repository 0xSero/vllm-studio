import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  shouldCompact,
  type AgentSessionRuntime,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentImageInput } from "../../../shared/agent/agent-image-input";
import type { AgentQueueAction } from "../../../shared/agent/agent-turn";
import {
  applyRuntimeEnvInjections,
  buildAgentSessionOptionsSync,
  runtimeOptionsFingerprint,
  resolveAgentCwd,
  type RuntimeStartOptions,
} from "./pi-runtime-helpers";
import { refreshPiModels, resolvePiModelSelection, toPiThinkingLevel } from "./pi-runtime-models";
import { getProviderHub } from "./provider-hub";
import { attachGoalDriver } from "./goal-driver";
import { createGoalPromptExtension } from "./goal-prompt";
import { configuredPiSessionDir, findSessionFile } from "./sessions-store";
import { getGlobalSingleton } from "./instances";
import { connectorsRevisionSync } from "./connectors-service";
import { userPluginsRevisionSync } from "./user-plugins";
import type {
  LoggedPiEvent,
  PiAgentSession,
  PiAgentStatus,
  PiPromptOptions,
} from "./pi-runtime-types";

type PiEvent = LoggedPiEvent["event"];

function comparableQueuedText(text: string): string {
  const marker = "\n\nUser prompt:\n";
  const index = text.lastIndexOf(marker);
  return (index === -1 ? text : text.slice(index + marker.length)).trim();
}

function planQueuedFollowUpMutation(
  followUp: readonly string[],
  message: string,
  action: AgentQueueAction,
  replacement?: string,
): { promoted: string | null; followUp: string[] } | null {
  // Exact text first; fall back to the trimmed user-prompt tail so a queued
  // message that was decorated on its way in still matches.
  const exactIndex = followUp.indexOf(message);
  const target = comparableQueuedText(message);
  const index =
    exactIndex >= 0
      ? exactIndex
      : followUp.findIndex((candidate) => comparableQueuedText(candidate) === target);
  if (index < 0) return null;
  if (action === "replace" && !replacement) {
    throw new Error("Replacement text is required.");
  }
  const before = followUp.slice(0, index);
  const after = followUp.slice(index + 1);
  return {
    promoted: action === "promote" ? followUp[index]! : null,
    followUp: action === "replace" ? [...before, replacement!, ...after] : [...before, ...after],
  };
}

type QueueTransport = {
  steer: (message: string, images?: AgentImageInput[]) => Promise<void>;
  followUp: (message: string, images?: AgentImageInput[]) => Promise<void>;
};

async function restoreQueuedMessages(
  session: QueueTransport,
  cleared: { steering: readonly string[]; followUp: readonly string[] },
  mutation: { promoted: string | null; followUp: readonly string[] } | null,
  images: AgentImageInput[] = [],
): Promise<void> {
  for (const queued of cleared.steering) await session.steer(queued);
  if (mutation?.promoted) await session.steer(mutation.promoted, images);
  for (const queued of mutation?.followUp ?? cleared.followUp) await session.followUp(queued);
}

/** Appended to the system prompt for vision-capable models. Kept as an extra
 *  section rather than a replacement so first-party extensions still apply. */
const VISION_GUIDANCE =
  "When an image is attached, inspect it carefully before answering. State only details visible in the image. Never invent labels, UI elements, text, or facts. Say when details are too small or uncertain. Give a concise answer. Use available tools to inspect supplied files when helpful.";

function selectPiRuntimeModel(
  models: Awaited<ReturnType<typeof refreshPiModels>>["models"],
  requestedModelId: string,
) {
  /** Exactly one match resolves; several are a genuine ambiguity, none falls through. */
  const only = (matches: typeof models) => {
    if (matches.length > 1) throw new Error(`Model '${requestedModelId}' is ambiguous.`);
    return matches[0] ?? null;
  };
  const exact = models.find((model) => model.id === requestedModelId);
  if (exact) return exact;
  const separator = requestedModelId.indexOf("/");
  if (separator > 0) {
    const providerId = requestedModelId.slice(0, separator);
    const rawId = requestedModelId.slice(separator + 1);
    const qualified = only(
      models.filter(
        (model) => model.providerId === providerId && (model.rawId === rawId || model.id === rawId),
      ),
    );
    if (qualified) return qualified;
  }
  return only(
    models.filter((model) => model.rawId === requestedModelId || model.name === requestedModelId),
  );
}

function runtimeFingerprint(
  modelId: string,
  cwd: string,
  piSessionId: string | null,
  options: RuntimeStartOptions,
) {
  return JSON.stringify({
    modelId,
    cwd,
    piSessionId: piSessionId ?? "",
    options: runtimeOptionsFingerprint(options),
    connectors: connectorsRevisionSync(),
    // pi snapshots its extension inventory once, when the session starts, so a
    // plugin the user just wrote is invisible to a session that is already
    // running. Folding the extensions directory's revision in here rebuilds the
    // session on the next turn — the same deal connectors get, and the reason
    // the Plugins tab can promise "save, then send your next message" instead
    // of "restart the app".
    plugins: userPluginsRevisionSync(),
  });
}

function shouldRestartAfterPromptError(error: unknown): boolean {
  return (
    error instanceof Error && /Cannot continue from message role: assistant/i.test(error.message)
  );
}

type PiResourceDiagnostic = {
  type: "info" | "warning" | "error";
  message: string;
  path?: string;
};

function diagnosticsMap(): Map<string, PiResourceDiagnostic[]> {
  return getGlobalSingleton(
    "piResourceDiagnostics",
    () => new Map<string, PiResourceDiagnostic[]>(),
  );
}

export function piResourceDiagnostics(agentDir?: string): PiResourceDiagnostic[] {
  const map = diagnosticsMap();
  return agentDir ? (map.get(agentDir) ?? []) : [...map.values()].flat();
}

class PiSdkSession extends EventEmitter implements PiAgentSession {
  private runtime: AgentSessionRuntime | null = null;
  private unsubscribe: (() => void) | null = null;
  private eventSeq = 0;
  private eventLog: LoggedPiEvent[] = [];
  private activePromptCount = 0;
  private lastError: string | null = null;
  private currentFingerprint = "";
  private currentPiSessionId: string | null = null;
  private currentCwd = "";
  private currentModelId = "";
  private currentStartOptions: RuntimeStartOptions = {};
  private agentDir = "";
  private queueEventBufferDepth = 0;
  private bufferedQueueEvent: PiEvent | null = null;
  private extensionUiPending = new Map<
    string,
    { method: "select" | "confirm" | "input" | "editor"; resolve: (value: unknown) => void }
  >();

  ensureStarted(
    modelId: string,
    cwd?: string,
    piSessionId?: string | null,
    options?: RuntimeStartOptions,
  ): Promise<void> {
    return this.start(
      modelId,
      cwd,
      piSessionId,
      structuredClone(options ?? (this.runtime ? this.currentStartOptions : {})),
    );
  }

  private async start(
    modelId: string,
    cwd: string | undefined,
    piSessionId: string | null | undefined,
    options: RuntimeStartOptions,
  ): Promise<void> {
    const resolvedCwd = await resolveAgentCwd(cwd);
    const desiredSessionId = piSessionId ?? null;
    const fingerprint = runtimeFingerprint(modelId, resolvedCwd, desiredSessionId, options);
    if (this.runtime && this.currentFingerprint === fingerprint) return;

    await this.stop();
    this.eventSeq = 0;
    this.eventLog = [];
    this.activePromptCount = 0;
    this.lastError = null;

    const { models } = await refreshPiModels();
    const selectedModel = selectPiRuntimeModel(models, modelId);
    if (!selectedModel) {
      throw new Error(`Model '${modelId}' is not available from /v1/models.`);
    }
    const resolvedSelection = resolvePiModelSelection(selectedModel.id);
    const providerId = selectedModel.providerId ?? resolvedSelection.providerId;
    const backendModelId = selectedModel.rawId ?? resolvedSelection.modelId;

    // One shared ModelRuntime across sessions and the provider hub: a
    // sign-in completed in settings is live for the next turn.
    const sharedModelRuntime = await getProviderHub();

    const sessionOptions = buildAgentSessionOptionsSync({ options, cwd: resolvedCwd });
    applyRuntimeEnvInjections(sessionOptions.envInjections);
    // Expose the current session's model so the automations extension can
    // default a scheduled run to the same model the user is talking to.
    applyRuntimeEnvInjections({ LOCAL_STUDIO_MODEL_ID: modelId });
    const sessionDir = configuredPiSessionDir(resolvedCwd);
    const resumeFile = desiredSessionId ? findSessionFile(resolvedCwd, desiredSessionId) : null;
    const sessionManager = resumeFile
      ? SessionManager.open(resumeFile, sessionDir, resolvedCwd)
      : SessionManager.create(resolvedCwd, sessionDir);
    const resuming = Boolean(resumeFile);
    const agentDir = getAgentDir();
    const extensionUiContext = this.extensionUiContext();
    const recordExtensionEvent = (event: PiEvent) => this.recordEvent(event);
    const runtime = await createAgentSessionRuntime(
      async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
        const services = await createAgentSessionServices({
          cwd,
          agentDir,
          modelRuntime: sharedModelRuntime,
          resourceLoaderOptions: {
            additionalSkillPaths: sessionOptions.skills,
            additionalExtensionPaths: sessionOptions.extensionPaths,
            additionalPromptTemplatePaths: sessionOptions.promptTemplatePaths,
            // In-process: the goal section is injected per turn
            // via before_agent_start, keyed by the canonical
            // piSessionId this SessionManager owns. Runs here so
            // it never depends on the RPC extension's session id
            // (which differs and left the goal unread — #284).
            extensionFactories: [
              {
                name: "local-studio-goal",
                factory: createGoalPromptExtension(() => sessionManager.getSessionId()),
              },
            ],
            // Vision guidance is APPENDED, not substituted. This branch used to
            // set noExtensions/noSkills/noContextFiles and replace the whole
            // system prompt, which silently disabled every first-party extension
            // (session goal, artifact policy, subagents) on any
            // vision-capable model — i.e. on the primary model.
            ...(selectedModel.vision
              ? {
                  appendSystemPromptOverride: (base: string[]) => [...base, VISION_GUIDANCE],
                }
              : {}),
          },
        });
        const model = services.modelRuntime.getModel(providerId, backendModelId);
        if (!model) {
          throw new Error(
            `Model '${providerId}/${backendModelId}' is not available to the SDK runtime.`,
          );
        }
        const created = await createAgentSessionFromServices({
          services,
          sessionManager,
          sessionStartEvent,
          model,
          thinkingLevel: selectedModel.reasoning
            ? toPiThinkingLevel(options.thinkingLevel ?? "high")
            : undefined,
        });
        const activeToolNames =
          options.toolAccess === "read_only"
            ? ["read", "grep", "find", "ls"]
            : created.session.getAllTools().map((tool) => tool.name);
        created.session.setActiveToolsByName(activeToolNames);
        await created.session.bindExtensions({
          mode: "rpc",
          uiContext: extensionUiContext,
          onError: (error) => {
            recordExtensionEvent({
              type: "extension_error",
              error: error.error,
              extensionPath: error.extensionPath,
              event: error.event,
            });
          },
        });
        const extensionErrors = services.resourceLoader
          .getExtensions()
          .errors.map(({ path, error }) => ({
            type: "error" as const,
            message: `Failed to load extension "${path}": ${error}`,
            path,
          }));
        const diagnostics = [...services.diagnostics, ...extensionErrors];
        diagnosticsMap().set(
          agentDir,
          diagnostics.map((d) => ({
            type: d.type as PiResourceDiagnostic["type"],
            message: d.message,
            path: "path" in d ? (d as { path?: string }).path : undefined,
          })),
        );
        return { ...created, services, diagnostics };
      },
      {
        cwd: resolvedCwd,
        agentDir,
        sessionManager,
        sessionStartEvent: { type: "session_start", reason: resuming ? "resume" : "startup" },
      },
    );

    this.runtime = runtime;
    this.agentDir = agentDir;
    this.currentModelId = modelId;
    this.currentCwd = resolvedCwd;
    this.currentPiSessionId = runtime.session.sessionId || desiredSessionId;
    this.currentFingerprint = fingerprint;
    this.currentStartOptions = options;
    this.unsubscribe = runtime.session.subscribe((event) => this.recordEvent(event));
  }

  async prompt(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    options: PiPromptOptions = {},
  ): Promise<void> {
    const listener = (logged: LoggedPiEvent) => onEvent(logged.event, logged.seq);
    this.on("loggedEvent", listener);
    this.activePromptCount += 1;
    this.lastError = null;
    try {
      try {
        await this.promptSession(message, options);
      } catch (error) {
        if (options.restartOnContinuationError === false || !shouldRestartAfterPromptError(error)) {
          throw error;
        }
        // Rebuild the session from scratch (no resume id) and re-send: pi
        // refuses to continue a transcript that ends on an assistant message.
        await this.start(this.currentModelId, this.currentCwd, null, this.currentStartOptions);
        await this.promptSession(message, options);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.activePromptCount = Math.max(0, this.activePromptCount - 1);
      this.off("loggedEvent", listener);
    }
  }

  private promptSession(message: string, options: PiPromptOptions): Promise<void> {
    // restartOnContinuationError is ours, not the SDK's — everything else forwards.
    const { restartOnContinuationError: _restart, ...sdkOptions } = options;
    return this.requireSession().prompt(message, sdkOptions);
  }

  async steer(message: string, images: AgentImageInput[] = []): Promise<void> {
    return this.requireSession().steer(message, images);
  }

  async mutateQueuedFollowUp(
    message: string,
    action: AgentQueueAction,
    replacement?: string,
    images: AgentImageInput[] = [],
  ): Promise<void> {
    const session = this.requireSession();
    this.queueEventBufferDepth += 1;
    try {
      const cleared = session.clearQueue();
      const mutation = planQueuedFollowUpMutation(cleared.followUp, message, action, replacement);
      if (!mutation) {
        await restoreQueuedMessages(session, cleared, null);
        throw new Error("Queued follow-up is no longer pending.");
      }
      await restoreQueuedMessages(session, cleared, mutation, images);
    } finally {
      this.flushBufferedQueueEvent();
    }
  }

  async followUp(message: string, images: AgentImageInput[] = []): Promise<void> {
    return this.requireSession().followUp(message, images);
  }

  adoptPiSessionId(piSessionId: string | null | undefined): void {
    const next = piSessionId?.trim();
    if (next && !this.currentPiSessionId) this.currentPiSessionId = next;
  }

  async compact(customInstructions?: string): Promise<unknown> {
    if (this.activePromptCount > 0) {
      throw new Error("Cannot compact while the agent is running.");
    }
    return this.requireSession().compact(customInstructions);
  }

  /** Stop the current run and hand back whatever was still queued.
   *
   *  clearQueue() returns the texts precisely so they are not lost — pi's own
   *  TUI puts them back in the editor. Discarding them meant a stop silently
   *  destroyed every message the user had lined up. */
  async abort(): Promise<{ steering: string[]; followUp: string[] }> {
    try {
      const session = this.runtime?.session;
      if (!session) return { steering: [], followUp: [] };
      const cleared = session.clearQueue();
      await session.abort();
      await session.waitForIdle();
      return {
        steering: [...(cleared?.steering ?? [])],
        followUp: [...(cleared?.followUp ?? [])],
      };
    } catch {
      return { steering: [], followUp: [] };
    }
  }

  respondExtensionUi(
    requestId: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): boolean {
    const pending = this.extensionUiPending.get(requestId);
    if (!pending) return false;
    this.extensionUiPending.delete(requestId);
    if (response.cancelled) {
      pending.resolve(pending.method === "confirm" ? false : undefined);
      return true;
    }
    pending.resolve(pending.method === "confirm" ? response.confirmed === true : response.value);
    return true;
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    const runtime = this.runtime;
    this.runtime = null;
    for (const pending of this.extensionUiPending.values()) {
      pending.resolve(pending.method === "confirm" ? false : undefined);
    }
    this.extensionUiPending.clear();
    await runtime?.dispose().catch(() => undefined);
  }

  get status(): PiAgentStatus {
    const sdkSession = this.runtime?.session;
    const sdkActive =
      Boolean(sdkSession?.isStreaming) ||
      Boolean(sdkSession?.isCompacting) ||
      (sdkSession?.pendingMessageCount ?? 0) > 0;
    return {
      running: Boolean(this.runtime),
      active: this.activePromptCount > 0 || sdkActive,
      modelId: this.currentModelId,
      cwd: this.currentCwd,
      piSessionId: this.currentPiSessionId,
      agentDir: this.agentDir,
      eventSeq: this.eventSeq,
      lastError: this.lastError,
      contextUsage: this.computeContextUsage(),
    };
  }

  private computeContextUsage() {
    const session = this.runtime?.session;
    if (!session) return null;
    const usage = session.getContextUsage();
    if (!usage) return null;
    const settings = session.settingsManager.getCompactionSettings();
    const tokens = typeof usage.tokens === "number" ? usage.tokens : null;
    return {
      tokens,
      contextWindow: usage.contextWindow,
      percent: typeof usage.percent === "number" ? usage.percent : null,
      shouldCompact:
        tokens !== null && usage.contextWindow > 0
          ? shouldCompact(tokens, usage.contextWindow, settings)
          : false,
    };
  }

  getEventsAfter(seq: number): LoggedPiEvent[] {
    const floor = Number.isFinite(seq) ? Math.max(0, Math.trunc(seq)) : 0;
    return this.eventLog.filter((entry) => entry.seq > floor);
  }

  onLoggedEvent(listener: (event: LoggedPiEvent) => void) {
    this.on("loggedEvent", listener);
    return () => this.off("loggedEvent", listener);
  }

  private requireSession() {
    const session = this.runtime?.session;
    if (!session) throw new Error("pi sdk session is not running");
    return session;
  }

  private extensionUiContext(): ExtensionUIContext {
    const request = (
      method: "select" | "confirm" | "input" | "editor",
      payload: Record<string, unknown>,
      timeout?: number,
      signal?: AbortSignal,
    ) => {
      const requestId = randomUUID();
      return new Promise<unknown>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (value: unknown) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          this.extensionUiPending.delete(requestId);
          resolve(value);
        };
        const cancel = () => finish(method === "confirm" ? false : undefined);
        this.extensionUiPending.set(requestId, { method, resolve: finish });
        this.recordEvent({ type: "extension_ui_request", requestId, method, ...payload });
        if (timeout && timeout > 0) timer = setTimeout(cancel, timeout);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    };
    return {
      select: (title, options, opts) =>
        request("select", { title, options }, opts?.timeout, opts?.signal) as Promise<
          string | undefined
        >,
      confirm: (title, message, opts) =>
        request("confirm", { title, message }, opts?.timeout, opts?.signal) as Promise<boolean>,
      input: (title, placeholder, opts) =>
        request("input", { title, placeholder }, opts?.timeout, opts?.signal) as Promise<
          string | undefined
        >,
      editor: (title, prefill) =>
        request("editor", { title, prefill }) as Promise<string | undefined>,
      notify: (message, level = "info") => this.recordEvent({ type: "notice", level, message }),
      setStatus: (key, text) =>
        this.recordEvent({ type: "extension_status", key, text: text ?? null }),
      setTitle: (title) => this.recordEvent({ type: "extension_title", title }),
      onTerminalInput: () => () => undefined,
      setWorkingMessage: () => undefined,
      setWorkingVisible: () => undefined,
      setWorkingIndicator: () => undefined,
      setHiddenThinkingLabel: () => undefined,
      setWidget: () => undefined,
      setFooter: () => undefined,
      setHeader: () => undefined,
      custom: async () => undefined as never,
      pasteToEditor: () => undefined,
      setEditorText: () => undefined,
      getEditorText: () => "",
      addAutocompleteProvider: () => undefined,
      setEditorComponent: () => undefined,
      getEditorComponent: () => undefined,
      theme: undefined as never,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme changes require the Pi TUI" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined,
    };
  }

  private recordEvent(event: PiEvent) {
    if (event.type === "queue_update" && this.queueEventBufferDepth > 0) {
      this.bufferedQueueEvent = event;
      return;
    }
    if (event.type === "session_info_changed" && this.runtime?.session.sessionId) {
      this.currentPiSessionId = this.runtime.session.sessionId;
    }
    const logged: LoggedPiEvent = {
      seq: ++this.eventSeq,
      event: event as PiEvent,
      timestamp: new Date().toISOString(),
    };
    this.eventLog.push(logged);
    if (this.eventLog.length > 2_000) this.eventLog.splice(0, this.eventLog.length - 2_000);
    this.emit("loggedEvent", logged);
    this.emit("event", event);
  }

  private flushBufferedQueueEvent() {
    this.queueEventBufferDepth -= 1;
    if (this.queueEventBufferDepth !== 0 || !this.bufferedQueueEvent) return;
    const event = this.bufferedQueueEvent;
    this.bufferedQueueEvent = null;
    this.recordEvent(event);
  }
}

type RuntimeLookupEntry = {
  sessionId: string;
  session: PiAgentSession;
};

/** Ranked most significant first: a streaming runtime beats a merely started
 *  one, the exact requested key breaks that tie, and the longest event log
 *  breaks the rest. Compared lexicographically, so no field can be traded away
 *  against a bigger number in a lower one. */
function runtimeLookupRank(entry: RuntimeLookupEntry, requestedSessionId: string): number[] {
  return [
    entry.session.status.active === true ? 1 : 0,
    entry.session.status.running === true ? 1 : 0,
    entry.sessionId === requestedSessionId ? 1 : 0,
    entry.session.status.eventSeq ?? 0,
  ];
}

function runtimeLookupOutranks(
  candidate: RuntimeLookupEntry,
  current: RuntimeLookupEntry,
  requestedSessionId: string,
): boolean {
  const candidateRank = runtimeLookupRank(candidate, requestedSessionId);
  const currentRank = runtimeLookupRank(current, requestedSessionId);
  const first = candidateRank.findIndex((value, index) => value !== currentRank[index]);
  return first !== -1 && candidateRank[first]! > currentRank[first]!;
}

function findRuntimeSessionForLookup(
  entries: Iterable<RuntimeLookupEntry>,
  sessionId: string,
  piSessionId?: string | null,
): RuntimeLookupEntry | null {
  const snapshot = [...entries];
  const target = piSessionId?.trim();
  if (!target) return snapshot.find((entry) => entry.sessionId === sessionId) ?? null;
  return snapshot
    .filter(
      (entry) =>
        entry.session.status.piSessionId === target ||
        (entry.sessionId === sessionId && !entry.session.status.piSessionId),
    )
    .reduce<RuntimeLookupEntry | null>(
      (best, candidate) =>
        !best || runtimeLookupOutranks(candidate, best, sessionId) ? candidate : best,
      null,
    );
}

const DEFAULT_SESSION_ID = "default";

class PiRuntimeManager {
  private sessions = new Map<string, PiAgentSession>();

  getSession(sessionId = DEFAULT_SESSION_ID): PiAgentSession {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const created = new PiSdkSession();
    attachGoalDriver(created);
    this.sessions.set(sessionId, created);
    return created;
  }

  getSessionForLookup(
    sessionId = DEFAULT_SESSION_ID,
    piSessionId?: string | null,
  ): { sessionId: string; session: PiAgentSession } {
    const resolved = this.findSessionForLookup(sessionId, piSessionId);
    if (resolved) return resolved;
    const target = piSessionId?.trim();
    const exactPiSessionId = this.sessions.get(sessionId)?.status.piSessionId;
    const runtimeSessionId =
      target && exactPiSessionId && exactPiSessionId !== target
        ? `${sessionId}:${target}`
        : sessionId;
    const session = this.getSession(runtimeSessionId);
    session.adoptPiSessionId(target);
    return { sessionId: runtimeSessionId, session };
  }

  findSessionForLookup(
    sessionId = DEFAULT_SESSION_ID,
    piSessionId?: string | null,
  ): { sessionId: string; session: PiAgentSession } | null {
    return findRuntimeSessionForLookup(this.listSessions(), sessionId, piSessionId);
  }

  listSessions(): Array<{ sessionId: string; session: PiAgentSession }> {
    return [...this.sessions.entries()].map(([sessionId, session]) => ({ sessionId, session }));
  }
}

export const piRuntimeManager = getGlobalSingleton(
  "piRuntimeManager",
  () => new PiRuntimeManager(),
);
