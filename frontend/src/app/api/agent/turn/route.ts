import { NextRequest } from "next/server";
import { listSessions } from "@/lib/agent/sessions-store";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TurnRequest = {
  sessionId?: string;
  modelId?: string;
  message?: string;
  cwd?: string;
  // Optional pi session UUID to resume a past conversation. Distinct from
  // `sessionId`, which is the in-memory PiRpcSession key (one per browser tab).
  piSessionId?: string | null;
  // When true, pi-runtime loads the browser extension so the agent can drive
  // the embedded webview via tool calls.
  browserToolEnabled?: boolean;
  plugins?: Array<{ id?: string; name?: string; path?: string }>;
  // Send mode (matches pi-mono RPC): "prompt" runs immediately (or queues with
  // streamingBehavior), "steer" interrupts the current turn between tool
  // executions and the next LLM call, "follow_up" waits for the agent to
  // finish before being delivered.
  mode?: "prompt" | "steer" | "follow_up";
  streamingBehavior?: "steer" | "followUp";
};

function sse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: unknown,
  streamOpen: () => boolean = () => true,
) {
  if (!streamOpen()) return;
  const encoder = new TextEncoder();
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  } catch {
    // The browser may have navigated away. The Pi runtime must keep running;
    // callers can reattach through /api/agent/runtime/events.
  }
}

export async function POST(request: NextRequest) {
  let body: TurnRequest;
  try {
    body = (await request.json()) as TurnRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : "default";
  const cwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : undefined;
  const piSessionId =
    typeof body.piSessionId === "string" && body.piSessionId.trim()
      ? body.piSessionId.trim()
      : null;
  const browserToolEnabled = body.browserToolEnabled === true;
  const plugins = Array.isArray(body.plugins)
    ? body.plugins
        .map((plugin) => ({
          id: typeof plugin.id === "string" ? plugin.id : "",
          name: typeof plugin.name === "string" ? plugin.name : "",
          path: typeof plugin.path === "string" ? plugin.path : undefined,
        }))
        .filter((plugin) => plugin.name || plugin.id)
    : [];
  const mode: TurnRequest["mode"] =
    body.mode === "steer" || body.mode === "follow_up" ? body.mode : "prompt";
  const streamingBehavior =
    body.streamingBehavior === "steer" || body.streamingBehavior === "followUp"
      ? body.streamingBehavior
      : undefined;

  if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  if (!modelId) return Response.json({ error: "modelId is required" }, { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const isOpen = () => open;
      request.signal.addEventListener("abort", () => {
        open = false;
      });
      try {
        const turnStartedAt = new Date(Date.now() - 2_000);
        const session = piRuntimeManager.getSession(sessionId);
        const existingStatus = session.status;
        const effectivePiSessionId =
          mode === "prompt"
            ? piSessionId
            : existingStatus.running
              ? (existingStatus.piSessionId ?? piSessionId)
              : piSessionId;
        sse(controller, { type: "status", phase: "starting", sessionId, modelId, cwd }, isOpen);
        if (mode === "prompt" || !existingStatus.running) {
          await session.ensureStarted(modelId, cwd, effectivePiSessionId, {
            browserToolEnabled,
            plugins,
          });
        }
        sse(controller, { type: "status", phase: "running", session: session.status }, isOpen);
        if (mode === "steer") {
          await session.steer(message);
          // Steer is a fire-and-forget control message — events keep flowing on
          // the original prompt's stream. Close ours immediately.
          sse(controller, { type: "status", phase: "queued", queue: "steer" }, isOpen);
        } else if (mode === "follow_up") {
          await session.followUp(message);
          sse(controller, { type: "status", phase: "queued", queue: "follow_up" }, isOpen);
        } else {
          await session.prompt(
            message,
            (event, seq) => {
              sse(controller, { type: "pi", seq, event }, isOpen);
            },
            { streamingBehavior },
          );
        }
        const status = session.status;
        let resolvedPiSessionId = status.piSessionId;
        if (!resolvedPiSessionId && status.cwd) {
          const recent = await listSessions(status.cwd, { since: turnStartedAt });
          resolvedPiSessionId = recent[0]?.id ?? null;
        }
        sse(
          controller,
          { type: "status", phase: "done", piSessionId: resolvedPiSessionId },
          isOpen,
        );
      } catch (error) {
        sse(
          controller,
          {
            type: "error",
            error: error instanceof Error ? error.message : "Pi agent turn failed",
          },
          isOpen,
        );
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by client navigation
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
