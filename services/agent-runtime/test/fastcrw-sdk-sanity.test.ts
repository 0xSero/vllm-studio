import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { OAuthVault } from "../src/oauth-vault";
import { AgentOnboardingError } from "../src/agent-onboarding-service";
import {
  crawlFastCrw,
  crawlStatusFastCrw,
  extractFastCrw,
  extractStatusFastCrw,
  mapFastCrw,
  scrapeFastCrw,
  searchFastCrw,
} from "../src/agent-onboarding-service";
import { defaultOnboardingProfile, saveOnboarding } from "../src/agent-onboarding-service";

let dataDir = "";
let secrets: Map<string, string>;

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
  dataDir = await mkdtemp(path.join(tmpdir(), "fastcrw-sdk-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  await writeFile(path.join(dataDir, "api-settings.json"), "{}");
  secrets = new Map();
});

afterEach(async () => {
  delete process.env.LOCAL_STUDIO_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

type CapturedRequest = { url: string; method: string; body: string; headers: Headers };

function captureFetch(responses: Record<string, unknown>): {
  requests: CapturedRequest[];
  restore: () => void;
} {
  const requests: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? String(init.body) : "";
    const headers = new Headers(init?.headers);
    requests.push({ url, method: init?.method ?? "GET", body, headers });
    const key = url.replace(/^[^/]+:\/\/[^/]+/, "");
    const payload = responses[key] ?? { success: true, data: {} };
    return Promise.resolve(Response.json(payload));
  }) as typeof fetch;
  return { requests, restore: () => { globalThis.fetch = original; } };
}

describe("FastCRW SDK sanity", () => {
  test("scrape sends POST /v1/scrape with url and default markdown format", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({ "/v1/scrape": { success: true, data: { markdown: "# Hi" } } });
    try {
      const result = await Effect.runPromise(
        scrapeFastCrw({ url: "https://example.com" }, vault),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe("https://api.fastcrw.com/v1/scrape");
      expect(requests[0].method).toBe("POST");
      const body = JSON.parse(requests[0].body);
      expect(body.url).toBe("https://example.com");
      expect(body.formats).toEqual(["markdown"]);
      expect((result as { success: boolean }).success).toBe(true);
    } finally {
      restore();
    }
  });

  test("scrape forwards optional onlyMainContent and renderJs flags", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({});
    try {
      await Effect.runPromise(
        scrapeFastCrw(
          { url: "https://example.com", onlyMainContent: false, renderJs: true, formats: ["html"] },
          vault,
        ),
      );
      const body = JSON.parse(requests[0].body);
      expect(body.onlyMainContent).toBe(false);
      expect(body.renderJs).toBe(true);
      expect(body.formats).toEqual(["html"]);
    } finally {
      restore();
    }
  });

  test("scrape rejects empty URL before egress", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({});
    try {
      const error = await Effect.runPromise(scrapeFastCrw({ url: "" }, vault).pipe(Effect.flip));
      expect(error).toBeInstanceOf(AgentOnboardingError);
      expect(error.status).toBe(400);
      expect(requests).toHaveLength(0);
    } finally {
      restore();
    }
  });

  test("map sends POST /v1/map with url and optional depth", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({ "/v1/map": { success: true, data: { links: [] } } });
    try {
      await Effect.runPromise(
        mapFastCrw({ url: "https://example.com", maxDepth: 3 }, vault),
      );
      expect(requests[0].url).toBe("https://api.fastcrw.com/v1/map");
      const body = JSON.parse(requests[0].body);
      expect(body.url).toBe("https://example.com");
      expect(body.maxDepth).toBe(3);
    } finally {
      restore();
    }
  });

  test("crawl sends POST /v1/crawl and clamps maxPages to the configured ceiling", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({ "/v1/crawl": { success: true, id: "job-1" } });
    try {
      await Effect.runPromise(
        crawlFastCrw({ url: "https://example.com", maxPages: 99999 }, vault),
      );
      expect(requests[0].url).toBe("https://api.fastcrw.com/v1/crawl");
      const body = JSON.parse(requests[0].body);
      expect(body.maxPages).toBe(1000);
    } finally {
      restore();
    }
  });

  test("crawlStatus sends GET /v1/crawl/{id}", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({ "/v1/crawl/job-42": { success: true, status: "completed" } });
    try {
      const result = await Effect.runPromise(
        crawlStatusFastCrw({ id: "job-42" }, vault),
      );
      expect(requests[0].method).toBe("GET");
      expect(requests[0].url).toBe("https://api.fastcrw.com/v1/crawl/job-42");
      expect((result as { status: string }).status).toBe("completed");
    } finally {
      restore();
    }
  });

  test("extract sends POST /v1/extract with urls and prompt", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({ "/v1/extract": { success: true, id: "ext-1" } });
    try {
      await Effect.runPromise(
        extractFastCrw(
          { urls: ["https://a.com", "https://b.com"], prompt: "Extract product names" },
          vault,
        ),
      );
      expect(requests[0].url).toBe("https://api.fastcrw.com/v1/extract");
      const body = JSON.parse(requests[0].body);
      expect(body.urls).toEqual(["https://a.com", "https://b.com"]);
      expect(body.prompt).toBe("Extract product names");
    } finally {
      restore();
    }
  });

  test("extract rejects when neither prompt nor schema is supplied", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({});
    try {
      const error = await Effect.runPromise(
        extractFastCrw({ urls: ["https://a.com"] }, vault).pipe(Effect.flip),
      );
      expect(error.status).toBe(400);
      expect(requests).toHaveLength(0);
    } finally {
      restore();
    }
  });

  test("extract rejects when the URL list exceeds the cap", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({});
    try {
      const urls = Array.from({ length: 101 }, (_, i) => `https://x${i}.com`);
      const error = await Effect.runPromise(
        extractFastCrw({ urls, prompt: "test" }, vault).pipe(Effect.flip),
      );
      expect(error.status).toBe(400);
      expect(requests).toHaveLength(0);
    } finally {
      restore();
    }
  });

  test("extractStatus sends GET /v1/extract/{id}", async () => {
    secrets.set("vault:search:fastcrw", "token");
    const { requests, restore } = captureFetch({ "/v1/extract/ext-7": { success: true, status: "completed" } });
    try {
      await Effect.runPromise(extractStatusFastCrw({ id: "ext-7" }, vault));
      expect(requests[0].method).toBe("GET");
      expect(requests[0].url).toBe("https://api.fastcrw.com/v1/extract/ext-7");
    } finally {
      restore();
    }
  });

  test("all endpoints fail closed when search is disabled", async () => {
    const profile = defaultOnboardingProfile();
    profile.search.enabled = false;
    await Effect.runPromise(saveOnboarding({ profile }, vault));
    const { requests, restore } = captureFetch({});
    try {
      const targets = [
        () => scrapeFastCrw({ url: "https://example.com" }, vault),
        () => mapFastCrw({ url: "https://example.com" }, vault),
        () => crawlFastCrw({ url: "https://example.com" }, vault),
        () => crawlStatusFastCrw({ id: "x" }, vault),
        () => extractFastCrw({ urls: ["https://a.com"], prompt: "t" }, vault),
        () => extractStatusFastCrw({ id: "x" }, vault),
        () => searchFastCrw({ query: "test" }, vault),
      ];
      for (const target of targets) {
        const error = await Effect.runPromise(target().pipe(Effect.flip));
        expect(error).toBeInstanceOf(AgentOnboardingError);
        expect(error.status).toBe(503);
      }
      expect(requests).toHaveLength(0);
    } finally {
      restore();
    }
  });

  test("all endpoints inject the keyring bearer token", async () => {
    secrets.set("vault:search:fastcrw", "shared-token");
    const { requests, restore } = captureFetch({
      "/v1/scrape": { success: true },
      "/v1/map": { success: true },
      "/v1/crawl": { success: true, id: "1" },
      "/v1/crawl/1": { success: true },
      "/v1/extract": { success: true, id: "2" },
      "/v1/extract/2": { success: true },
      "/v1/search": { success: true, data: [] },
    });
    try {
      await Effect.runPromise(scrapeFastCrw({ url: "https://a.com" }, vault));
      await Effect.runPromise(mapFastCrw({ url: "https://a.com" }, vault));
      await Effect.runPromise(crawlFastCrw({ url: "https://a.com" }, vault));
      await Effect.runPromise(crawlStatusFastCrw({ id: "1" }, vault));
      await Effect.runPromise(extractFastCrw({ urls: ["https://a.com"], prompt: "t" }, vault));
      await Effect.runPromise(extractStatusFastCrw({ id: "2" }, vault));
      await Effect.runPromise(searchFastCrw({ query: "t" }, vault));
      expect(requests).toHaveLength(7);
      for (const { headers } of requests) {
        expect(headers.get("Authorization")).toBe("Bearer shared-token");
      }
    } finally {
      restore();
    }
  });
});
