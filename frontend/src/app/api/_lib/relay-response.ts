const BODY_HEADERS = ["content-length", "content-encoding", "transfer-encoding"];

function relayBody(
  body: ReadableStream<Uint8Array>,
  onError?: (error: unknown) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let finished = false;
  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (finished) return;
    finished = true;
    try {
      controller.close();
    } catch {}
  };
  return new ReadableStream({
    async pull(controller) {
      if (finished) return;
      try {
        const next = await reader.read();
        if (next.done) close(controller);
        else if (!finished) controller.enqueue(next.value);
      } catch (error) {
        if (!finished) onError?.(error);
        close(controller);
      }
    },
    cancel(reason) {
      finished = true;
      void reader.cancel(reason).catch(() => undefined);
    },
  });
}

export function relayResponse(
  response: Response,
  options: {
    headers?: HeadersInit;
    preserveHeaders?: boolean;
    onStreamError?: (error: unknown) => void;
  } = {},
): Response {
  const headers = options.preserveHeaders ? new Headers(response.headers) : new Headers();
  if (!options.preserveHeaders) {
    const contentType = response.headers.get("content-type") || "application/json";
    headers.set("content-type", contentType);
    if (contentType.includes("text/event-stream")) {
      headers.set("cache-control", response.headers.get("cache-control") || "no-cache");
      const runId = response.headers.get("x-run-id");
      if (runId) headers.set("x-run-id", runId);
    }
  }
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  BODY_HEADERS.forEach((header) => headers.delete(header));
  return new Response(response.body ? relayBody(response.body, options.onStreamError) : null, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
