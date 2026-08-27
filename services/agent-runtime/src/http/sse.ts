const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export type SseSend = (frame: string) => void;
type Options = {
  signal?: AbortSignal;
  connectComment?: string;
  heartbeat?: { intervalMs: number; comment: string };
  start: (send: SseSend, close: () => void) => (() => void) | void;
};

export function sseResponse(options: Options): Response {
  const encoder = new TextEncoder();
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let teardown: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        teardown?.();
        options.signal?.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {}
      };
      const send: SseSend = (frame) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          close();
        }
      };
      send(`: ${options.connectComment ?? "connected"}

`);
      const result = options.start(send, close);
      if (closed) {
        result?.();
        return;
      }
      teardown = result || undefined;
      if (options.signal?.aborted) return close();
      options.signal?.addEventListener("abort", close, { once: true });
      if (options.heartbeat) {
        const { intervalMs, comment } = options.heartbeat;
        heartbeat = setInterval(
          () =>
            send(`: ${comment}

`),
          intervalMs,
        );
      }
    },
    cancel: () => close(),
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
