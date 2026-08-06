import { describe, expect, test } from "bun:test";
import { createServer, request } from "node:http";
import { connect, type AddressInfo } from "node:net";
import type { BrowserContext } from "playwright-core";
import { createBrowserNetworkPolicy, type BrowserDestination, type BrowserNetworkPolicy } from "../src/browser-host/network-policy";
import { createBrowserProxy, type BrowserProxy } from "../src/browser-host/pinning-proxy";
import { PlaywrightManager } from "../src/browser-host/playwright";

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
function fakeProxy(mode: string, events: string[]): BrowserProxy {
  return { url: "http://127.0.0.1:1", close: async () => void events.push(`close:${mode}`) };
}
function fakeContext(mode: string, events: string[], route = async (): Promise<void> => undefined) {
  return {
    close: async () => void events.push(`close:${mode}`), once: () => undefined,
    route, routeWebSocket: async () => undefined,
  } as unknown as BrowserContext;
}
describe("browser network policy", () => {
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
    let host = "";
    const origin = createServer((incoming, response) => {
      hits += 1;
      host = incoming.headers.host ?? "";
      response.end();
    });
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    const port = (origin.address() as AddressInfo).port;
    const policy = createBrowserNetworkPolicy(async () => [loopbackAddress]);
    const publicProxy = await createBrowserProxy("public", policy);
    const target = `http://example.test:${port}/resource`;
    expect(await through(publicProxy, target)).toBe(403);
    expect(hits).toBe(0);
    await publicProxy.close();
    const loopbackProxy = await createBrowserProxy("loopback", policy);
    expect(await through(loopbackProxy, target)).toBe(403);
    expect(await through(loopbackProxy, `http://localhost:${port}/resource`)).toBe(200);
    expect([hits, host]).toEqual([1, `localhost:${port}`]);
    await loopbackProxy.close();
    await new Promise<void>((resolve) => origin.close(() => resolve()));
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
});
