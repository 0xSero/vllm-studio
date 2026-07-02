import { NextResponse } from "next/server";
import { discoverSkills } from "@local-studio/agent-runtime/skill-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ skills: discoverSkills() });
}
