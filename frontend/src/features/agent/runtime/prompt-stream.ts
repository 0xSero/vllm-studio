import { Effect } from "effect";
import {
  type AssistantBlock,
  type ChatMessageAttachment,
  type ToolBlock,
  newId,
  nowLabel,
  sessionTitleFromPrompt,
} from "@/features/agent/messages";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type {
  AgentImageInput,
  AgentThinkingLevel,
  AgentToolAccess,
} from "@/features/agent/contracts";
import type { BrowserBackend, ToolSelection } from "@/features/agent/tools/types";
import * as api from "@/features/agent/runtime/api";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import type {
  AgentHarness,
  Session,
  SessionId,
  UpdateSession,
} from "@/features/agent/runtime/types";
import {
  runtimeCanHydrateCanonicalSession,
  settleTurn,
} from "@/features/agent/runtime/session-status";
import { readAgentDefaults } from "@/features/agent/workspace/model-preference";
import { prepareTaskWorkspace } from "@/features/agent/projects/api";

const EMPTY_SKILLS: ComposerSkillRef[] = [];
const EMPTY_PROMPT_TEMPLATES: ComposerPromptTemplateRef[] = [];

type MutableRef<T> = { current: T };

export type SubmitArgs = {
  text: string;
  /** Pre-resolved prompt text (with attachments / context already merged). */
  prompt: string;
  displayText: string;
  userText: string;
  images?: AgentImageInput[];
  attachments?: ChatMessageAttachment[];
  browserToolEnabled?: boolean;
  skills?: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
  targetSessionId?: SessionId;
};

export type PromptStreamDeps = {
  activeTabId: SessionId;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  cwd: string;
  executionKind: "chat" | "project";
  modelId: string;
  modelRouteId: string;
  thinkingLevel: AgentThinkingLevel;
  toolAccess: AgentToolAccess;
  onPiSessionIdChange?: (piSessionId: string) => void;
  selectionFor: (sessionId: SessionId) => ToolSelection;
  tabsRef: MutableRef<Session[]>;
  updateSession: UpdateSession;
};

type PromptTurnContext = {
  assistantId: string;
  browserEnabledForTurn: boolean;
  promptTemplates: ComposerPromptTemplateRef[];
  runtime: string;
  selected: Session;
  sessionId: SessionId;
  skills: ComposerSkillRef[];
  userId: string;
};

type SetupToolName =
  | "local_studio_prepare_checkout"
  | "local_studio_start_sandbox"
  | "local_studio_clone_repository";

type SetupToolUpdate = {
  name: SetupToolName;
  status: ToolBlock["status"];
  args: Record<string, unknown>;
  resultText?: string;
};

export type SessionSubmitGuard = Set<SessionId>;

export function beginSessionSubmit(
  guard: SessionSubmitGuard,
  sessionId: SessionId | null | undefined,
): boolean {
  if (!sessionId || guard.has(sessionId)) return false;
  guard.add(sessionId);
  return true;
}

export function endSessionSubmit(
  guard: SessionSubmitGuard,
  sessionId: SessionId | null | undefined,
): void {
  if (!sessionId) return;
  guard.delete(sessionId);
}

export function submitPromptTurn(deps: PromptStreamDeps, args: SubmitArgs): Promise<void> {
  const context = createPromptTurnContext(deps, args);
  if (!context) return Promise.resolve();

  appendOptimisticPrompt(deps, context, args);
  return startPromptCommand(deps, context, args);
}

function createPromptTurnContext(
  deps: PromptStreamDeps,
  args: SubmitArgs,
): PromptTurnContext | null {
  const sessionId = args.targetSessionId ?? deps.activeTabId;
  const current = deps.tabsRef.current.find((tab) => tab.id === sessionId);
  if (!current || !deps.modelId) return null;
  const defaultHarness =
    typeof window === "undefined" ? "pi" : readAgentDefaults(window.localStorage).harness;
  const executionKind = current.executionKind ?? deps.executionKind;
  const selected = {
    ...current,
    executionKind,
    harness:
      executionKind === "project"
        ? (current.harness ?? (defaultHarness as AgentHarness))
        : undefined,
  };

  const selection = deps.selectionFor(sessionId);
  const skills = args.skills ?? selection.skills ?? EMPTY_SKILLS;
  const promptTemplates =
    args.promptTemplates ?? selection.promptTemplates ?? EMPTY_PROMPT_TEMPLATES;

  return {
    assistantId: newId("assistant"),
    browserEnabledForTurn:
      executionKind === "chat" ? true : (args.browserToolEnabled ?? deps.browserToolEnabled),
    promptTemplates,
    // The session id is the opaque runtime key the server addresses this
    // session by.
    runtime: selected.id,
    selected,
    sessionId,
    skills,
    userId: newId("user"),
  };
}

function appendOptimisticPrompt(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): void {
  deps.updateSession(context.sessionId, (session) => ({
    ...session,
    executionKind: context.selected.executionKind,
    harness: context.selected.harness,
    placement:
      context.selected.executionKind === "project" ? context.selected.placement : undefined,
    sandboxAccountId:
      context.selected.executionKind === "project" ? context.selected.sandboxAccountId : undefined,
    cwd: context.selected.executionKind === "chat" ? undefined : session.cwd || deps.cwd,
    modelId: session.modelId || deps.modelId,
    modelRouteId: session.modelRouteId || deps.modelRouteId,
    startedAt: session.startedAt ?? new Date().toISOString(),
    input: "",
    error: "",
    status: "starting",
    usedSkills: mergeSkills(session.usedSkills, context.skills),
    activeAssistantId: context.assistantId,
    title:
      session.messages.filter((message) => message.role === "user").length === 0
        ? sessionTitleFromPrompt(args.userText)
        : session.title,
    messages: [
      ...session.messages,
      {
        id: context.userId,
        role: "user",
        text: args.displayText,
        attachments: args.attachments,
        skills: context.skills,
        timestamp: nowLabel(),
      },
      { id: context.assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
    ],
  }));
}

function startPromptCommand(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): Promise<void> {
  const program = Effect.gen(function* () {
    if (
      context.selected.executionKind === "project" &&
      context.selected.managedProject &&
      context.selected.placement !== "sandbox" &&
      !context.selected.cwd
    ) {
      setSetupTool(deps, context, {
        name: "local_studio_prepare_checkout",
        status: "running",
        args: {
          repository: context.selected.projectId ?? "",
          ref: context.selected.baseRef || "main",
        },
      });
      const workspace = yield* Effect.tryPromise({
        try: () =>
          prepareTaskWorkspace({
            projectId: context.selected.projectId ?? "",
            sessionId: context.sessionId,
            ref: context.selected.baseRef || "main",
            ...(context.selected.branchName ? { branch: context.selected.branchName } : {}),
          }),
        catch: (error) => ({ _tag: "WorkspaceFailed" as const, error }),
      });
      context.selected.cwd = workspace.path;
      context.selected.detached = workspace.detached;
      setSetupTool(deps, context, {
        name: "local_studio_prepare_checkout",
        status: "done",
        args: {
          repository: context.selected.projectId ?? "",
          ref: context.selected.baseRef || "main",
        },
        resultText: workspace.path,
      });
      deps.updateSession(context.sessionId, (session) => ({
        ...session,
        cwd: workspace.path,
        detached: workspace.detached,
      }));
    }
    setSandboxSetupTools(deps, context, "running");
    const result = yield* Effect.tryPromise({
      try: () => api.submitTurnCommand(promptTurnRequest(deps, context, args)),
      catch: (error) => ({ _tag: "SubmitFailed" as const, error }),
    });
    setSandboxSetupTools(deps, context, "done");
    const canonicalSessionId =
      result.nativeSessionId || result.piSessionId || result.runtimeSessionId || context.runtime;
    deps.updateSession(context.sessionId, (session) => ({
      ...session,
      piSessionId: canonicalSessionId || session.piSessionId,
      contextUsage: api.runtimeContextUsage(result.status, session.contextUsage),
      status: "running",
      activeAssistantId: session.activeAssistantId ?? context.assistantId,
    }));
    sessionRuntimeController().noteTurnAccepted(
      context.sessionId,
      context.assistantId,
      result.status?.eventSeq,
    );
    if (canonicalSessionId) deps.onPiSessionIdChange?.(canonicalSessionId);
  }).pipe(
    Effect.catch(({ error }) =>
      Effect.gen(function* () {
        const currentPiSessionId = latestPiSessionId(deps, context, null);
        const status = yield* Effect.tryPromise({
          try: () => api.loadRuntimeStatus(context.runtime, currentPiSessionId),
          catch: () => null,
        });
        if (runtimeCanHydrateCanonicalSession(status, currentPiSessionId)) {
          deps.updateSession(context.sessionId, (session) => ({
            ...session,
            piSessionId: status?.piSessionId || session.piSessionId,
            contextUsage: api.runtimeContextUsage(status, session.contextUsage),
            status: "running",
            activeAssistantId: session.activeAssistantId ?? context.assistantId,
          }));
          sessionRuntimeController().noteTurnAccepted(
            context.sessionId,
            context.assistantId,
            status?.eventSeq,
          );
          if (status?.piSessionId) deps.onPiSessionIdChange?.(status?.piSessionId);
          setSandboxSetupTools(deps, context, "done");
          return;
        }
        const message = error instanceof Error ? error.message : "Agent request failed";
        failRunningSetupTools(deps, context, error);
        deps.updateSession(context.sessionId, (session) =>
          settleFailedTurn(session, context.assistantId, message),
        );
      }),
    ),
  );
  return Effect.runPromise(program);
}

/**
 * Settle a turn whose submit failed and whose runtime probe confirmed it never
 * took. A second prompt may have superseded this turn while the failed POST and
 * the liveness probe were in flight (both are awaited), giving the session a new
 * `activeAssistantId` and `starting`/`running` status. Only surface the error and
 * idle the session when it is STILL on this turn's bubble; otherwise the newer
 * turn owns the intent state and clobbering it would strand the in-flight turn
 * with no live-target bubble. Mirrors the success path's non-clobbering guard.
 */
function settleFailedTurn(session: Session, assistantId: string, message: string): Session {
  if (session.activeAssistantId && session.activeAssistantId !== assistantId) return session;
  const assistant = session.messages.find((entry) => entry.id === assistantId);
  const hasSetupActivity = assistant?.blocks?.some(
    (block) => block.kind === "tool" && block.name.startsWith("local_studio_"),
  );
  return {
    ...settleTurn(session),
    messages: hasSetupActivity
      ? session.messages
      : session.messages.filter((entry) => entry.id !== assistantId),
    error: message,
  };
}

function setSetupTool(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  update: SetupToolUpdate,
): void {
  const { name, status, args, resultText } = update;
  const id = `${context.assistantId}:${name}`;
  deps.updateSession(context.sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.id !== context.assistantId) return message;
      const blocks = message.blocks ?? [];
      const index = blocks.findIndex((block) => block.kind === "tool" && block.id === id);
      const tool: ToolBlock = {
        kind: "tool",
        id,
        name,
        status,
        args,
        argsText: JSON.stringify(args),
        ...(resultText ? { resultText } : {}),
        text: resultText ?? JSON.stringify(args),
        startedAt:
          index >= 0 && blocks[index]?.kind === "tool"
            ? blocks[index].startedAt
            : new Date().toISOString(),
        ...(status !== "running" ? { finishedAt: new Date().toISOString() } : {}),
      };
      const next: AssistantBlock[] =
        index < 0
          ? [...blocks, tool]
          : blocks.map((block, blockIndex) => (blockIndex === index ? tool : block));
      return { ...message, blocks: next };
    }),
  }));
}

function setSandboxSetupTools(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  status: ToolBlock["status"],
): void {
  if (context.selected.placement !== "sandbox") return;
  setSetupTool(deps, context, {
    name: "local_studio_start_sandbox",
    status,
    args: { project: context.selected.projectId ?? "" },
  });
  setSetupTool(deps, context, {
    name: "local_studio_clone_repository",
    status,
    args: {
      repository: context.selected.projectId ?? "",
      ref: context.selected.baseRef || "main",
    },
  });
}

function failRunningSetupTools(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  error: unknown,
): void {
  const resultText = error instanceof Error ? error.message : "Setup failed";
  deps.updateSession(context.sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id !== context.assistantId
        ? message
        : {
            ...message,
            blocks: message.blocks?.map((block) =>
              block.kind === "tool" &&
              block.name.startsWith("local_studio_") &&
              block.status === "running"
                ? { ...block, status: "error", resultText, text: resultText }
                : block,
            ),
          },
    ),
  }));
}

function promptTurnRequest(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): api.SubmitTurnArgs {
  return {
    sessionId: context.runtime,
    kind: context.selected.executionKind ?? deps.executionKind,
    harness: context.selected.harness,
    projectId: context.selected.projectId,
    placement:
      context.selected.executionKind === "project" ? context.selected.placement : undefined,
    sandboxAccountId:
      context.selected.executionKind === "project" ? context.selected.sandboxAccountId : undefined,
    modelId: deps.modelId,
    modelRouteId: context.selected.modelRouteId || deps.modelRouteId,
    thinkingLevel: deps.thinkingLevel,
    toolAccess: deps.toolAccess,
    message: args.prompt,
    displayMessage: args.displayText,
    images: args.images,
    cwd:
      context.selected.executionKind === "chat"
        ? undefined
        : (context.selected.cwd || deps.cwd).trim() || undefined,
    piSessionId:
      deps.tabsRef.current.find((tab) => tab.id === context.sessionId)?.piSessionId ??
      context.selected.piSessionId,
    browserToolEnabled: context.browserEnabledForTurn,
    browserSessionId: context.runtime,
    browserBackend: deps.browserBackend,
    skills: context.skills,
    promptTemplates: context.promptTemplates,
  };
}

function latestPiSessionId(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  eventId: string | null,
): string {
  return (
    eventId ??
    deps.tabsRef.current.find((tab) => tab.id === context.sessionId)?.piSessionId ??
    context.selected.piSessionId ??
    ""
  );
}

function mergeSkills(
  existing: ComposerSkillRef[] | undefined,
  next: ComposerSkillRef[],
): ComposerSkillRef[] | undefined {
  if (!existing?.length && next.length === 0) return existing;
  const byId = new Map<string, ComposerSkillRef>();
  for (const skill of existing ?? []) byId.set(skill.id || skill.path || skill.name, skill);
  for (const skill of next) byId.set(skill.id || skill.path || skill.name, skill);
  return [...byId.values()];
}
