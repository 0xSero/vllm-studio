// HTTP surface for server-side PTY sessions. Output travels as SSE so the
// Next.js proxy streams it through unbuffered (pass-through bodies flush in
// the standalone server; only locally-generated streams don't). Frames:
//   event: snapshot  → base64 of the full replay buffer (first frame)
//   data:            → base64 of a live output chunk
//   event: exit      → {"exitCode":n,"signal":s}
// plus `: ping` comments to keep intermediaries from idling the stream out.

import {
  MAX_PTY_INPUT_CHARS,
  isPtyAvailable,
  ptyUnavailableReason,
  closePtySession,
  closePtySessionByOwner,
  openPtySession,
  resizePtySession,
  subscribePtySession,
  writePtySession,
} from "../pty-service";

const PING_INTERVAL_MS = 15_000;
const MAX_BODY_CHARS = MAX_PTY_INPUT_CHARS + 4_096;

function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return null;
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function encodeBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export async function handlePtyOpen(request: Request): Promise<Response> {
  if (!isPtyAvailable()) {
    return jsonError(`PTY unavailable: ${ptyUnavailableReason() ?? "unknown"}`, 503);
  }
  const body = await readJsonBody(request);
  if (!body) return jsonError("Invalid JSON body");
  try {
    const result = openPtySession({
      cwd: asString(body.cwd),
      ownerKey: asString(body.ownerKey),
      cols: Number(body.cols),
      rows: Number(body.rows),
    });
    return Response.json(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "PTY open failed", 500);
  }
}

export function handlePtyStream(request: Request): Response {
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return jsonError("id is required");

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (frame: string) => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Stream already closed by the client.
        }
      };
      const subscription = subscribePtySession(id, {
        onData: (chunk) => send(`data: ${encodeBase64(chunk)}\n\n`),
        onExit: (info) => {
          send(`event: exit\ndata: ${JSON.stringify(info)}\n\n`);
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        },
      });
      if (!subscription) {
        send(`event: gone\ndata: {}\n\n`);
        controller.close();
        return;
      }
      unsubscribe = subscription.unsubscribe;
      send(`event: snapshot\ndata: ${encodeBase64(subscription.replay)}\n\n`);
      ping = setInterval(() => send(`: ping\n\n`), PING_INTERVAL_MS);
      const cleanup = () => {
        if (ping) clearInterval(ping);
        ping = null;
        unsubscribe?.();
        unsubscribe = null;
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (ping) clearInterval(ping);
      ping = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export async function handlePtyInput(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const id = asString(body?.id)?.trim();
  const data = asString(body?.data);
  if (!body || !id || typeof data !== "string") return jsonError("id and data are required");
  if (data.length > MAX_PTY_INPUT_CHARS) return jsonError("input too large", 413);
  return Response.json({ ok: writePtySession(id, data) });
}

export async function handlePtyResize(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const id = asString(body?.id)?.trim();
  if (!body || !id) return jsonError("id is required");
  return Response.json({ ok: resizePtySession(id, Number(body.cols), Number(body.rows)) });
}

export async function handlePtyClose(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const id = asString(body?.id)?.trim();
  if (!body || !id) return jsonError("id is required");
  closePtySession(id);
  return Response.json({ ok: true });
}

export async function handlePtyCloseOwner(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const ownerKey = asString(body?.ownerKey)?.trim();
  if (!body || !ownerKey) return jsonError("ownerKey is required");
  closePtySessionByOwner(ownerKey);
  return Response.json({ ok: true });
}
