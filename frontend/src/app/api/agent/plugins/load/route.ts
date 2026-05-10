import { NextRequest, NextResponse } from "next/server";
import { loadPluginInstructions } from "@/lib/agent/plugin-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const pluginPath = request.nextUrl.searchParams.get("path") ?? "";
  const plugin = pluginPath ? loadPluginInstructions(pluginPath) : null;
  if (!plugin) return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  return NextResponse.json({ plugin });
}
