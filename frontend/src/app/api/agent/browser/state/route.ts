// Current page state for the visible browser panel.
// GET -> { ok: true, data: { url, title, canGoBack, canGoForward, loading } }

import { browserHost } from "@local-studio/agent-runtime/browser-host/browser-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  try {
    return Response.json({ ok: true, data: await browserHost.getState() });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "getState failed",
    });
  }
}
