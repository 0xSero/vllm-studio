import { NextRequest } from "next/server";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompactRequest = {
  sessionId?: string;
  modelId?: string;
  cwd?: string;
  piSessionId?: string | null;
  customInstructions?: string;
  browserToolEnabled?: boolean;
  plugins?: Array<{
    id?: string;
    name?: string;
    path?: string;
    skillPath?: string;
    mcpConfigPath?: string;
    appPath?: string;
  }>;
  skills?: Array<{ id?: string; name?: string; path?: string }>;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CompactRequest | null;
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });

  const sessionId = body.sessionId?.trim() || "default";
  const modelId = body.modelId?.trim();
  const cwd = body.cwd?.trim() || undefined;
  const piSessionId = body.piSessionId?.trim() || null;
  if (!modelId) return Response.json({ error: "modelId is required" }, { status: 400 });

  try {
    const session = piRuntimeManager.getSession(sessionId);
    await session.ensureStarted(modelId, cwd, piSessionId, {
      browserToolEnabled: body.browserToolEnabled === true,
      plugins: Array.isArray(body.plugins) ? body.plugins : [],
      skills: Array.isArray(body.skills) ? body.skills : [],
    });
    const result = await session.compact(body.customInstructions?.trim() || undefined);
    return Response.json({ ok: true, result, status: session.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Compaction failed" },
      { status: 409 },
    );
  }
}
