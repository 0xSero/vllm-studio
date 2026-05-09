import { NextResponse } from "next/server";
import { discoverPlugins } from "@/lib/agent/plugin-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const plugins = discoverPlugins();
  const computerUse = plugins.find((row) => row.name.includes("computer-use")) ?? null;
  const browserUse = plugins.find((row) => row.name.includes("browser-use")) ?? null;
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
