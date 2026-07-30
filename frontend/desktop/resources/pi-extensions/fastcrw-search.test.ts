import { afterEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerFastCrwSearch from "./fastcrw-search";

type RegisteredTool = {
  execute: (
    id: string,
    params: {
      query: string;
      limit?: number;
      lang?: string;
      recency?: string;
      categories?: string[];
    },
    signal?: AbortSignal,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function registeredTool(): RegisteredTool {
  let tool: RegisteredTool | undefined;
  registerFastCrwSearch({
    registerTool: (candidate: RegisteredTool) => {
      tool = candidate;
    },
  } as unknown as ExtensionAPI);
  if (!tool) throw new Error("FastCRW tool was not registered");
  return tool;
}

describe("FastCRW native search extension", () => {
  test("forwards recency using the shared onboarding request field", async () => {
    let requestBody: unknown;
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    globalThis.fetch = ((input, init) => {
      requestUrl = String(input);
      requestInit = init;
      requestBody = JSON.parse(String(init?.body));
      return Promise.resolve(
        Response.json({
          success: true,
          data: [{ title: "Source", url: "https://example.test", snippet: "Evidence" }],
        }),
      );
    }) as typeof fetch;

    const result = await registeredTool().execute("call-1", {
      query: "current platform status",
      recency: "qdr:d",
      limit: 3,
      lang: "en",
      categories: ["science", "security"],
    });

    expect(requestUrl).toBe("http://127.0.0.1:3000/api/agent/onboarding/search");
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers).get("content-type")).toBe("application/json");
    expect(requestBody).toEqual({
      query: "current platform status",
      limit: 3,
      recency: "qdr:d",
      lang: "en",
      categories: ["science", "security"],
    });
    expect(result.details["count"]).toBe(1);
  });

  test("returns a bounded failure object when the proxy rejects the request", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(Response.json({ error: "Unauthorized" }, { status: 401 }))) as typeof fetch;

    const result = await registeredTool().execute("call-2", { query: "source" });

    expect(result.details).toEqual({ failed: true, status: 401 });
    expect(result.content[0]?.text).toBe("crw_search failed: HTTP 401");
  });
});
