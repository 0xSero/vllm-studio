import { lookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { Effect } from "effect";
import {
  createBrowserNetworkPolicy,
  type BrowserAddress,
  type BrowserNetworkMode,
} from "./network-policy";
import { readableHtml } from "./readable-html";

const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

export type ReaderResult = {
  url: string;
  title: string;
  text: string;
  markdown?: string;
  contentType: string;
};

type ResolvedHostAddress = BrowserAddress;
type ResolvedHostInput = string | ResolvedHostAddress;
type ReaderHostResolver = (hostname: string) => Promise<ResolvedHostInput[]>;

type BoundedResponse = {
  status: number;
  ok: boolean;
  url: string;
  contentType: string;
  body: string;
  location?: string;
};

declare global {
  var __LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST: ReaderHostResolver | undefined;
  var __LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST:
    ((url: string, address: ResolvedHostAddress) => Promise<BoundedResponse>) | undefined;
}

const abortError = (signal: AbortSignal): Error =>
  new Error("Browser fetch aborted", { cause: signal.reason });

const assertNotAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError(signal);
};

const awaitWithSignal = <A>(promise: Promise<A>, signal?: AbortSignal): Promise<A> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return Effect.runPromise(
    Effect.tryPromise({
      try: () => promise,
      catch: (error) => (signal.aborted ? abortError(signal) : error),
    }),
    { signal },
  ).catch((error: unknown) => {
    if (signal.aborted) throw abortError(signal);
    throw error;
  });
};

async function resolveReaderHost(
  hostname: string,
  signal?: AbortSignal,
): Promise<ResolvedHostAddress[]> {
  assertNotAborted(signal);
  const testResolver = globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST;
  if (testResolver) {
    const inputs = await awaitWithSignal(testResolver(hostname), signal);
    assertNotAborted(signal);
    return inputs.map(normalizeResolvedAddress);
  }
  const results = await awaitWithSignal(lookup(hostname, { all: true, verbatim: true }), signal);
  assertNotAborted(signal);
  return results.map((result) => ({
    address: result.address,
    family: result.family === 6 ? 6 : 4,
  }));
}

const readerNavigationPolicy = createBrowserNetworkPolicy(resolveReaderHost);

function isMarkdownResponse(url: string, contentType: string): boolean {
  return /\b(markdown|mdx?)\b/i.test(contentType) || /\.(md|mdx|markdown)(?:[?#].*)?$/i.test(url);
}

function markdownTitle(markdown: string, fallback: string): string {
  const heading = markdown.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

async function fetchBoundedUrl(
  url: string,
  mode: BrowserNetworkMode,
  redirects = 0,
  signal?: AbortSignal,
): Promise<BoundedResponse> {
  const addresses = await resolvedAddresses(url, mode, signal);
  const response = await requestBoundedUrl(url, addresses[0], signal);
  assertNotAborted(signal);
  if (isRedirectStatus(response.status)) {
    if (redirects >= MAX_REDIRECTS) throw new Error("Too many redirects");
    if (!response.location) throw new Error("Redirect missing Location header");
    const nextUrl = new URL(response.location, url).toString();
    const safeRedirect = acceptedReaderUrl(nextUrl, mode);
    if (!safeRedirect) throw new Error("Redirect rejected by browser network policy");
    return fetchBoundedUrl(safeRedirect, mode, redirects + 1, signal);
  }
  return response;
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

async function resolvedAddresses(
  raw: string,
  mode: BrowserNetworkMode,
  signal?: AbortSignal,
): Promise<ResolvedHostAddress[]> {
  const readerNetworkPolicy = createBrowserNetworkPolicy((hostname) =>
    resolveReaderHost(hostname, signal),
  );
  const destination = await awaitWithSignal(readerNetworkPolicy.resolve(raw, mode), signal);
  return [destination.address];
}

function acceptedReaderUrl(raw: string, mode: BrowserNetworkMode): string | null {
  const navigation = readerNavigationPolicy.navigation(raw);
  return navigation && (mode === "loopback" || navigation.mode === "public")
    ? navigation.url
    : null;
}

function normalizeResolvedAddress(input: ResolvedHostInput): ResolvedHostAddress {
  if (typeof input !== "string") return input;
  return { address: input, family: input.includes(":") ? 6 : 4 };
}

function requestBoundedUrl(
  url: string,
  address: ResolvedHostAddress,
  signal?: AbortSignal,
): Promise<BoundedResponse> {
  const testRequest = globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST;
  if (testRequest) return awaitWithSignal(testRequest(url, address), signal);
  const parsed = new URL(url);
  const request = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    headers: { Accept: ACCEPT, "User-Agent": USER_AGENT },
    signal,
    lookup: ((
      _hostname: string,
      lookupOptions: unknown,
      callback: (...args: unknown[]) => void,
    ) => {
      const wantsAll = Boolean((lookupOptions as { all?: boolean } | undefined)?.all);
      if (wantsAll) callback(null, [address]);
      else callback(null, address.address, address.family);
    }) as RequestOptions["lookup"],
  };

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const req = request(parsed, options, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = headerString(response.headers["content-type"]);
      const location = headerString(response.headers.location);
      response.on("data", (raw: Buffer | string) => {
        const chunk = typeof raw === "string" ? Buffer.from(raw) : raw;
        if (total >= MAX_BYTES) return;
        const available = MAX_BYTES - total;
        const stored = chunk.length > available ? chunk.subarray(0, available) : chunk;
        chunks.push(stored);
        total += stored.length;
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        const body = new TextDecoder("utf-8", { fatal: false }).decode(concatBytes(chunks, total));
        resolve({
          status,
          ok: status >= 200 && status < 300,
          url,
          contentType,
          body,
          ...(location ? { location } : {}),
        });
      });
      response.on("error", fail);
    });
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error("Fetch timed out")));
    req.on("error", fail);
    req.end();
  });
}

function headerString(value: string | string[] | number | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1 && chunks[0]?.length === total) return chunks[0];
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function renderReadable(response: BoundedResponse, fallbackUrl: string): ReaderResult {
  const contentType = response.contentType;
  const finalUrl = response.url || fallbackUrl;
  if (contentType.startsWith("text/html") || contentType.includes("xhtml")) {
    const { title, text } = readableHtml(response.body, finalUrl);
    return { url: finalUrl, title, text, markdown: text, contentType };
  }
  if (contentType.startsWith("text/") || contentType.includes("application/json")) {
    const text = response.body.slice(0, MAX_BYTES);
    if (isMarkdownResponse(finalUrl, contentType)) {
      const markdown = text.trim();
      return {
        url: finalUrl,
        title: markdownTitle(markdown, finalUrl),
        text: markdown,
        markdown,
        contentType,
      };
    }
    return { url: finalUrl, title: finalUrl, text, contentType };
  }
  return {
    url: finalUrl,
    title: finalUrl,
    text: `Non-text response (${contentType || "unknown"}); not rendered.`,
    contentType,
  };
}

export async function fetchReadable(
  rawUrl: string,
  mode: BrowserNetworkMode = "public",
  signal?: AbortSignal,
): Promise<ReaderResult> {
  assertNotAborted(signal);
  const safe = acceptedReaderUrl(rawUrl, mode);
  if (!safe) throw new Error("url rejected by browser network policy");
  const response = await fetchBoundedUrl(safe, mode, 0, signal);
  assertNotAborted(signal);
  if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
  return renderReadable(response, safe);
}
