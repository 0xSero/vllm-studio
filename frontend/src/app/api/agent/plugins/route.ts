import { NextRequest, NextResponse } from "next/server";
import { discoverPlugins } from "@/lib/agent/plugin-discovery";
import { buildPluginsResponse } from "@/lib/agent/plugin-response";
import { setCodexPluginEnabled } from "@/lib/agent/plugin-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const includeDisabled = request.nextUrl.searchParams.get("includeDisabled") === "1";
  return NextResponse.json(buildPluginsResponse(discoverPlugins(), { includeDisabled }));
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; source?: unknown; enabled?: unknown }
    | null;
  if (!body || typeof body.name !== "string" || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Expected { name, enabled, source? }." }, { status: 400 });
  }
  const result = setCodexPluginEnabled({
    name: body.name,
    source: typeof body.source === "string" ? body.source : undefined,
    enabled: body.enabled,
  });
  return NextResponse.json({
    ...buildPluginsResponse(discoverPlugins(), { includeDisabled: true }),
    updated: result,
  });
}
