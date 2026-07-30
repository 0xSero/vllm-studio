import { Effect, Schema } from "effect";
import {
  FastCrwSearchInputSchema,
  FastCrwScrapeInputSchema,
  FastCrwMapInputSchema,
  FastCrwCrawlInputSchema,
  FastCrwCrawlStatusInputSchema,
  FastCrwExtractInputSchema,
  FastCrwExtractStatusInputSchema,
  type FastCrwSearchInput,
  type FastCrwScrapeInput,
  type FastCrwMapInput,
  type FastCrwCrawlInput,
  type FastCrwCrawlStatusInput,
  type FastCrwExtractInput,
  type FastCrwExtractStatusInput,
  type OnboardingProfile,
} from "./agent-onboarding-contract";
import { AgentOnboardingError } from "./agent-onboarding-error";

type Dependencies = {
  loadProfile: () => Promise<OnboardingProfile>;
  credentialHeaders: (ref: string) => Promise<HeadersInit>;
  validateUrl: (raw: string) => URL;
};

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new AgentOnboardingError(502, "Upstream response is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new AgentOnboardingError(502, "Upstream returned invalid JSON");
  }
}

export function runtimeUrl(baseUrl: string, relativePath: string): URL {
  const base = new URL(baseUrl);
  const normalizedBasePath = base.pathname.replace(/\/+$/, "");
  const apiPath = normalizedBasePath.endsWith("/v1")
    ? normalizedBasePath
    : `${normalizedBasePath}/v1`;
  base.pathname = `${apiPath}${relativePath}`;
  base.search = "";
  base.hash = "";
  return base;
}

export function searchFastCrwHttp(
  input: FastCrwSearchInput,
  dependencies: Dependencies,
): Effect.Effect<unknown, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const parsed = Schema.decodeUnknownSync(FastCrwSearchInputSchema)(input);
      if (!parsed.query.trim() || parsed.query.length > 2000) {
        throw new AgentOnboardingError(400, "Search query must be 1 to 2000 characters");
      }
      if (parsed.limit !== undefined && !Number.isFinite(parsed.limit)) {
        throw new AgentOnboardingError(400, "Search limit must be finite");
      }
      const profile = await dependencies.loadProfile();
      if (!profile.search.enabled) throw new AgentOnboardingError(503, "FastCRW search is disabled");
      const limit = Math.min(20, Math.max(1, Math.trunc(parsed.limit ?? 5)));
      const url = new URL("/v1/search", profile.search.baseUrl);
      dependencies.validateUrl(url.toString());
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await dependencies.credentialHeaders(profile.search.credentialRef)),
        },
        body: JSON.stringify({
          query: parsed.query,
          limit,
          ...(parsed.lang ? { lang: parsed.lang } : {}),
          ...(parsed.recency ? { tbs: parsed.recency } : {}),
          ...(parsed.categories?.length ? { categories: parsed.categories.slice(0, 5) } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AgentOnboardingError(response.status, "FastCRW search failed");
      }
      return await readBoundedJson(response, 4 * 1024 * 1024);
    },
    catch: (error) =>
      error instanceof AgentOnboardingError
        ? error
        : new AgentOnboardingError(502, "FastCRW search failed"),
  });
}

const FASTCRW_MAX_PAGES = 1000;
const FASTCRW_MAX_EXTRACT_URLS = 100;
const FASTCRW_RESPONSE_LIMIT = 8 * 1024 * 1024;

async function fastCrwRequest(
  method: string,
  path: string,
  body: unknown,
  dependencies: Dependencies,
  timeoutMs = 30_000,
): Promise<unknown> {
  const profile = await dependencies.loadProfile();
  if (!profile.search.enabled) throw new AgentOnboardingError(503, "FastCRW is disabled");
  const url = new URL(path, profile.search.baseUrl);
  dependencies.validateUrl(url.toString());
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(await dependencies.credentialHeaders(profile.search.credentialRef)),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new AgentOnboardingError(response.status, `FastCRW ${path} failed`);
  }
  return readBoundedJson(response, FASTCRW_RESPONSE_LIMIT);
}

export function scrapeFastCrwHttp(
  input: FastCrwScrapeInput,
  dependencies: Dependencies,
): Effect.Effect<unknown, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const parsed = Schema.decodeUnknownSync(FastCrwScrapeInputSchema)(input);
      if (!parsed.url.trim()) throw new AgentOnboardingError(400, "URL is required");
      return fastCrwRequest("POST", "/v1/scrape", {
        url: parsed.url,
        formats: parsed.formats ?? ["markdown"],
        ...(parsed.onlyMainContent !== undefined ? { onlyMainContent: parsed.onlyMainContent } : {}),
        ...(parsed.renderJs !== undefined ? { renderJs: parsed.renderJs } : {}),
        ...(parsed.timeout !== undefined ? { waitFor: parsed.timeout } : {}),
      }, dependencies);
    },
    catch: (error) =>
      error instanceof AgentOnboardingError ? error : new AgentOnboardingError(502, "FastCRW scrape failed"),
  });
}

export function mapFastCrwHttp(
  input: FastCrwMapInput,
  dependencies: Dependencies,
): Effect.Effect<unknown, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const parsed = Schema.decodeUnknownSync(FastCrwMapInputSchema)(input);
      if (!parsed.url.trim()) throw new AgentOnboardingError(400, "URL is required");
      return fastCrwRequest("POST", "/v1/map", {
        url: parsed.url,
        ...(parsed.maxDepth !== undefined ? { maxDepth: parsed.maxDepth } : {}),
        ...(parsed.useSitemap !== undefined ? { useSitemap: parsed.useSitemap } : {}),
        ...(parsed.timeout !== undefined ? { timeout: parsed.timeout } : {}),
      }, dependencies);
    },
    catch: (error) =>
      error instanceof AgentOnboardingError ? error : new AgentOnboardingError(502, "FastCRW map failed"),
  });
}

export function crawlFastCrwHttp(
  input: FastCrwCrawlInput,
  dependencies: Dependencies,
): Effect.Effect<unknown, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const parsed = Schema.decodeUnknownSync(FastCrwCrawlInputSchema)(input);
      if (!parsed.url.trim()) throw new AgentOnboardingError(400, "URL is required");
      const maxPages = Math.min(FASTCRW_MAX_PAGES, Math.max(1, Math.trunc(parsed.maxPages ?? 100)));
      return fastCrwRequest("POST", "/v1/crawl", {
        url: parsed.url,
        maxPages,
        ...(parsed.maxDepth !== undefined ? { maxDepth: parsed.maxDepth } : {}),
        ...(parsed.formats ? { formats: parsed.formats } : {}),
        ...(parsed.onlyMainContent !== undefined ? { onlyMainContent: parsed.onlyMainContent } : {}),
      }, dependencies);
    },
    catch: (error) =>
      error instanceof AgentOnboardingError ? error : new AgentOnboardingError(502, "FastCRW crawl failed"),
  });
}

export function crawlStatusFastCrwHttp(
  input: FastCrwCrawlStatusInput,
  dependencies: Dependencies,
): Effect.Effect<unknown, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const parsed = Schema.decodeUnknownSync(FastCrwCrawlStatusInputSchema)(input);
      if (!parsed.id.trim()) throw new AgentOnboardingError(400, "Crawl id is required");
      return fastCrwRequest("GET", `/v1/crawl/${encodeURIComponent(parsed.id)}`, undefined, dependencies);
    },
    catch: (error) =>
      error instanceof AgentOnboardingError ? error : new AgentOnboardingError(502, "FastCRW crawl status failed"),
  });
}

export function extractFastCrwHttp(
  input: FastCrwExtractInput,
  dependencies: Dependencies,
): Effect.Effect<unknown, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const parsed = Schema.decodeUnknownSync(FastCrwExtractInputSchema)(input);
      if (parsed.urls.length === 0) throw new AgentOnboardingError(400, "At least one URL is required");
      if (parsed.urls.length > FASTCRW_MAX_EXTRACT_URLS) {
        throw new AgentOnboardingError(400, `Extract accepts at most ${FASTCRW_MAX_EXTRACT_URLS} URLs`);
      }
      if (!parsed.prompt && !parsed.schema) {
        throw new AgentOnboardingError(400, "Extract requires a prompt or a schema");
      }
      return fastCrwRequest("POST", "/v1/extract", {
        urls: parsed.urls,
        ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
        ...(parsed.schema ? { schema: parsed.schema } : {}),
      }, dependencies, 60_000);
    },
    catch: (error) =>
      error instanceof AgentOnboardingError ? error : new AgentOnboardingError(502, "FastCRW extract failed"),
  });
}

export function extractStatusFastCrwHttp(
  input: FastCrwExtractStatusInput,
  dependencies: Dependencies,
): Effect.Effect<unknown, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const parsed = Schema.decodeUnknownSync(FastCrwExtractStatusInputSchema)(input);
      if (!parsed.id.trim()) throw new AgentOnboardingError(400, "Extract id is required");
      return fastCrwRequest("GET", `/v1/extract/${encodeURIComponent(parsed.id)}`, undefined, dependencies);
    },
    catch: (error) =>
      error instanceof AgentOnboardingError ? error : new AgentOnboardingError(502, "FastCRW extract status failed"),
  });
}

export function proxyInferenceHttp(
  request: Request,
  pathSegments: string[],
  dependencies: Dependencies,
): Effect.Effect<Response, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const normalizedSegments = pathSegments[0] === "v1" ? pathSegments.slice(1) : pathSegments;
      const relativePath = `/${normalizedSegments.join("/")}`;
      if (!["/models", "/chat/completions", "/responses", "/embeddings"].includes(relativePath)) {
        throw new AgentOnboardingError(404, "Inference path is not allowed");
      }
      if (!["GET", "POST", "HEAD"].includes(request.method)) {
        throw new AgentOnboardingError(405, "Inference method is not allowed");
      }
      const profile = await dependencies.loadProfile();
      const target = runtimeUrl(profile.runtime.baseUrl, relativePath);
      dependencies.validateUrl(target.toString());
      const headers = new Headers({ "Content-Type": "application/json" });
      const auth = await dependencies.credentialHeaders(profile.runtime.credentialRef);
      new Headers(auth).forEach((value, key) => headers.set(key, value));
      const body =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer();
      if (body && body.byteLength > 4 * 1024 * 1024) {
        throw new AgentOnboardingError(413, "Inference request is too large");
      }
      const response = await fetch(target, {
        method: request.method,
        headers,
        body,
        signal: request.signal,
      });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete("content-length");
      responseHeaders.delete("content-encoding");
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    },
    catch: (error) =>
      error instanceof AgentOnboardingError
        ? error
        : new AgentOnboardingError(502, "Inference proxy failed"),
  });
}
