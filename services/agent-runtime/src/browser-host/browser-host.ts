import { getGlobalSingleton } from "../instances";
import { Effect, Semaphore } from "effect";
import { HostedPage, type PageState, type ScreencastFrame } from "./hosted-page";
import { browserNetworkPolicy, type BrowserNetworkMode } from "./network-policy";
import { playwrightManager } from "./playwright";

export type { PageState, ScreencastFrame };

const TEXT_CAP_BYTES = 500 * 1024;
const HTML_CAP_BYTES = 1024 * 1024;
const NAVIGATION_TIMEOUT_MS = 8_000;

const normalizeUrl = (value: string): string =>
  /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;

const capString = (value: string, maximum: number): string =>
  value.length > maximum ? value.slice(0, maximum) : value;

class BrowserHost {
  private pages = new Map<string, HostedPage>();
  private activeId: string | null = null;
  private activeMode: BrowserNetworkMode | null = null;
  private readonly lock = Semaphore.makeUnsafe(1);

  isAvailable(): boolean {
    return playwrightManager.isAvailable();
  }

  page(
    pageId?: string,
    mode: BrowserNetworkMode = this.activeMode ?? "public",
  ): Promise<HostedPage> {
    return this.serial(() => this.pageUnlocked(pageId, mode));
  }

  private async pageUnlocked(
    pageId?: string,
    mode: BrowserNetworkMode = this.activeMode ?? "public",
  ): Promise<HostedPage> {
    if (this.activeMode !== mode) {
      this.pages.clear();
      this.activeId = null;
      this.activeMode = mode;
    }
    const targetId = pageId ?? this.activeId;
    const cached = targetId ? this.pages.get(targetId) : undefined;
    if (cached && !cached.closed) {
      this.activeId = cached.id;
      return cached;
    }
    if (cached) this.pages.delete(cached.id);

    const context = await playwrightManager.ensure(mode);
    const rawPage =
      context
        .pages()
        .find((candidate) =>
          Array.from(this.pages.values()).every((hosted) => !hosted.matches(candidate)),
        ) ?? (await context.newPage());
    const hosted = HostedPage.attach(rawPage);
    this.pages.set(hosted.id, hosted);
    this.activeId = hosted.id;
    return hosted;
  }

  async navigate(url: string, pageId?: string): Promise<{ url: string; title: string }> {
    const navigation = browserNetworkPolicy.navigation(normalizeUrl(url));
    if (!navigation) throw new Error("Browser network policy blocked navigation URL");
    return this.serial(async () => {
      const page = await this.pageUnlocked(pageId, navigation.mode);
      await page.navigate(navigation.url, NAVIGATION_TIMEOUT_MS);
      const state = await page.readState();
      return { url: state.url, title: state.title };
    });
  }

  async getUrl(pageId?: string): Promise<{ url: string; title: string }> {
    return this.withPage(pageId, async (page) => {
      const state = await page.readState();
      return { url: state.url, title: state.title };
    });
  }

  async getState(pageId?: string): Promise<PageState> {
    return this.withPage(pageId, (page) => page.readState());
  }

  async peekState(): Promise<PageState | null> {
    return this.serial(async () => {
      const page = this.activeId ? this.pages.get(this.activeId) : undefined;
      if (!page || page.closed) return null;
      return page.readState();
    });
  }

  async goBack(pageId?: string): Promise<void> {
    await this.withPage(pageId, (page) => page.goBack(NAVIGATION_TIMEOUT_MS));
  }

  async goForward(pageId?: string): Promise<void> {
    await this.withPage(pageId, (page) => page.goForward(NAVIGATION_TIMEOUT_MS));
  }

  async reload(pageId?: string): Promise<void> {
    await this.withPage(pageId, (page) => page.reload(NAVIGATION_TIMEOUT_MS));
  }

  async getText(pageId?: string): Promise<string> {
    return this.withPage(pageId, async (page) => capString(await page.text(), TEXT_CAP_BYTES));
  }

  async getHtml(pageId?: string): Promise<string> {
    return this.withPage(pageId, async (page) => capString(await page.html(), HTML_CAP_BYTES));
  }

  async click(args: { selector: string }, pageId?: string): Promise<{ found: boolean }> {
    return this.withPage(pageId, async (page) => ({ found: await page.click(args.selector) }));
  }

  async fill(
    args: { selector: string; value: string },
    pageId?: string,
  ): Promise<{ found: boolean }> {
    return this.withPage(pageId, async (page) => ({ found: await page.fill(args.selector, args.value) }));
  }

  async scroll(
    args: { deltaY: number; deltaX?: number },
    pageId?: string,
  ): Promise<{ deltaX: number; deltaY: number; scrollY: number }> {
    const deltaY = clampDelta(args.deltaY);
    const deltaX = clampDelta(args.deltaX ?? 0);
    return this.withPage(pageId, async (page) => ({
      deltaX,
      deltaY,
      scrollY: await page.scroll(deltaX, deltaY),
    }));
  }

  async screenshot(pageId?: string): Promise<string> {
    return this.withPage(pageId, async (page) => {
      const data = await page.screenshot("png");
      return `data:image/png;base64,${data}`;
    });
  }

  async setViewport(width: number, height: number, pageId?: string): Promise<void> {
    await this.withPage(pageId, (page) => page.setViewport(width, height));
  }

  async pollFrame(pageId?: string): Promise<{ frame: ScreencastFrame | null; state: PageState }> {
    return this.withPage(pageId, async (page) => {
      const [frame, state] = await Promise.all([page.captureFrame(), page.readState()]);
      return { frame, state };
    });
  }

  async dispatchMouse(args: MouseInput, pageId?: string): Promise<void> {
    await this.withPage(pageId, (page) => page.dispatchMouse(args));
  }

  async dispatchKey(args: KeyInput, pageId?: string): Promise<void> {
    await this.withPage(pageId, (page) => page.dispatchKey(args));
  }

  private withPage<A>(pageId: string | undefined, task: (page: HostedPage) => Promise<A>): Promise<A> {
    return this.serial(async () => task(await this.pageUnlocked(pageId)));
  }

  private serial<A>(task: () => Promise<A>): Promise<A> {
    return Effect.runPromise(
      this.lock.withPermit(Effect.tryPromise({ try: task, catch: (error) => error })),
    );
  }

  stop(): void {
    for (const page of this.pages.values()) page.close();
    this.pages.clear();
    this.activeId = null;
    this.activeMode = null;
    void playwrightManager.stop();
  }
}

export type MouseInput = {
  type: "down" | "up" | "move" | "wheel";
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
};

export type KeyInput = { type: "down" | "up"; key: string; code: string };

const clampDelta = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-10_000, Math.min(10_000, Math.trunc(value)));
};

export const browserHost = getGlobalSingleton("browserHost", () => new BrowserHost());
