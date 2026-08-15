import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Semaphore } from "effect";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { getGlobalSingleton } from "../instances";
import {
  browserNetworkPolicy,
  type BrowserNetworkMode,
  type BrowserNetworkPolicy,
} from "./network-policy";
import { createBrowserProxy, type BrowserProxy } from "./pinning-proxy";

const LAUNCH_TIMEOUT_MS = 15_000;
const launchPersistentBrowser = chromium.launchPersistentContext.bind(chromium);

class BrowserContextInvalidatedError extends Error {
  readonly name = "BrowserContextInvalidatedError";
}

const browserDataDirectory = (mode: BrowserNetworkMode): string =>
  path.join(os.tmpdir(), `local-studio-browser-profile-${mode}`);

const resolveOnPath = (binary: string): string | null => {
  try {
    const resolved = execFileSync("which", [binary], { encoding: "utf8" }).trim();
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
};

const platformBrowserCandidates = (): string[] => {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Arc.app/Contents/MacOS/Arc",
      "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ].filter((value): value is string => Boolean(value));
    const suffixes = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Google\\Chrome Beta\\Application\\chrome.exe",
      "Chromium\\Application\\chrome.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "Vivaldi\\Application\\vivaldi.exe",
    ];
    return roots.flatMap((root) => suffixes.map((suffix) => path.join(root, suffix)));
  }
  return [
    "chromium-browser",
    "chromium",
    "google-chrome-stable",
    "google-chrome",
    "brave-browser",
    "microsoft-edge",
    "microsoft-edge-stable",
    "vivaldi-stable",
  ]
    .map(resolveOnPath)
    .filter((value): value is string => Boolean(value));
};

export const findBrowserBinary = (): string | null => {
  const override = process.env["LOCAL_STUDIO_CHROME_PATH"]?.trim();
  if (override) return existsSync(override) ? override : null;
  const bundled = chromium.executablePath();
  if (bundled && existsSync(bundled)) return bundled;
  return platformBrowserCandidates().find((candidate) => existsSync(candidate)) ?? null;
};

export class PlaywrightManager {
  private context: BrowserContext | null = null;
  private pendingContext: BrowserContext | null = null;
  private contextGeneration = 0;
  private generation = 0;
  private mode: BrowserNetworkMode | null = null;
  private proxies: Record<BrowserNetworkMode, BrowserProxy> | null = null;
  private pendingProxies = new Set<BrowserProxy>();
  private failure: unknown = null;
  private stopped = false;
  private readonly lock = Semaphore.makeUnsafe(1);

  constructor(
    private readonly launchBrowser = launchPersistentBrowser,
    private readonly resolveBinary = findBrowserBinary,
    private readonly proxyFactory = createBrowserProxy,
    private readonly networkPolicy: BrowserNetworkPolicy = browserNetworkPolicy,
  ) {}

  isAvailable(): boolean {
    return !this.stopped && this.failure === null && this.resolveBinary() !== null;
  }

  ensure(mode: BrowserNetworkMode = "public"): Promise<BrowserContext> {
    const generation = this.generation;
    return this.serial(() => this.ensureUnlocked(mode, generation));
  }

  private async ensureUnlocked(
    mode: BrowserNetworkMode,
    generation: number,
  ): Promise<BrowserContext> {
    if (this.failure) throw this.failure;
    if (this.stopped) throw new Error("Browser manager stopped");
    this.assertGeneration(generation);
    if (this.context && this.contextGeneration === generation && this.mode === mode) {
      return this.context;
    }
    if (this.context) {
      const context = this.context;
      try {
        await context.close();
      } catch (error) {
        return this.abort(error);
      }
      if (this.context === context) this.context = null;
      this.contextGeneration = 0;
      this.mode = null;
      this.assertGeneration(generation);
    }
    const executablePath = this.resolveBinary();
    if (!executablePath) {
      throw new Error("Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH");
    }
    this.proxies ??= await this.createProxies(generation);
    this.assertGeneration(generation);
    const proxy = this.proxies[mode];
    const launch = (userDataDir: string): Promise<BrowserContext> =>
      this.launchBrowser(userDataDir, {
        executablePath,
        headless: true,
        proxy: { server: proxy.url },
        serviceWorkers: "block",
        viewport: { width: 1280, height: 800 },
        timeout: LAUNCH_TIMEOUT_MS,
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-dev-shm-usage",
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--proxy-bypass-list=<-loopback>",
        ],
      });
    const dataDirectory = browserDataDirectory(mode);
    let context: BrowserContext;
    let closed = false;
    try {
      context = await launch(dataDirectory).catch((error: unknown) => {
        if (!String(error).includes("ProcessSingleton")) throw error;
        this.assertGeneration(generation);
        return launch(`${dataDirectory}-${process.pid}`);
      });
      this.pendingContext = context;
      context.once("close", () => {
        closed = true;
        if (this.pendingContext === context) this.pendingContext = null;
        if (this.context === context) {
          this.context = null;
          this.contextGeneration = 0;
          this.mode = null;
        }
      });
      await this.closeIfInvalidated(context, generation);
      await context.route(/^https?:\/\//u, async (route) => {
        try {
          await this.networkPolicy.resolve(route.request().url(), mode);
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      await this.closeIfInvalidated(context, generation);
      await context.routeWebSocket(/^wss?:\/\//u, async (route) => {
        try {
          await this.networkPolicy.resolve(route.url(), mode);
          route.connectToServer();
        } catch {
          await route.close({ code: 1008, reason: "Browser network policy blocked destination" });
        }
      });
      await this.closeIfInvalidated(context, generation);
      if (closed) throw new Error("Browser context closed during initialization");
    } catch (error) {
      if (error instanceof BrowserContextInvalidatedError) throw error;
      return this.abort(error);
    }
    this.pendingContext = null;
    this.context = context;
    this.contextGeneration = generation;
    this.mode = mode;
    return context;
  }

  invalidate(): Promise<void> {
    this.generation += 1;
    return this.serial(async () => {
      const priorFailure = this.failure;
      const cleanupFailure = await this.cleanupFailure();
      if (cleanupFailure) {
        this.failure = priorFailure
          ? new AggregateError(
              [priorFailure, cleanupFailure],
              "Browser recovery and prior setup failed",
            )
          : cleanupFailure;
        throw this.failure;
      }
      if (priorFailure) throw priorFailure;
      if (this.stopped) throw new Error("Browser manager stopped");
    });
  }

  stop(): Promise<void> {
    this.generation += 1;
    return this.serial(async () => {
      this.stopped = true;
      const priorFailure = this.failure;
      const cleanupFailure = await this.cleanupFailure();
      if (cleanupFailure) {
        this.failure = priorFailure
          ? new AggregateError(
              [priorFailure, cleanupFailure],
              "Browser stop and prior setup failed",
            )
          : cleanupFailure;
        throw this.failure;
      }
      if (priorFailure) throw priorFailure;
    });
  }

  private async createProxies(
    generation: number,
  ): Promise<Record<BrowserNetworkMode, BrowserProxy>> {
    try {
      const publicProxy = await this.proxyFactory("public");
      this.pendingProxies.add(publicProxy);
      this.assertGeneration(generation);
      const loopbackProxy = await this.proxyFactory("loopback");
      this.pendingProxies.add(loopbackProxy);
      this.assertGeneration(generation);
      this.pendingProxies.delete(publicProxy);
      this.pendingProxies.delete(loopbackProxy);
      return { loopback: loopbackProxy, public: publicProxy };
    } catch (error) {
      if (error instanceof BrowserContextInvalidatedError) throw error;
      return this.abort(error);
    }
  }

  private async closeIfInvalidated(
    context: BrowserContext,
    generation: number,
  ): Promise<void> {
    if (generation === this.generation) return;
    try {
      await this.closeContext(context);
    } catch (error) {
      return this.abort(error);
    }
    if (this.pendingContext === context) this.pendingContext = null;
    throw new BrowserContextInvalidatedError("Browser context invalidated during launch");
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new BrowserContextInvalidatedError("Browser context invalidated");
    }
  }

  private contexts(): BrowserContext[] {
    return Array.from(
      new Set(
        [this.context, this.pendingContext].filter(
          (value): value is BrowserContext => value != null,
        ),
      ),
    );
  }

  private proxyResources(): BrowserProxy[] {
    return Array.from(
      new Set(
        [...this.pendingProxies, this.proxies?.public, this.proxies?.loopback].filter(
          (value): value is BrowserProxy => value != null,
        ),
      ),
    );
  }

  private closeContext(context: BrowserContext): Promise<void> {
    return context.close().catch(async (contextError: unknown) => {
      let browser: Browser | null = null;
      try {
        browser = context.browser();
      } catch {}
      if (!browser) throw contextError;
      try {
        await browser.close();
      } catch (browserError) {
        throw new AggregateError(
          [contextError, browserError],
          "Browser context and process failed to close",
        );
      }
    });
  }

  private cleanup(): Promise<PromiseSettledResult<void>[]> {
    const contexts = this.contexts();
    const proxies = this.proxyResources();
    this.context = null;
    this.pendingContext = null;
    this.contextGeneration = 0;
    this.mode = null;
    this.proxies = null;
    this.pendingProxies.clear();
    return Promise.allSettled([
      ...contexts.map((context) => this.closeContext(context)),
      ...proxies.map((proxy) => proxy.close()),
    ]);
  }

  private async cleanupFailure(): Promise<AggregateError | null> {
    const failed = (await this.cleanup()).filter((result) => result.status === "rejected");
    return failed.length
      ? new AggregateError(
          failed.map((result) => result.reason),
          "Browser resources failed to close",
        )
      : null;
  }

  private async abort(error: unknown): Promise<never> {
    const cleanupFailure = await this.cleanupFailure();
    this.failure = cleanupFailure
      ? new AggregateError(
          [error, cleanupFailure],
          "Browser setup failed and resources failed to close",
        )
      : error;
    throw this.failure;
  }

  private async serial<A>(task: () => Promise<A>): Promise<A> {
    const outcome = await Effect.runPromise(
      this.lock.withPermit(
        Effect.promise(() =>
          task().then(
            (value) => ({ success: true as const, value }),
            (error: unknown) => ({ success: false as const, error }),
          ),
        ),
      ),
    );
    if (!outcome.success) throw outcome.error;
    return outcome.value;
  }
}

export const playwrightManager = getGlobalSingleton(
  "playwrightManager",
  () => new PlaywrightManager(),
);

getGlobalSingleton("playwrightExitHook", () => {
  if (typeof process !== "undefined") {
    process.on("exit", () => void playwrightManager.stop().catch(() => undefined));
  }
  return true;
});
