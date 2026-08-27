import { Option, Schema } from "effect";
import {
  MAX_PTY_INPUT_CHARS,
  isPtyAvailable,
  ptyUnavailableReason,
  closePtySession,
  openPtySession,
  resizePtySession,
  subscribePtySession,
  writePtySession,
} from "../pty-service";
import { errorMessage, jsonError, readJsonBody } from "./helpers";
import { sseResponse } from "./sse";

const PING_INTERVAL_MS = 15_000;
const MAX_BODY_CHARS = MAX_PTY_INPUT_CHARS + 4_096;
const PtyBodySchema = Schema.Struct({
  cwd: Schema.optional(Schema.String),
  ownerKey: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  data: Schema.optional(Schema.String),
  cols: Schema.optional(Schema.Unknown),
  rows: Schema.optional(Schema.Unknown),
});
type PtyBody = typeof PtyBodySchema.Type;

async function readPtyBody(request: Request): Promise<PtyBody | null> {
  const body = await readJsonBody(request, { maxChars: MAX_BODY_CHARS });
  return Option.getOrNull(Schema.decodeUnknownOption(PtyBodySchema)(body));
}

function encodeBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

export async function handlePtyOpen(request: Request): Promise<Response> {
  if (!isPtyAvailable()) {
    return jsonError(`PTY unavailable: ${ptyUnavailableReason() ?? "unknown"}`, 503);
  }
  const body = await readPtyBody(request);
  if (!body) return jsonError("Invalid JSON body");
  try {
    const result = openPtySession({
      cwd: body.cwd,
      ownerKey: body.ownerKey,
      cols: Number(body.cols),
      rows: Number(body.rows),
    });
    return Response.json(result);
  } catch (error) {
    return jsonError(errorMessage(error, "PTY open failed"), 500);
  }
}

export function handlePtyStream(request: Request): Response {
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return jsonError("id is required");
  return sseResponse({
    signal: request.signal,
    heartbeat: { intervalMs: PING_INTERVAL_MS, comment: "ping" },
    start(send, close) {
      const subscription = subscribePtySession(id, {
        onData: (chunk) => send(`data: ${encodeBase64(chunk)}\n\n`),
        onExit: (info) => {
          send(`event: exit\ndata: ${JSON.stringify(info)}\n\n`);
          close();
        },
      });
      if (!subscription) {
        send("event: gone\ndata: {}\n\n");
        close();
        return;
      }
      send(`event: snapshot\ndata: ${encodeBase64(subscription.replay)}\n\n`);
      return subscription.unsubscribe;
    },
  });
}

export async function handlePtyInput(request: Request): Promise<Response> {
  const body = await readPtyBody(request);
  const id = body?.id?.trim();
  const data = body?.data;
  if (!body || !id || data === undefined) return jsonError("id and data are required");
  if (data.length > MAX_PTY_INPUT_CHARS) return jsonError("input too large", 413);
  return Response.json({ ok: writePtySession(id, data) });
}

export async function handlePtyResize(request: Request): Promise<Response> {
  const body = await readPtyBody(request);
  const id = body?.id?.trim();
  if (!body || !id) return jsonError("id is required");
  return Response.json({ ok: resizePtySession(id, Number(body.cols), Number(body.rows)) });
}

export async function handlePtyClose(request: Request): Promise<Response> {
  const body = await readPtyBody(request);
  const id = body?.id?.trim();
  if (!body || !id) return jsonError("id is required");
  closePtySession(id);
  return Response.json({ ok: true });
}
