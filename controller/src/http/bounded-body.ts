import { Effect } from "effect";

export class RequestBodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

const bodyBytes = async (request: Request, limit: number): Promise<ArrayBuffer> => {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw new RequestBodyTooLargeError(limit);
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(limit);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new ArrayBuffer(total);
  const bytes = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export const readBoundedRequestBody = (request: Request, limit: number): Promise<ArrayBuffer> =>
  Effect.runPromise(
    Effect.tryPromise({
      try: () => bodyBytes(request, limit),
      catch: (error) =>
        error instanceof RequestBodyTooLargeError
          ? error
          : new Error(error instanceof Error ? error.message : String(error)),
    }),
  );

export const boundedFormData = async (request: Request, limit: number): Promise<FormData> => {
  const body = await readBoundedRequestBody(request, limit);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  }).formData();
};
