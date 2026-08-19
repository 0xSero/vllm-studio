import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright-core";
import { getGlobalSingleton } from "../instances";
import {
  resolveBrowserEngine,
  tryResolveBrowserEngine,
  type ResolvedBrowserEngine,
} from "./browser-engines";

const LAUNCH_TIMEOUT_MS = 15_000;

const browserDataDirectory = (): string => path.join(os.tmpdir(), "local-studio-browser-profile");

class PlaywrightManager {
  private context: BrowserContext | null = null;
  private launching: Promise<BrowserContext> | null = null;
  private active: ResolvedBrowserEngine | null = null;

  isAvailable(): boolean {
    return tryResolveBrowserEngine() !== null;
  }

  /** The engine backing the live context, or the one the next launch will use. */
  activeEngine(): ResolvedBrowserEngine | null {
    return this.active ?? tryResolveBrowserEngine();
  }

  async ensure(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.launching) return this.launching;
    // Throws a message naming the exact problem (missing override path, no
    // browser installed); browser-handlers surfaces it verbatim.
    const engine = resolveBrowserEngine();
    const launch = (userDataDir: string): Promise<BrowserContext> =>
      chromium.launchPersistentContext(userDataDir, {
        executablePath: engine.path,
        headless: true,
        viewport: { width: 1280, height: 800 },
        timeout: LAUNCH_TIMEOUT_MS,
        args: ["--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage"],
      });
    // Per-engine profile: Chrome, Brave, and Chromium do not share a user-data
    // directory format cleanly, and swapping engines against one profile leaves
    // the second launch fighting the first one's lock and preferences.
    const dataDirectory = `${browserDataDirectory()}-${engine.id}`;
    this.launching = launch(dataDirectory)
      .catch((error: unknown) => {
        if (!String(error).includes("ProcessSingleton")) throw error;
        return launch(`${dataDirectory}-${process.pid}`);
      })
      .then((context) => {
        this.context = context;
        this.active = engine;
        context.once("close", () => {
          if (this.context === context) {
            this.context = null;
            this.active = null;
          }
        });
        return context;
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  stop(): void {
    const context = this.context;
    this.context = null;
    this.active = null;
    if (context) void context.close().catch(() => undefined);
  }
}

export const playwrightManager = getGlobalSingleton(
  "playwrightManager",
  () => new PlaywrightManager(),
);

getGlobalSingleton("playwrightExitHook", () => {
  if (typeof process !== "undefined") {
    process.on("exit", () => playwrightManager.stop());
  }
  return true;
});
