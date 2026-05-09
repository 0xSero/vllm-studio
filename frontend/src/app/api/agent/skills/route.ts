import { NextResponse } from "next/server";
import { discoverSkills } from "@/lib/agent/skill-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ skills: discoverSkills() });
}
