import { NextRequest } from "next/server";
import { Effect } from "effect";
import {
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
  sanitizeComposerPromptTemplates,
  sanitizeComposerSkills,
  selectedContextInstructions,
} from "@/features/agent/composer-context";
import { piRuntimeManager } from "@/features/agent/pi-runtime";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompactRequest = {
  sessionId?: string;
  modelId?: string;
  cwd?: string;
  piSessionId?: string | null;
  customInstructions?: string;
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  browserBackend?: "embedded" | "sitegeist";
  canvasEnabled?: boolean;
  skills?: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

function compactInstructions(skills: ComposerSkillRef[], custom?: string): string | undefined {
  const selected = selectedContextInstructions(skills);
  let extra = custom?.trim() || "";
  if (selected && extra) {
    if (selected.includes(extra)) extra = "";
    else if (extra.includes(selected)) extra = extra.replace(selected, "").trim();
  }
  const additional = extra ? `Additional compaction instructions:\n${extra}` : null;
  return [selected, additional].filter((value): value is string => Boolean(value)).join("\n\n");
}

export function POST(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return Promise.resolve(denied);
  return Effect.runPromise(compactRouteEffect(request));
}

function compactRouteEffect(request: NextRequest): Effect.Effect<Response, unknown> {
  return Effect.gen(function* () {
    const body = (yield* Effect.tryPromise({
      try: () => request.json(),
      catch: () => null,
    })) as CompactRequest | null;
    if (!body) return jsonError("Invalid JSON body");

    const sessionId = body.sessionId?.trim() || "default";
    const modelId = body.modelId?.trim();
    const cwd = body.cwd?.trim() || undefined;
    const piSessionId = body.piSessionId?.trim() || null;
    if (!modelId) return jsonError("modelId is required");

    return yield* Effect.gen(function* () {
      const session = piRuntimeManager.getSession(sessionId);
      const skills = sanitizeComposerSkills(body.skills);
      const promptTemplates = sanitizeComposerPromptTemplates(body.promptTemplates);
      yield* Effect.tryPromise({
        try: () =>
          session.ensureStarted(modelId, cwd, piSessionId, {
            browserToolEnabled: body.browserToolEnabled === true,
            browserSessionId:
              typeof body.browserSessionId === "string" ? body.browserSessionId.trim() : undefined,
            browserBackend: body.browserBackend === "sitegeist" ? "sitegeist" : "embedded",
            canvasEnabled: body.canvasEnabled === true,
            skills,
            promptTemplates,
          }),
        catch: (error) => error,
      });
      const result = yield* Effect.tryPromise({
        try: () => session.compact(compactInstructions(skills, body.customInstructions)),
        catch: (error) => error,
      });
      return Response.json({ ok: true, result, status: session.status });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(jsonError(errorMessage(error, "Compaction failed"), 409)),
      ),
    );
  });
}
