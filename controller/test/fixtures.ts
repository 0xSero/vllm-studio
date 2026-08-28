import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Directory holding the trimmed copies of real published registry records. */
export const fixturesDir = join(import.meta.dir, "fixtures", "registry");

export const fixtureJson = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));

export interface RecordedRequest {
  readonly url: string;
}

/**
 * A fetch double that answers from the fixture directory, recording every URL.
 * Path shape matches raw.githubusercontent: <base>/index.json,
 * <base>/<collection>/<id>.json.
 */
export const fixtureFetch = (options?: {
  /** URLs that should fail at the network level. */
  readonly failing?: readonly string[];
  /** URLs that should answer 404. */
  readonly missing?: readonly string[];
  /** Override the body for a URL (tests of envelope unwrapping / bad JSON). */
  readonly bodies?: Record<string, string>;
}) => {
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    if (options?.failing?.some((pattern) => url.includes(pattern))) {
      throw new Error("connection refused");
    }
    if (options?.missing?.some((pattern) => url.includes(pattern))) {
      return new Response("not found", { status: 404 });
    }
    const body = options?.bodies?.[url];
    if (body !== undefined) {
      return new Response(body, { status: 200 });
    }
    const relative = url.split("/registry/")[1] ?? "";
    const normalized = relative.endsWith(".json") ? relative : `${relative}.json`;
    const path = normalized;
    const flattened = normalized.includes("/")
      ? normalized.split("/").join("--")
      : normalized;
    try {
      return new Response(readFileSync(join(fixturesDir, flattened), "utf8"), { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
};

import { Cause, Effect } from "effect";

/**
 * Run an effect to a plain result. Bun tests and Effect's async boundary both
 * prefer this shape; the typed failure is recovered through the Cause API.
 */
export const runEffect = async <A, E>(
  effect: Effect.Effect<A, E>,
): Promise<{ ok: true; value: A } | { ok: false; error: E | undefined }> => {
  const exit = await Effect.runPromiseExit(effect);
  if (exit._tag === "Success") return { ok: true, value: exit.value };
  const failure = Cause.findErrorOption(exit.cause);
  return { ok: false, error: failure._tag === "Some" ? failure.value : undefined };
};
