import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  AgentOnboardingError,
  defaultOnboardingProfile,
  proxyOnboardingInference,
  saveOnboarding,
  searchFastCrw,
} from "../src/agent-onboarding-service";
import type { OAuthVault } from "../src/oauth-vault";

let dataDir = "";
let secrets: Map<string, string>;
const originalFetch = globalThis.fetch;
const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;

const vault: OAuthVault = {
  read: (key) => Effect.succeed(secrets.get(key)),
  write: (key, value) =>
    Effect.sync(() => {
      secrets.set(key, value);
    }),
  remove: (key) =>
    Effect.sync(() => {
      secrets.delete(key);
    }),
};

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "agent-onboarding-proxy-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  await writeFile(path.join(dataDir, "api-settings.json"), "{}");
  secrets = new Map();
  await Effect.runPromise(saveOnboarding({ profile: defaultOnboardingProfile() }, vault));
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

describe("onboarding inference proxy", () => {
  test("rejects paths and methods outside the OpenAI-compatible boundary", async () => {
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(Response.json({}));
    }) as typeof fetch;

    const pathError = await Effect.runPromise(
      proxyOnboardingInference(new Request("http://local/unsafe"), ["files"], vault).pipe(
        Effect.flip,
      ),
    );
    const methodError = await Effect.runPromise(
      proxyOnboardingInference(
        new Request("http://local/models", { method: "DELETE" }),
        ["v1", "models"],
        vault,
      ).pipe(Effect.flip),
    );

    expect(pathError).toBeInstanceOf(AgentOnboardingError);
    expect(pathError.status).toBe(404);
    expect(methodError).toBeInstanceOf(AgentOnboardingError);
    expect(methodError.status).toBe(405);
    expect(calls).toBe(0);
  });

  test("forwards SSE without buffering and normalizes a v1 runtime base", async () => {
    let target = "";
    let finishStream: (() => void) | undefined;
    globalThis.fetch = ((input) => {
      target = String(input);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"id":"one"}\n\n'));
          finishStream = () => {
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          };
        },
      });
      return Promise.resolve(
        new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Content-Encoding": "gzip" },
        }),
      );
    }) as typeof fetch;

    const proxyResult = Effect.runPromise(
      proxyOnboardingInference(
        new Request("http://local/chat", {
          method: "POST",
          body: JSON.stringify({ model: "qwen", messages: [], stream: true }),
        }),
        ["v1", "chat", "completions"],
        vault,
      ),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      proxyResult,
      new Promise<never>((_, reject) =>
        void (timeout = setTimeout(
          () => reject(new Error("Inference proxy buffered the SSE response")),
          500,
        )),
      ),
    ]);
    clearTimeout(timeout);

    expect(target).toBe("http://127.0.0.1:18181/v1/chat/completions");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.has("content-encoding")).toBe(false);
    finishStream?.();
    expect(await response.text()).toBe('data: {"id":"one"}\n\ndata: [DONE]\n\n');
  });
});

describe("onboarding FastCRW proxy", () => {
  test("bounds limit and category fanout before calling the configured service", async () => {
    let requestBody: unknown;
    globalThis.fetch = ((_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Promise.resolve(Response.json({ success: true, data: [] }));
    }) as typeof fetch;

    await Effect.runPromise(
      searchFastCrw(
        {
          query: "bounded",
          limit: 10_000,
          categories: ["a", "b", "c", "d", "e", "f", "g"],
        },
        vault,
      ),
    );

    expect(requestBody).toEqual({
      query: "bounded",
      limit: 20,
      categories: ["a", "b", "c", "d", "e"],
    });
  });

  test("rejects an upstream JSON response beyond four MiB", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: "x".repeat(4 * 1024 * 1024) }), {
          headers: { "Content-Type": "application/json" },
        }),
      )) as typeof fetch;

    const error = await Effect.runPromise(
      searchFastCrw({ query: "bounded response" }, vault).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(AgentOnboardingError);
    expect(error.status).toBe(502);
    expect(error.message).toBe("Upstream response is too large");
  });
});
