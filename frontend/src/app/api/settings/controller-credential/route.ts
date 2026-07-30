import { NextRequest, NextResponse } from "next/server";
import { writeControllerCredential } from "@local-studio/agent-runtime/controller-credential-store";
import { requireApiAccess } from "@/lib/auth/guard";
import { normalizeControllerUrl } from "@/lib/api/controllers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as { backendUrl?: unknown; apiKey?: unknown };
    const backendUrl =
      typeof body.backendUrl === "string" ? normalizeControllerUrl(body.backendUrl) : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!backendUrl || apiKey.length > 32_768) {
      return NextResponse.json({ error: "Invalid controller credential" }, { status: 400 });
    }
    await writeControllerCredential(backendUrl, apiKey);
    return NextResponse.json({ success: true, hasApiKey: Boolean(apiKey) });
  } catch {
    return NextResponse.json(
      { error: "Controller credential could not be stored" },
      { status: 500 },
    );
  }
}
