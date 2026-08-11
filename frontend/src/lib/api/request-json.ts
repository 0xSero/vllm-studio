import { Effect, Schema } from "effect";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";

const errorMessage = (body: unknown, fallback: string): string => {
  const decoded = Schema.decodeUnknownOption(ApiErrorResponseSchema)(body);
  return decoded._tag === "Some" ? decoded.value.error : fallback;
};

export async function requestJson<T>(
  url: string,
  decode: (input: unknown) => T,
  init?: RequestInit,
  fallback = "Request failed",
): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body, `${fallback} (${response.status})`));
  return decode(body);
}

export const requestJsonEffect = <T>(
  url: string,
  schema: Schema.ConstraintDecoder<T>,
  init?: RequestInit,
  fallback?: string,
): Effect.Effect<T, Error> =>
  Effect.tryPromise({
    try: () => requestJson(url, Schema.decodeUnknownSync(schema), init, fallback),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });
