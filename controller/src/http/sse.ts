import { TextEncoder } from "node:util";

/**
 * Convert an async iterable of strings into a ReadableStream.
 * @param iterable - Async iterable of strings.
 * @returns ReadableStream of Uint8Array chunks.
 */
export const streamAsyncStrings = (iterable: AsyncIterable<string>): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(value));
    },
    async cancel(): Promise<void> {
      if (iterator.return) {
        await iterator.return();
      }
    },
  });
};

const HEARTBEAT_TICK = Symbol("sse-heartbeat-tick");

/**
 * Wrap an async iterable of SSE frames with periodic `: keepalive` comments so
 * idle connections are not dropped by intermediaries and dead links surface
 * promptly. Reuses a single pending read so the source iterator is never
 * advanced concurrently.
 * @param frames - Async iterable of SSE frame strings.
 * @param intervalMs - Idle interval before a heartbeat comment is emitted.
 * @param signal - Optional abort signal to stop early.
 * @returns Async generator of SSE frame strings including heartbeats.
 */
export async function* withSseHeartbeat(
  frames: AsyncIterable<string>,
  intervalMs: number,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const iterator = frames[Symbol.asyncIterator]();
  let pending = iterator.next();
  try {
    while (true) {
      if (signal?.aborted) break;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = new Promise<typeof HEARTBEAT_TICK>((resolve) => {
        timer = setTimeout(() => resolve(HEARTBEAT_TICK), intervalMs);
      });
      const winner = await Promise.race([pending, tick]);
      if (timer) clearTimeout(timer);
      if (winner === HEARTBEAT_TICK) {
        yield ": keepalive\n\n";
        continue;
      }
      if (winner.done) break;
      yield winner.value;
      pending = iterator.next();
    }
  } finally {
    await iterator.return?.();
  }
}

/**
 * Build SSE headers for streaming responses.
 * @param extra - Additional headers.
 * @returns Headers object.
 */
export const buildSseHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  ...extra,
});
