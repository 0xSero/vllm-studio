import { NextRequest, NextResponse } from "next/server";
import { loadSkillInstructions } from "@local-studio/agent-runtime/skill-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const skillPath = request.nextUrl.searchParams.get("path") ?? "";
  const skill = skillPath ? loadSkillInstructions(skillPath) : null;
  if (!skill) return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  return NextResponse.json({ skill });
}
