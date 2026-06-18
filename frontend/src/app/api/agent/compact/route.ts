import { NextRequest } from "next/server";
import {
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
  sanitizeComposerPlugins,
  sanitizeComposerPromptTemplates,
  sanitizeComposerSkills,
  selectedContextInstructions,
} from "@/features/agent/composer-context";
import { piRuntimeManager } from "@/features/agent/pi-runtime";
import { errorMessage, jsonError } from "@/app/api/_lib/route-helpers";

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
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
};

function compactInstructions(
  plugins: ComposerPluginRef[],
  skills: ComposerSkillRef[],
  custom?: string,
): string | undefined {
  const selected = selectedContextInstructions(plugins, skills);
  let extra = custom?.trim() || "";
  if (selected && extra) {
    if (selected.includes(extra)) extra = "";
    else if (extra.includes(selected)) extra = extra.replace(selected, "").trim();
  }
  const additional = extra ? `Additional compaction instructions:\n${extra}` : null;
  return [selected, additional].filter((value): value is string => Boolean(value)).join("\n\n");
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CompactRequest | null;
  if (!body) return jsonError("Invalid JSON body");

  const sessionId = body.sessionId?.trim() || "default";
  const modelId = body.modelId?.trim();
  const cwd = body.cwd?.trim() || undefined;
  const piSessionId = body.piSessionId?.trim() || null;
  if (!modelId) return jsonError("modelId is required");

  try {
    const session = piRuntimeManager.getSession(sessionId);
    const plugins = sanitizeComposerPlugins(body.plugins);
    const skills = sanitizeComposerSkills(body.skills);
    const promptTemplates = sanitizeComposerPromptTemplates(body.promptTemplates);
    await session.ensureStarted(modelId, cwd, piSessionId, {
      browserToolEnabled: body.browserToolEnabled === true,
      browserSessionId:
        typeof body.browserSessionId === "string" ? body.browserSessionId.trim() : undefined,
      browserBackend: body.browserBackend === "sitegeist" ? "sitegeist" : "embedded",
      canvasEnabled: body.canvasEnabled === true,
      plugins,
      skills,
      promptTemplates,
    });
    const result = await session.compact(
      compactInstructions(plugins, skills, body.customInstructions),
    );
    return Response.json({ ok: true, result, status: session.status });
  } catch (error) {
    return jsonError(errorMessage(error, "Compaction failed"), 409);
  }
}
