import { Effect } from "effect";
import { cleanSessionTitle, messageTextFromBlocks } from "@/features/agent/messages";
import { loadAgentModelCatalog } from "@/features/agent/model-catalog-client";
import { foldSessionEvents } from "@/features/agent/runtime/pi-event-applier";
import { abortSession, loadRuntimeStatus, submitTurnCommand } from "@/features/agent/runtime/api";
import { readAgentDefaults } from "@/features/agent/workspace/model-preference";
import {
  recommendedThreadTitleRoute,
  threadTitleRouteChoices,
  type ThreadTitleRoute,
} from "@/features/agent/runtime/thread-title-model";

const TITLE_PROJECT_ID = "__local_studio_thread_title__";

type ThreadTitleInput = {
  userText: string;
  assistantText: string;
  currentModelId: string;
  currentRouteId: string;
};

function titleSessionId(): string {
  const suffix = globalThis.crypto.randomUUID().replaceAll("-", "");
  return `title-${suffix}`;
}

function titlePrompt(input: ThreadTitleInput): string {
  return [
    "Create a concise thread title of at most six words.",
    "Return only the title as plain text, without quotes, punctuation, or explanation.",
    "User request:",
    input.userText.slice(0, 6_000),
    "Assistant response:",
    input.assistantText.slice(0, 6_000),
  ].join("\n\n");
}

function normalizeGeneratedTitle(value: string): string | null {
  const firstLine = value.trim().split(/\r?\n/, 1)[0] ?? "";
  const unwrapped = firstLine
    .replace(/^\s*(?:title\s*:\s*)?/i, "")
    .replace(/^["'`]+|["'`.,:;!?]+$/g, "")
    .trim();
  const title = cleanSessionTitle(unwrapped).slice(0, 64);
  return title || null;
}

function titleFromStatusEvents(
  events: ReadonlyArray<{ event: Record<string, unknown> }> | undefined,
): string | null {
  if (!events?.length) return null;
  const { messages } = foldSessionEvents(events.map((entry) => entry.event));
  const assistant = messages.findLast((message) => message.role === "assistant");
  if (!assistant) return null;
  return normalizeGeneratedTitle(assistant.text || messageTextFromBlocks(assistant.blocks ?? []));
}

function loadTitleRoute(input: ThreadTitleInput): Effect.Effect<ThreadTitleRoute, unknown> {
  return Effect.gen(function* () {
    const models = yield* Effect.tryPromise(() => loadAgentModelCatalog());
    const choices = threadTitleRouteChoices(models);
    const defaults = readAgentDefaults(window.localStorage);
    const selected = choices.find(
      (choice) =>
        choice.modelId === defaults.titleModelId && choice.routeId === defaults.titleRouteId,
    );
    const recommended = recommendedThreadTitleRoute(choices);
    const current = choices.find(
      (choice) =>
        choice.modelId === input.currentModelId && choice.routeId === input.currentRouteId,
    );
    return selected ?? recommended ?? current ?? (yield* Effect.fail(new Error("No title model")));
  });
}

function waitForTitle(sessionId: string): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const status = yield* Effect.tryPromise(() => loadRuntimeStatus(sessionId));
      const title = titleFromStatusEvents(status?.events);
      const settled =
        status?.active === false || status?.phase === "idle" || status?.phase === "done";
      if (settled && title) return title;
      yield* Effect.sleep("250 millis");
    }
    return yield* Effect.fail(new Error("Thread title generation timed out"));
  });
}

export function generateThreadTitle(input: ThreadTitleInput): Promise<string | null> {
  const sessionId = titleSessionId();
  const program = Effect.gen(function* () {
    const route = yield* loadTitleRoute(input);
    yield* Effect.tryPromise(() =>
      submitTurnCommand({
        sessionId,
        kind: "chat",
        projectId: TITLE_PROJECT_ID,
        modelId: route.modelId,
        modelRouteId: route.routeId,
        thinkingLevel: "off",
        toolAccess: "read_only",
        message: titlePrompt(input),
        browserToolEnabled: false,
        skills: [],
        promptTemplates: [],
      }),
    );
    return yield* waitForTitle(sessionId);
  }).pipe(
    Effect.ensuring(Effect.tryPromise(() => abortSession(sessionId)).pipe(Effect.ignore)),
    Effect.catch(() => Effect.succeed(null)),
  );
  return Effect.runPromise(program);
}
