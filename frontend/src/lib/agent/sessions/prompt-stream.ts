import {
  type ChatMessageAttachment,
  newId,
  nowLabel,
  sessionTitleFromPrompt,
} from "@/lib/agent/session";
import {
  activeComposerPlugins,
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/lib/agent/composer-context";
import type { AgentImageInput } from "@/lib/agent/contracts/turn";
import type { BrowserBackend, ToolSelection } from "@/lib/agent/tools/types";
import * as api from "./api";
import { runtimeIsActiveForPiSession } from "./engine-helpers";
import { sessionRuntimeController } from "./session-runtime-controller";
import type { Session, SessionId } from "./types";

const EMPTY_PLUGINS: ComposerPluginRef[] = [];
const EMPTY_SKILLS: ComposerSkillRef[] = [];
const EMPTY_PROMPT_TEMPLATES: ComposerPromptTemplateRef[] = [];

type MutableRef<T> = { current: T };
type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

export type SubmitArgs = {
  text: string;
  /** Pre-resolved prompt text (with attachments / context already merged). */
  prompt: string;
  displayText: string;
  userText: string;
  images?: AgentImageInput[];
  attachments?: ChatMessageAttachment[];
  browserToolEnabled?: boolean;
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
  targetSessionId?: SessionId;
};

export type PromptStreamDeps = {
  activeTabId: SessionId;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  canvasEnabled: boolean;
  cwd: string;
  modelId: string;
  onPiSessionIdChange?: (piSessionId: string) => void;
  runtimeSessionId: string;
  selectionFor: (sessionId: SessionId) => ToolSelection;
  tabsRef: MutableRef<Session[]>;
  updateSession: UpdateSession;
};

type PromptTurnContext = {
  assistantId: string;
  browserEnabledForTurn: boolean;
  plugins: ComposerPluginRef[];
  promptTemplates: ComposerPromptTemplateRef[];
  runtime: string;
  selected: Session;
  sessionId: SessionId;
  skills: ComposerSkillRef[];
  userId: string;
};

export async function submitPromptTurn(deps: PromptStreamDeps, args: SubmitArgs): Promise<void> {
  const context = createPromptTurnContext(deps, args);
  if (!context) return;

  appendOptimisticPrompt(deps, context, args);
  await startPromptCommand(deps, context, args);
}

function createPromptTurnContext(
  deps: PromptStreamDeps,
  args: SubmitArgs,
): PromptTurnContext | null {
  const sessionId = args.targetSessionId ?? deps.activeTabId;
  const selected = deps.tabsRef.current.find((tab) => tab.id === sessionId);
  if (!selected || !deps.modelId) return null;

  const selection = deps.selectionFor(sessionId);
  const plugins = args.plugins ?? activeComposerPlugins(selection.plugins ?? EMPTY_PLUGINS);
  const skills = args.skills ?? selection.skills ?? EMPTY_SKILLS;
  const promptTemplates =
    args.promptTemplates ?? selection.promptTemplates ?? EMPTY_PROMPT_TEMPLATES;

  return {
    assistantId: newId("assistant"),
    browserEnabledForTurn: args.browserToolEnabled ?? deps.browserToolEnabled,
    plugins,
    promptTemplates,
    runtime: selected.runtimeSessionId || deps.runtimeSessionId,
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
    cwd: session.cwd || deps.cwd,
    modelId: session.modelId || deps.modelId,
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

async function startPromptCommand(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): Promise<void> {
  try {
    const result = await api.submitTurnCommand(promptTurnRequest(deps, context, args));
    deps.updateSession(context.sessionId, (session) => ({
      ...session,
      piSessionId: result.piSessionId || session.piSessionId,
      contextUsage: api.runtimeContextUsage(result.status, session.contextUsage),
      status: "running",
      activeAssistantId: session.activeAssistantId ?? context.assistantId,
    }));
    sessionRuntimeController().noteTurnAccepted(context.sessionId);
    if (result.piSessionId) deps.onPiSessionIdChange?.(result.piSessionId);
  } catch (error) {
    const currentPiSessionId = latestPiSessionId(deps, context, null);
    const status = await api.loadRuntimeStatus(context.runtime, currentPiSessionId);
    if (runtimeIsActiveForPiSession(status, currentPiSessionId)) {
      deps.updateSession(context.sessionId, (session) => ({
        ...session,
        piSessionId: status?.piSessionId || session.piSessionId,
        contextUsage: api.runtimeContextUsage(status, session.contextUsage),
        status: "running",
        activeAssistantId: session.activeAssistantId ?? context.assistantId,
      }));
      sessionRuntimeController().noteTurnAccepted(context.sessionId);
      if (status?.piSessionId) deps.onPiSessionIdChange?.(status.piSessionId);
      return;
    }
    const message = error instanceof Error ? error.message : "Agent request failed";
    deps.updateSession(context.sessionId, (session) => ({
      ...session,
      error: message,
      status: "idle",
      activeAssistantId: undefined,
    }));
  }
}

function promptTurnRequest(
  deps: PromptStreamDeps,
  context: PromptTurnContext,
  args: SubmitArgs,
): api.SubmitTurnArgs {
  return {
    sessionId: context.runtime,
    modelId: deps.modelId,
    message: args.prompt,
    images: args.images,
    cwd: deps.cwd.trim() || undefined,
    piSessionId:
      deps.tabsRef.current.find((tab) => tab.id === context.sessionId)?.piSessionId ??
      context.selected.piSessionId,
    browserToolEnabled: context.browserEnabledForTurn,
    browserSessionId: context.runtime,
    browserBackend: deps.browserBackend,
    canvasEnabled: deps.canvasEnabled,
    plugins: context.plugins,
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
