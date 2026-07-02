// Input forwarding for the visible browser panel. The panel POSTs pointer/key
// events (already in viewport coordinates) and we replay them into the headless
// Chromium over CDP. Body shapes:
//   { kind: "mouse", type, x, y, button?, clickCount? }
//   { kind: "wheel", x, y, deltaX?, deltaY? }
//   { kind: "key",   type: "down" | "up" | "char", key, code, text? }

import { NextRequest } from "next/server";
import {
  browserHost,
  type KeyInput,
  type MouseInput,
} from "@local-studio/agent-runtime/browser-host/browser-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InputBody =
  | ({ kind: "mouse" } & Omit<MouseInput, "type"> & { type: MouseInput["type"] })
  | ({ kind: "wheel" } & Omit<MouseInput, "type">)
  | ({ kind: "key" } & KeyInput);

export async function POST(request: NextRequest) {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: InputBody;
  try {
    body = (await request.json()) as InputBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await dispatch(body);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "input dispatch failed",
    });
  }
}

async function dispatch(body: InputBody): Promise<void> {
  if (body.kind === "key") {
    await browserHost.dispatchKey({
      type: body.type,
      key: body.key,
      code: body.code,
      text: body.text,
    });
    return;
  }
  if (body.kind === "wheel") {
    await browserHost.dispatchMouse({
      type: "wheel",
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      deltaX: body.deltaX,
      deltaY: body.deltaY,
    });
    return;
  }
  await browserHost.dispatchMouse({
    type: body.type,
    x: Number(body.x) || 0,
    y: Number(body.y) || 0,
    button: body.button,
    clickCount: body.clickCount,
  });
}
