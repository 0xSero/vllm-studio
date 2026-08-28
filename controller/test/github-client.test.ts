import { describe, expect, test } from "bun:test";
import type { Effect } from "effect";
import { GitHubError, makeGitHubClient } from "../src/modules/registry/github";
import { runEffect } from "./fixtures";

type Recorded = { method: string; path: string; body: string };

const clientWith = (
  responder: (call: Recorded) => Response,
): ReturnType<typeof makeGitHubClient> => {
  const calls: Recorded[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Recorded = {
      method: init?.method ?? "GET",
      path: String(input).replace("https://api.github.com", ""),
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    return Promise.resolve(responder(call));
  };
  const client = makeGitHubClient({ token: "test-token", fetch: fetch as unknown as typeof globalThis.fetch });
  return Object.assign(client, { calls });
};

describe("github client", () => {
  test("createPull resolves the existing PR when GitHub rejects a duplicate", async () => {
    let seenDuplicate = false;
    const client = clientWith((call) => {
      if (call.method === "POST" && call.path === "/repos/0xSero/local-ai-registry/pulls") {
        seenDuplicate = true;
        return ok(
          { message: "A pull request already exists for gildrb:share/demo." },
          422,
        );
      }
      if (call.method === "GET" && call.path.startsWith("/repos/0xSero/local-ai-registry/pulls?head=gildrb%3A")) {
        return ok([
          { number: 6, html_url: "https://github.com/0xSero/local-ai-registry/pull/6" },
        ]);
      }
      return ok({}, 404);
    });
    const result = await runEffect(
      client.createPull({
        owner: "0xSero",
        repo: "local-ai-registry",
        title: "demo",
        head: "gildrb:share/demo",
        base: "main",
        body: "demo",
      }) as Effect.Effect<{ number: number; html_url: string }, GitHubError>,
    );
    expect(seenDuplicate).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.number).toBe(6);
    expect(result.value.html_url).toContain("/pull/6");
  });

  test("putFile retries with the existing file sha after a conflict", async () => {
    let committedWithSha = false;
    let sawSha = false;
    const client = clientWith((call) => {
      if (call.method === "PUT" && call.path.endsWith("recipe/demo.json")) {
        if (call.body.includes('"sha"')) {
          committedWithSha = true;
          return ok({});
        }
        return ok({ message: "sha wasn't supplied" }, 422);
      }
      if (call.method === "GET" && call.path.startsWith("/repos/o/r/contents/recipe/demo.json")) {
        sawSha = true;
        return ok({ sha: "filesha" });
      }
      return ok({}, 404);
    });
    const result = await runEffect(
      client.putFile({
        owner: "o",
        repo: "r",
        branch: "demo",
        path: "recipe/demo.json",
        content: "{}",
        message: "m",
      }) as Effect.Effect<void, GitHubError>,
    );
    expect(result.ok).toBe(true);
    expect(sawSha).toBe(true);
    expect(committedWithSha).toBe(true);
  });

  test("missing credentials fail with a typed error before any request", async () => {
    const client = makeGitHubClient({
      token: null,
      fetch: ((): Promise<Response> => Promise.resolve(ok({}))) as unknown as typeof globalThis.fetch,
    });
    const result = await runEffect(client.getRepo("0xSero", "local-ai-registry"));
    expect(!result.ok).toBe(true);
    if (result.ok || result.error === undefined) return;
    expect(result.error).toBeInstanceOf(GitHubError);
    expect((result.error as GitHubError).message).toContain("No GitHub credentials");
  });
});

const ok = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
