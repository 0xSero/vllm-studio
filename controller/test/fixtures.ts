import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Directory holding the trimmed copies of real published registry records. */
export const fixturesDirectory = join(import.meta.dir, "fixtures", "registry");

export const fixtureJson = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDirectory, name), "utf8"));

export interface RecordedRequest {
  readonly url: string;
}

/**
 * A fetch double that answers from the fixture directory, recording every URL.
 * Path shape matches raw.githubusercontent: <base>/index.json,
 * <base>/<collection>/<id>.json.
 */
interface FixtureFetchOptions {
  /** URLs that should fail at the network level. */
  readonly failing?: readonly string[];
  /** URLs that should answer 404. */
  readonly missing?: readonly string[];
  /** Override the body for a URL (tests of envelope unwrapping / bad JSON). */
  readonly bodies?: Record<string, string>;
}

interface RecordedFetch {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: string[];
}

export const fixtureFetch = (options?: FixtureFetchOptions): RecordedFetch => {
  const requests: string[] = [];
  const load = async (input: string): Promise<Response> => {
    const url = input;
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
    const flattened = normalized.split("/").join("--");
    try {
      return new Response(readFileSync(join(fixturesDirectory, flattened), "utf8"), { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  };
  const fetch = (input: string | URL | Request): Promise<Response> => load(String(input));
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
