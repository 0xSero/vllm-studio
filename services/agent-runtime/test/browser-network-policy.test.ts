import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request, type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect } from "effect";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { browserHost } from "../src/browser-host/browser-host";
import { createBrowserNetworkPolicy, type BrowserDestination, type BrowserNetworkPolicy } from "../src/browser-host/network-policy";
import { createBrowserProxy, type BrowserProxy } from "../src/browser-host/pinning-proxy";
import { findBrowserBinary, PlaywrightManager, playwrightManager } from "../src/browser-host/playwright";
import { fetchReadable } from "../src/browser-host/reader";

const publicAddress = { address: "93.184.216.34", family: 4 } as const;
const loopbackAddress = { address: "127.0.0.1", family: 4 } as const;
function through(proxy: BrowserProxy, target: string): Promise<number> {
  const endpoint = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: endpoint.hostname, path: target, port: endpoint.port }, (res) => {
      res.resume(); res.once("end", () => resolve(res.statusCode ?? 0));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}
function rawThrough(proxy: BrowserProxy, message: string): Promise<string> {
  const endpoint = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    let response = "";
    const socket = connect(Number(endpoint.port), endpoint.hostname, () => socket.write(message));
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (response += chunk));
    socket.once("end", () => resolve(response));
    socket.once("error", reject);
  });
}
function rawHeaders(proxy: BrowserProxy, message: string): Promise<string> {
  const endpoint = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    let response = "";
    const socket = connect(Number(endpoint.port), endpoint.hostname, () => socket.write(message));
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(response);
      }
    });
    socket.once("close", () => {
      if (!response.includes("\r\n\r\n")) reject(new Error("proxy closed"));
    });
    socket.once("error", reject);
  });
}
function fakeProxy(mode: string, events: string[]): BrowserProxy {
  return { url: "http://127.0.0.1:1", close: async () => void events.push(`close:${mode}`) };
}
function fakeContext(mode: string, events: string[], route = async (): Promise<void> => undefined) {
  return {
    close: async () => void events.push(`close:${mode}`), once: () => undefined,
    route, routeWebSocket: async () => undefined,
  } as unknown as BrowserContext;
}
function browserPage(): Page {
  let currentUrl = "about:blank";
  let closed = false;
  const page = {
    close: async () => {
      closed = true;
    },
    evaluate: async () => 1,
    goto: async (url: string) => {
      if (closed) throw new Error("page closed");
      currentUrl = url;
    },
    isClosed: () => closed,
    mainFrame: () => page,
    on: () => page,
    title: async () => currentUrl,
    url: () => currentUrl,
  } as unknown as Page;
  return page;
}
function browserContext(page: Page): BrowserContext {
  let closed = false;
  return {
    close: async () => {
      closed = true;
      await page.close();
    },
    newPage: async () => {
      if (closed) throw new Error("context closed");
      return page;
    },
    pages: () => (closed ? [] : [page]),
  } as unknown as BrowserContext;
}
function listen(server: ReturnType<typeof createServer>, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}
function close(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
describe("browser network policy", () => {
  test("rejects non-http(s) reader redirects before making another request", async () => {
    const requests: string[] = [];
    const previousResolver = globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST;
    const previousRequest = globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST;
    globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST = async () => [publicAddress];
    globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST = async (url) => {
      requests.push(url);
      return {
        status: 302,
        ok: false,
        url,
        contentType: "text/plain",
        body: "",
        location: "ws://example.test/socket",
      };
    };
    try {
      await expect(fetchReadable("https://example.test/start")).rejects.toThrow(
        "url rejected by browser network policy",
      );
      expect(requests).toEqual(["https://example.test/start"]);
    } finally {
      globalThis.__LOCAL_STUDIO_BROWSER_READER_HOST_RESOLVER_FOR_TEST = previousResolver;
      globalThis.__LOCAL_STUDIO_BROWSER_READER_REQUEST_FOR_TEST = previousRequest;
    }
  });

  test("classifies navigation and pins only uniformly allowed DNS answers", async () => {
    const policy = createBrowserNetworkPolicy(async () => [publicAddress]);
    expect(policy.navigation("https://example.test/path")?.mode).toBe("public");
    expect(policy.navigation("http://localhost:3000")?.mode).toBe("loopback");
    const destination = await policy.resolve("wss://example.test/socket", "public");
    expect([destination.address, destination.port]).toEqual([publicAddress, 443]);
    for (const answers of [[], [loopbackAddress], [publicAddress, loopbackAddress]]) {
      await expect(createBrowserNetworkPolicy(async () => answers).resolve("https://example.test", "public"))
        .rejects.toThrow("blocked resolved destination");
    }
  });
  test("rejects rebinding before transport and pins allowed loopback requests", async () => {
    let hits = 0;
    let connections = 0;
    let upgrades = 0;
    let host = "";
    const origin = createServer((incoming, response) => {
      hits += 1;
      host = incoming.headers.host ?? "";
      response.end();
    });
    origin.on("connection", () => (connections += 1));
    origin.on("upgrade", (_incoming, socket) => {
      upgrades += 1;
      socket.end(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
    });
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    const port = (origin.address() as AddressInfo).port;
    const policy = createBrowserNetworkPolicy(async () => [loopbackAddress]);
    const rejectedProtocols = new Set<string>();
    const tracedPolicy: BrowserNetworkPolicy = {
      navigation: policy.navigation,
      resolve: (raw, mode) => {
        rejectedProtocols.add(new URL(raw).protocol);
        return policy.resolve(raw, mode);
      },
    };
    const publicProxy = await createBrowserProxy("public", tracedPolicy);
    const target = `http://example.test:${port}/resource`;
    expect(await through(publicProxy, target)).toBe(403);
    const connectResponse = await rawThrough(
      publicProxy,
      `CONNECT example.test:${port} HTTP/1.1\r\nHost: example.test:${port}\r\n\r\n`,
    );
    await rawThrough(
      publicProxy,
      `GET http://example.test:${port}/socket HTTP/1.1\r\nHost: example.test:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    );
    expect(connectResponse.startsWith("HTTP/1.1 403")).toBe(true);
    expect([...rejectedProtocols].sort()).toEqual(["http:", "https:", "ws:"]);
    expect([hits, connections]).toEqual([0, 0]);
    await publicProxy.close();
    const loopbackProxy = await createBrowserProxy("loopback", policy);
    expect(await through(loopbackProxy, target)).toBe(403);
    expect(await through(loopbackProxy, `http://localhost:${port}/resource`)).toBe(200);
    const tunnelResponse = await rawThrough(
      loopbackProxy,
      `CONNECT localhost:${port} HTTP/1.1\r\nHost: localhost:${port}\r\n\r\nGET /tunnel HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`,
    );
    await rawThrough(
      loopbackProxy,
      `GET http://localhost:${port}/socket HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    );
    expect(tunnelResponse.startsWith("HTTP/1.1 200 Connection Established")).toBe(true);
    expect([hits, connections, upgrades, host]).toEqual([2, 3, 1, `localhost:${port}`]);
    await loopbackProxy.close();
    await new Promise<void>((resolve) => origin.close(() => resolve()));
  });

  test("rejects absolute HTTPS proxy requests without opening plaintext transport", async () => {
    let hits = 0;
    const origin = createServer((_request, response) => {
      hits += 1;
      response.end();
    });
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    const port = (origin.address() as AddressInfo).port;
    const policy: BrowserNetworkPolicy = {
      navigation: () => null,
      resolve: async (raw) => ({
        address: loopbackAddress,
        port,
        url: raw,
      }),
    };
    const proxy = await createBrowserProxy("public", policy);
    try {
      const response = await rawHeaders(
        proxy,
        `GET https://example.test:${port}/resource HTTP/1.1\r\nHost: example.test:${port}\r\nConnection: close\r\n\r\n`,
      );
      expect(response.startsWith("HTTP/1.1 403")).toBe(true);
      expect(hits).toBe(0);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => origin.close(() => resolve()));
    }
  });

  test("destroys HTTP client requests created before proxy shutdown", async () => {
    let hits = 0;
    const origin = createServer((_request, response) => {
      hits += 1;
      response.end();
    });
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    const port = (origin.address() as AddressInfo).port;
    const policy: BrowserNetworkPolicy = {
      navigation: () => null,
      resolve: async (raw) => ({
        address: loopbackAddress,
        port,
        url: raw,
      }),
    };
    let proxy: BrowserProxy | undefined;
    const createProxyWithRequestFactory = createBrowserProxy as unknown as (
      mode: "public" | "loopback",
      networkPolicy: BrowserNetworkPolicy,
      options: {
        request: (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
      },
    ) => Promise<BrowserProxy>;
    const requestFactory = (options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest => {
      const outgoing = request(options, callback);
      queueMicrotask(() => void proxy?.close());
      return outgoing;
    };
    proxy = await createProxyWithRequestFactory("public", policy, { request: requestFactory });
    try {
      await expect(
        rawHeaders(
          proxy,
          `GET http://example.test:${port}/resource HTTP/1.1\r\nHost: example.test:${port}\r\nConnection: close\r\n\r\n`,
        ),
      ).rejects.toThrow("proxy closed");
      await new Promise((resolve) => setImmediate(resolve));
      expect(hits).toBe(0);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => origin.close(() => resolve()));
    }
  });

  test("does not open HTTP, CONNECT, or upgrade transports after close starts", async () => {
    let hits = 0;
    const origin = createServer();
    origin.on("connection", () => (hits += 1));
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    const port = (origin.address() as AddressInfo).port;
    const target = `http://example.test:${port}/resource`;
    const destination: BrowserDestination = { address: loopbackAddress, port, url: target };
    const releases: Array<(value: BrowserDestination) => void> = [];
    let ready!: () => void;
    const started = new Promise<void>((resolve) => (ready = resolve));
    const policy: BrowserNetworkPolicy = { navigation: () => null, resolve: () => new Promise((resolve) => {
      releases.push(resolve); if (releases.length === 3) ready();
    }) };
    const proxy = await createBrowserProxy("public", policy);
    const endpoint = new URL(proxy.url);
    for (const message of [
      `GET ${target} HTTP/1.1\r\nHost: example.test:${port}\r\n\r\n`,
      `CONNECT example.test:${port} HTTP/1.1\r\nHost: example.test:${port}\r\n\r\n`,
      `GET ${target} HTTP/1.1\r\nHost: example.test:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    ]) {
      const socket = connect(Number(endpoint.port), endpoint.hostname, () => socket.write(message));
      socket.on("error", () => undefined);
    }
    await started;
    const closing = proxy.close();
    for (const release of releases) release(destination);
    await closing;
    await new Promise((resolve) => setImmediate(resolve));
    expect(hits).toBe(0);
    await new Promise<void>((resolve) => origin.close(() => resolve()));
  });
  test("closes the old mode before relaunch and stops terminally", async () => {
    const events: string[] = [];
    const manager = new PlaywrightManager(
      async (directory) => {
        const mode = directory.endsWith("-public") ? "public" : "loopback";
        events.push(`launch:${mode}`);
        return fakeContext(mode, events);
      },
      () => "/chromium",
      async (mode) => fakeProxy(`proxy:${mode}`, events),
    );
    await manager.ensure("public");
    await manager.ensure("loopback");
    await manager.stop();
    expect(events.join()).toBe("launch:public,close:public,launch:loopback,close:loopback,close:proxy:public,close:proxy:loopback");
    await expect(manager.ensure()).rejects.toThrow("stopped");
  });
  test("cleans partial proxy and route-registration failures terminally", async () => {
    const proxyEvents: string[] = [];
    const proxyManager = new PlaywrightManager(
      async () => Promise.reject(new Error("unexpected launch")),
      () => "/chromium",
      async (mode) => {
        proxyEvents.push(`make:${mode}`);
        if (mode === "loopback") throw new Error("proxy failed");
        return fakeProxy(mode, proxyEvents);
      },
    );
    await expect(proxyManager.ensure()).rejects.toThrow("proxy failed");
    await expect(proxyManager.ensure()).rejects.toThrow("proxy failed");
    expect(proxyEvents.join()).toBe("make:public,make:loopback,close:public");
    const routeEvents: string[] = [];
    const context = fakeContext("context", routeEvents, async () => {
      routeEvents.push("route");
      throw new Error("route failed");
    });
    const routeManager = new PlaywrightManager(async () => {
      routeEvents.push("launch"); return context;
    },
      () => "/chromium",
      async (mode) => fakeProxy(mode, routeEvents),
    );
    await expect(routeManager.ensure()).rejects.toThrow("route failed");
    await expect(routeManager.ensure()).rejects.toThrow("route failed");
    expect(routeEvents.join()).toBe("launch,route,close:context,close:public,close:loopback");
  });
  test("serializes browser mode transitions across concurrent navigations", async () => {
    const publicPage = browserPage();
    const loopbackPage = browserPage();
    const publicContext = browserContext(publicPage);
    const loopbackContext = browserContext(loopbackPage);
    let releasePublic!: () => void;
    const publicReady = new Promise<BrowserContext>((resolve) => {
      releasePublic = () => resolve(publicContext);
    });
    const previousEnsure = playwrightManager.ensure;
    playwrightManager.ensure = (mode = "public") =>
      mode === "public"
        ? publicReady
        : publicContext.close().then(() => loopbackContext);
    try {
      const publicNavigation = browserHost.navigate("https://example.test/public");
      await Promise.resolve();
      const loopbackNavigation = browserHost.navigate("http://localhost:3000/loopback");
      await Promise.resolve();
      releasePublic();
      await expect(publicNavigation).resolves.toMatchObject({ url: "https://example.test/public" });
      await expect(loopbackNavigation).resolves.toMatchObject({ url: "http://localhost:3000/loopback" });
    } finally {
      playwrightManager.ensure = previousEnsure;
    }
  });
  test.skipIf(findBrowserBinary() === null)(
    "keeps real Chromium redirects and subresources from reaching a rebound loopback target",
    async () => {
      const binary = findBrowserBinary();
      if (!binary) throw new Error("Chromium disappeared after test selection");
      const probes = [
        "redirect",
        "image",
        "script",
        "iframe",
        "fetch",
        "websocket",
        "worker",
      ] as const;
      type Probe = (typeof probes)[number];
      const expected = new Set<Probe>(probes);
      const routeProbes = new Map<string, Probe>([
        ["/redirect", "redirect"],
        ["/image", "image"],
        ["/script.js", "script"],
        ["/frame", "iframe"],
        ["/fetch", "fetch"],
        ["/socket", "websocket"],
        ["/worker.js", "worker"],
      ]);
      const proxyProbes = new Map<string, Probe>([
        ["/redirect-target", "redirect"],
        ["/image", "image"],
        ["/script.js", "script"],
        ["/frame", "iframe"],
        ["/fetch", "fetch"],
        ["/worker.js", "worker"],
      ]);
      const routeAllowed = new Set<Probe>();
      const proxyRejected = new Set<Probe>();
      const complete = Deferred.makeUnsafe<void>();
      let targetConnections = 0;
      const target = createServer();
      target.on("connection", (socket) => {
        targetConnections += 1;
        socket.destroy();
      });
      let targetOrigin = "";
      const entry = createServer((incoming, response) => {
        if (incoming.url === "/redirect") {
          response.writeHead(302, { location: `${targetOrigin}/redirect-target` });
          response.end();
          return;
        }
        if (incoming.url === "/subresources") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(`<!doctype html><html><body>
<img src="${targetOrigin}/image"><script src="${targetOrigin}/script.js"></script><iframe src="${targetOrigin}/frame"></iframe>
<script>
void fetch("${targetOrigin}/fetch").catch(() => undefined);
const socket = new WebSocket("${targetOrigin.replace(/^http/u, "ws")}/socket");
socket.addEventListener("error", () => socket.close());
const workerSource = 'importScripts("${targetOrigin}/worker.js")';
const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
worker.addEventListener("error", () => worker.terminate());
</script></body></html>`);
          return;
        }
        response.writeHead(404);
        response.end();
      });
      const profile = mkdtempSync(join(tmpdir(), "local-studio-browser-canary-"));
      let manager: PlaywrightManager | null = null;
      try {
        await listen(target, 0, loopbackAddress.address);
        const targetPort = (target.address() as AddressInfo).port;
        targetOrigin = `http://rebind.test:${targetPort}`;
        await listen(entry, 0, loopbackAddress.address);
        const port = (entry.address() as AddressInfo).port;
        const allowed = createBrowserNetworkPolicy(async (hostname) =>
          hostname === "rebind.test" ? [publicAddress] : [loopbackAddress],
        );
        const blocked = createBrowserNetworkPolicy(async () => [loopbackAddress]);
        const routePolicy: BrowserNetworkPolicy = {
          navigation: allowed.navigation,
          resolve: async (raw, mode) => {
            const url = new URL(raw);
            const destination = await allowed.resolve(raw, mode);
            const probe = routeProbes.get(url.pathname);
            if (probe) routeAllowed.add(probe);
            return destination;
          },
        };
        const proxyPolicy: BrowserNetworkPolicy = {
          navigation: blocked.navigation,
          resolve: async (raw, mode) => {
            const url = new URL(raw);
            if (url.hostname === "rebind.test" && url.port === String(port)) {
              return { address: loopbackAddress, port, url: url.toString() };
            }
            try {
              return await blocked.resolve(raw, mode);
            } catch (error) {
              const probe =
                url.hostname === "rebind.test" &&
                url.port === String(targetPort) &&
                url.protocol === "https:" &&
                url.pathname === "/"
                  ? "websocket"
                  : proxyProbes.get(url.pathname);
              if (probe) {
                proxyRejected.add(probe);
                if (proxyRejected.size === expected.size) {
                  Effect.runSync(Deferred.succeed(complete, undefined));
                }
              }
              throw error;
            }
          },
        };
        manager = new PlaywrightManager(
          (_directory, options) => chromium.launchPersistentContext(profile, options),
          () => binary,
          (mode) => createBrowserProxy(mode, proxyPolicy),
          routePolicy,
        );
        const context = await manager.ensure("public");
        const origin = `http://rebind.test:${port}`;
        const redirectPage = await context.newPage();
        await redirectPage
          .goto(`${origin}/redirect`, { timeout: 5_000, waitUntil: "domcontentloaded" })
          .catch(() => null);
        await redirectPage.close();
        const page = await context.newPage();
        await page.goto(`${origin}/subresources`, {
          timeout: 5_000,
          waitUntil: "domcontentloaded",
        });
        await Effect.runPromise(Deferred.await(complete).pipe(Effect.timeout(15_000)));
        await new Promise((resolve) => setImmediate(resolve));
        expect(routeAllowed).toEqual(expected);
        expect(proxyRejected).toEqual(expected);
        expect(targetConnections).toBe(0);
      } finally {
        if (manager) await manager.stop();
        await Promise.all([close(entry), close(target)]);
        rmSync(profile, { force: true, recursive: true });
      }
    },
    20_000,
  );
});
