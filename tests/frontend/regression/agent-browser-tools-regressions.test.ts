import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBrowserInput } from "@/features/agent/tools/browser-url";
import {
  shouldLoadBrowserUrl,
  shouldSyncBrowserLocation,
} from "@/features/agent/ui/agent-browser-effects";

declare global {
  var __LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST:
    ((hostname: string) => Promise<(string | { address: string; family: 4 | 6 })[]>) | undefined;
  var __LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST:
    | ((
        url: string,
        address: { address: string; family: 4 | 6 },
      ) => Promise<{
        status: number;
        ok: boolean;
        url: string;
        contentType: string;
        body: string;
        location?: string;
      }>)
    | undefined;
}

// The webview command surface (runBrowserPanelCommand) was removed with the
// move to the server-side CDP browser; private-URL guarding is covered by the
// reader fetch route test below.

test("free-text browser searches avoid Google webview refresh loops", () => {
  assert.equal(
    normalizeBrowserInput("latest vllm docs", "/workspace/project"),
    "https://duckduckgo.com/?q=latest%20vllm%20docs",
  );
});

test("webview location updates do not reload the page that reported them", () => {
  assert.equal(
    shouldLoadBrowserUrl(
      "https://www.google.com/search?q=vllm",
      "https://www.google.com/search?q=vllm",
      "https://www.google.com/search?q=vllm",
    ),
    false,
  );
  assert.equal(
    shouldLoadBrowserUrl(
      "https://example.com/next",
      "https://www.google.com/search?q=vllm",
      "https://www.google.com/search?q=vllm",
    ),
    true,
  );
  assert.equal(
    shouldSyncBrowserLocation("https://www.google.com/search?q=vllm", "about:blank", "about:blank"),
    false,
  );
  assert.equal(
    shouldSyncBrowserLocation(
      "https://www.google.com/search?q=vllm",
      "about:blank",
      "https://www.google.com/search?q=vllm",
    ),
    true,
  );
});

test("desktop browser reader fetch renders public markdown and rejects private urls", async () => {
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  let requestCount = 0;
  const connectedAddresses: string[] = [];
  process.env.LOCAL_STUDIO_DATA_DIR = "/tmp/local-studio-desktop-test";
  globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST = async (hostname) =>
    hostname === "private-dns.test"
      ? ["127.0.0.1"]
      : hostname === "mapped-private.test"
        ? ["::ffff:127.0.0.1"]
        : ["93.184.216.34"];
  globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST = async (url, address) => {
    requestCount += 1;
    connectedAddresses.push(address.address);
    if (url.includes("redirect.test")) {
      return {
        status: 302,
        ok: false,
        url,
        contentType: "",
        body: "",
        location: "http://localhost:3000/private",
      };
    }
    if (url.includes("html.test")) {
      return {
        status: 200,
        ok: true,
        url,
        contentType: "text/html; charset=utf-8",
        body: "<html><head><title>HTML Works</title><script>bad()</script></head><body><h1>Hello</h1><p>World</p></body></html>",
      };
    }
    return {
      status: 200,
      ok: true,
      url,
      contentType: "text/markdown; charset=utf-8",
      body: "# Reader Works\n\n[Docs](/docs)\n",
    };
  };
  try {
    const { GET } = await import("@/app/api/agent/browser/fetch/route");
    const response = await GET(
      new Request(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fexample.com%2F",
      ) as never,
    );
    const body = (await response.json()) as {
      markdown?: string;
      title?: string;
    };
    assert.equal(response.status, 200);
    assert.equal(body.title, "Reader Works");
    assert.match(body.markdown ?? "", /Reader Works/);

    const htmlResponse = await GET(
      new Request(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fhtml.test%2F",
      ) as never,
    );
    const htmlBody = (await htmlResponse.json()) as {
      text?: string;
      title?: string;
    };
    assert.equal(htmlResponse.status, 200);
    assert.equal(htmlBody.title, "HTML Works");
    assert.match(htmlBody.text ?? "", /Hello/);
    assert.doesNotMatch(htmlBody.text ?? "", /bad\(\)/);

    const rejected = await GET(
      new Request(
        "http://localhost/api/agent/browser/fetch?url=http%3A%2F%2Flocalhost%3A3000%2F",
      ) as never,
    );
    const rejectedBody = (await rejected.json()) as { error?: string };
    assert.equal(rejected.status, 400);
    assert.match(rejectedBody.error ?? "", /public http\/https/);

    const redirectRejected = await GET(
      new Request(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fredirect.test%2F",
      ) as never,
    );
    const redirectBody = (await redirectRejected.json()) as { error?: string };
    assert.equal(redirectRejected.status, 502);
    assert.match(redirectBody.error ?? "", /Redirect rejected/);

    const dnsRejected = await GET(
      new Request(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fprivate-dns.test%2F",
      ) as never,
    );
    const dnsBody = (await dnsRejected.json()) as { error?: string };
    assert.equal(dnsRejected.status, 502);
    assert.match(dnsBody.error ?? "", /Resolved host rejected/);

    const mappedDnsRejected = await GET(
      new Request(
        "http://localhost/api/agent/browser/fetch?url=https%3A%2F%2Fmapped-private.test%2F",
      ) as never,
    );
    const mappedDnsBody = (await mappedDnsRejected.json()) as {
      error?: string;
    };
    assert.equal(mappedDnsRejected.status, 502);
    assert.match(mappedDnsBody.error ?? "", /Resolved host rejected/);
    assert.equal(requestCount, 3);
    assert.deepEqual(connectedAddresses, ["93.184.216.34", "93.184.216.34", "93.184.216.34"]);
  } finally {
    delete globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST;
    delete globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST;
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  }
});
