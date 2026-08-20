import { NextResponse, type NextRequest } from "next/server";
import { readUserPlugin } from "@local-studio/agent-runtime/user-plugins";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One plugin's source. Split from the listing route because a list of plugins
 * is read on every visit to the tab while the code behind them is read only
 * when one is opened, and shipping every file's text to draw a table of names
 * would make the tab slower the more plugins a user writes.
 */
export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    return NextResponse.json(await readUserPlugin(id));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Plugin could not be read" },
      { status: 404 },
    );
  }
}
