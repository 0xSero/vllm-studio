import { randomUUID } from "node:crypto";
import { errors, type Page, type Response } from "playwright-core";

export type PageState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
};
export type ScreencastFrame = { data: string; metadata: object };
type NavigationDirection = "back" | "forward" | "reload" | null;

export class HostedPage {
  readonly id = randomUUID();
  private frameCapture: Promise<void> | null = null;
  private historyIndex = 0;
  private historyLength = 1;
  private historyInitialized = false;
  private navigationDirection: NavigationDirection = null;
  private lastUrl: string;
  private loading = false;
  latestFrame: ScreencastFrame | null = null;

  private constructor(private readonly page: Page) {
    this.lastUrl = page.url();
    this.bindEvents();
  }

  static attach(page: Page): HostedPage {
    return new HostedPage(page);
  }

  matches(page: Page): boolean {
    return this.page === page;
  }

  get closed(): boolean {
    return this.page.isClosed();
  }

  close(): void {
    if (!this.closed) void this.page.close().catch(() => undefined);
  }

  private bindEvents(): void {
    this.page.on("framenavigated", (frame) => {
      if (frame !== this.page.mainFrame()) return;
      const url = frame.url();
      if (url !== this.lastUrl) this.recordNavigation(url);
      this.loading = false;
    });
    const loaded = () => {
      this.loading = false;
    };
    this.page.on("domcontentloaded", loaded);
    this.page.on("load", loaded);
  }

  private recordNavigation(url: string): void {
    if (this.navigationDirection === "back") this.historyIndex = Math.max(0, this.historyIndex - 1);
    else if (this.navigationDirection === "forward") {
      this.historyIndex = Math.min(this.historyLength - 1, this.historyIndex + 1);
    } else if (this.navigationDirection !== "reload") {
      this.historyLength = ++this.historyIndex + 1;
    }
    this.navigationDirection = null;
    this.lastUrl = url;
  }

  private async navigateWith(
    direction: NavigationDirection,
    timeout: number,
    navigate: () => Promise<Response | null>,
  ): Promise<void> {
    this.loading = true;
    this.navigationDirection = direction;
    try {
      await navigate();
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
    } finally {
      this.loading = false;
      this.navigationDirection = null;
    }
  }

  navigate(url: string, timeout: number): Promise<void> {
    return this.navigateWith(null, timeout, () =>
      this.page.goto(url, { waitUntil: "domcontentloaded", timeout }),
    );
  }

  goBack(timeout: number): Promise<void> {
    return this.navigateWith("back", timeout, () =>
      this.page.goBack({ waitUntil: "domcontentloaded", timeout }),
    );
  }

  goForward(timeout: number): Promise<void> {
    return this.navigateWith("forward", timeout, () =>
      this.page.goForward({ waitUntil: "domcontentloaded", timeout }),
    );
  }

  reload(timeout: number): Promise<void> {
    return this.navigateWith("reload", timeout, () =>
      this.page.reload({ waitUntil: "domcontentloaded", timeout }),
    );
  }

  text(): Promise<string> {
    return this.page
      .locator("body")
      .innerText()
      .catch(() => "");
  }

  html(): Promise<string> {
    return this.page.content();
  }

  async click(selector: string): Promise<boolean> {
    const locator = this.page.locator(selector).first();
    if (!(await locator.count())) return false;
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    return true;
  }

  async fill(selector: string, value: string): Promise<boolean> {
    const locator = this.page.locator(selector).first();
    if (!(await locator.count())) return false;
    const tag = await locator.evaluate((element) => element.tagName);
    await locator.scrollIntoViewIfNeeded();
    if (tag === "SELECT") await locator.selectOption(value);
    else await locator.fill(value);
    return true;
  }

  scroll(deltaX: number, deltaY: number): Promise<number> {
    return this.page.evaluate(
      ({ x, y }) => {
        window.scrollBy(x, y);
        return window.scrollY;
      },
      { x: deltaX, y: deltaY },
    );
  }

  async screenshot(type: "png" | "jpeg", quality?: number): Promise<string> {
    const data =
      type === "jpeg" && quality
        ? await this.page.screenshot({ type, quality })
        : await this.page.screenshot({ type });
    return data.toString("base64");
  }

  setViewport(width: number, height: number): Promise<void> {
    return this.page.setViewportSize({ width: Math.round(width), height: Math.round(height) });
  }

  async dispatchMouse(input: {
    type: "down" | "up" | "move" | "wheel";
    x: number;
    y: number;
    button?: "left" | "right" | "middle";
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
  }): Promise<void> {
    await this.page.mouse.move(input.x, input.y);
    if (input.type === "wheel") {
      await this.page.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 0);
    } else if (input.type !== "move") {
      await this.page.mouse[input.type]({
        button: input.button ?? "left",
        clickCount: input.clickCount ?? 1,
      });
    }
  }

  dispatchKey(input: { type: "down" | "up"; key: string }): Promise<void> {
    return this.page.keyboard[input.type](input.key);
  }

  async captureFrame(): Promise<ScreencastFrame | null> {
    if (this.closed) return null;
    this.frameCapture ??= this.screenshot("jpeg", 60)
      .then((data) => {
        this.latestFrame = { data, metadata: {} };
      })
      .finally(() => {
        this.frameCapture = null;
      });
    await this.frameCapture;
    return this.latestFrame;
  }

  async readState(): Promise<PageState> {
    if (!this.historyInitialized) {
      this.historyLength = Math.max(
        1,
        await this.page.evaluate(() => window.history.length).catch(() => 1),
      );
      this.historyIndex = this.historyLength - 1;
      this.historyInitialized = true;
    }
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ""),
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex < this.historyLength - 1,
      loading: this.loading,
    };
  }
}
