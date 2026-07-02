// Sets the headless Chromium viewport so it matches the visible panel's
// dimensions. Body: { width, height }. Uses Page.setDeviceMetricsOverride with
// deviceScaleFactor 1 and mobile false.

import { NextRequest } from "next/server";
import { browserHost } from "@local-studio/agent-runtime/browser-host/browser-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: { width?: unknown; height?: unknown };
  try {
    body = (await request.json()) as { width?: unknown; height?: unknown };
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const width = Number(body.width);
  const height = Number(body.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return Response.json({ ok: false, error: "width and height are required" }, { status: 400 });
  }
  try {
    await browserHost.setViewport(width, height);
    return Response.json({
      ok: true,
      data: { width: Math.round(width), height: Math.round(height) },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "setViewport failed",
    });
  }
}
