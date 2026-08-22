// Minimal response helpers for the transport-neutral handlers. These mirror
// frontend/src/app/api/_lib/route-helpers.ts (jsonError/errorMessage) — kept
// package-local so the handlers have zero frontend imports; the frontend
// keeps its own copy for the 20+ non-runtime routes that stay in Next.

import { Schema } from "effect";

/** Standard JSON error response used by the runtime handlers. */
export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function readJsonBody(
  request: Request,
  options?: { maxChars?: number },
): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (options?.maxChars !== undefined && text.length > options.maxChars) return null;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Normalize an unknown thrown value into a message for jsonError. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Decode a request body against a schema, or answer with the route's own
 * rejection. Callers test the result with `instanceof Response`.
 */
export async function decodeBody<S extends Schema.ConstraintDecoder<unknown>>(
  request: Request,
  schema: S,
  rejection: string,
  status = 400,
): Promise<S["Type"] | Response> {
  try {
    return Schema.decodeUnknownSync(schema)(await request.json()) as S["Type"];
  } catch {
    return jsonError(rejection, status);
  }
}

/** Run a handler body, turning a thrown value into the route's error response. */
export async function guarded(
  fallback: string,
  run: () => Promise<Response>,
  status = 500,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return jsonError(errorMessage(error, fallback), status);
  }
}
