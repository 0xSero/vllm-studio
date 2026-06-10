import { NextRequest } from "next/server";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { listSessions } from "@/features/agent/sessions-store";
import { archiveQueryOptions, parseRelativeSince } from "./session-query";
import { jsonError } from "@/app/api/_lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cwdParam = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
  const sinceParam = request.nextUrl.searchParams.get("since");
  const idsParam = request.nextUrl.searchParams.get("ids");
  const since = parseRelativeSince(sinceParam);
  const ids = idsParam
    ? idsParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : undefined;
  if (!cwdParam) return jsonError("cwd is required");
  if (sinceParam && !since) {
    return jsonError("since must use a relative value like 7d");
  }
  if (!path.isAbsolute(cwdParam)) {
    return jsonError("cwd must be absolute");
  }
  if (!existsSync(cwdParam) || !statSync(cwdParam).isDirectory()) {
    return Response.json({ sessions: [] });
  }
  const sessions = await listSessions(cwdParam, {
    ...(since ? { since } : {}),
    ids,
    ...archiveQueryOptions(request.nextUrl.searchParams),
  });
  return Response.json({ sessions });
}

export async function DELETE() {
  return jsonError("Session deletion is disabled. Archive sessions from the UI instead.", 405);
}
