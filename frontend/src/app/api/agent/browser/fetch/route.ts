// Reading-mode endpoint. The renderer-embedded webview goes blank in many
// real-world scenarios (CSP, X-Frame-Options, oversized SPAs, captive portals),
// and the server-side CDP browser host may be unavailable, so this route always
// offers a working "reading mode" that returns sanitized text + markdown.
//
// The fetch+sanitize core lives in browser-host/reader.ts (shared with the
// embedded [verb] fallback) so we never SSRF into private nets, strip
// scripts/styles, and cap response size.

import { NextRequest, NextResponse } from "next/server";
import { fetchReadable } from "@local-studio/agent-runtime/browser-host/reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "url is required" }, { status: 400 });
  try {
    const result = await fetchReadable(raw);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    // Only the initial url-rejection is a client error (400); resolved-host,
    // redirect, and upstream failures are bad-gateway (502) like before.
    const status = message.startsWith("url rejected") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
