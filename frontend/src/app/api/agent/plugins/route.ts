import { NextRequest, NextResponse } from "next/server";
import { discoverPlugins } from "@/lib/agent/plugin-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const allPlugins = discoverPlugins();
  const includeDisabled = request.nextUrl.searchParams.get("includeDisabled") === "1";
  const plugins = includeDisabled ? allPlugins : allPlugins.filter((row) => row.enabled);
  const computerUse =
    plugins.find((row) => row.enabled && row.name.includes("computer-use")) ?? null;
  const browserUse = plugins.find((row) => row.enabled && row.name.includes("browser-use")) ?? null;
  return NextResponse.json({
    plugins,
    validation: {
      browserUseAvailable: Boolean(browserUse),
      browserUse,
      computerUseAvailable: Boolean(computerUse),
      computerUse,
    },
  });
}
