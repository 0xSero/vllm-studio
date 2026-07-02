// Wraps a single CDP page connection: console ring, ref map, screencast fanout.

import { CdpClient, type CdpEvent } from "./cdp";
import type { SnapshotElement } from "./dom-scripts";

const CONSOLE_RING_SIZE = 1000;

export type ConsoleEntry = {
  timestamp: string;
  source: "console" | "exception" | "browser";
  level: string;
  text: string;
};

export type PageState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
};

export type ScreencastFrame = { data: string; metadata: Record<string, unknown> };
export type FrameSubscriber = (frame: ScreencastFrame) => void;
export type StateSubscriber = (state: PageState) => void;

export type CdpTarget = {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
};

function remoteObjectText(value: unknown): string {
  const object = value as { value?: unknown; description?: string; type?: string } | undefined;
  if (!object) return "";
  if (Object.hasOwn(object, "value")) {
    return typeof object.value === "string" ? object.value : JSON.stringify(object.value);
  }
  return object.description ?? object.type ?? "";
}

export class HostedPage {
  readonly id: string;
  private client: CdpClient;
  private console: ConsoleEntry[] = [];
  private refMap = new Map<string, string>();
  private captureEnabled = false;
  private frameSubscribers = new Set<FrameSubscriber>();
  private stateSubscribers = new Set<StateSubscriber>();
  private screencasting = false;
  private screencastListenersBound = false;
  // The in-flight (or settled) Page.startScreencast + seed promise. pollFrame
  // awaits it so the very first poll returns a seeded frame instead of null.
  private screencastReady: Promise<void> | null = null;
  latestFrame: ScreencastFrame | null = null;

  private constructor(id: string, client: CdpClient) {
    this.id = id;
    this.client = client;
  }

  static async attach(target: CdpTarget, timeoutMs: number): Promise<HostedPage> {
    const client = await CdpClient.connect(target.webSocketDebuggerUrl as string, timeoutMs);
    const page = new HostedPage(target.id, client);
    await page.enableCapture();
    return page;
  }

  get closed(): boolean {
    return this.client.closed;
  }

  close(): void {
    this.client.close();
  }

  private async enableCapture(): Promise<void> {
    if (this.captureEnabled) return;
    await this.client.call("Runtime.enable");
    await this.client.call("Log.enable");
    await this.client.call("Page.enable");
    this.client.on("Runtime.consoleAPICalled", (event) => this.recordConsole(event));
    this.client.on("Runtime.exceptionThrown", (event) => this.recordException(event));
    this.client.on("Log.entryAdded", (event) => this.recordLog(event));
    this.captureEnabled = true;
  }

  private pushConsole(entry: ConsoleEntry): void {
    this.console.push(entry);
    if (this.console.length > CONSOLE_RING_SIZE) {
      this.console.splice(0, this.console.length - CONSOLE_RING_SIZE);
    }
  }

  private recordConsole(event: CdpEvent): void {
    const args = (event.params?.args as unknown[]) ?? [];
    this.pushConsole({
      timestamp: new Date().toISOString(),
      source: "console",
      level: (event.params?.type as string) ?? "log",
      text: args.map(remoteObjectText).join(" "),
    });
  }

  private recordException(event: CdpEvent): void {
    const details = event.params?.exceptionDetails as { text?: string } | undefined;
    this.pushConsole({
      timestamp: new Date().toISOString(),
      source: "exception",
      level: "error",
      text: details?.text ?? "JavaScript exception",
    });
  }

  private recordLog(event: CdpEvent): void {
    const entry = event.params?.entry as { level?: string; text?: string } | undefined;
    this.pushConsole({
      timestamp: new Date().toISOString(),
      source: "browser",
      level: entry?.level ?? "info",
      text: entry?.text ?? "",
    });
  }

  drainConsole(limit: number): ConsoleEntry[] {
    return this.console.slice(Math.max(0, this.console.length - limit));
  }

  setRefMap(elements: SnapshotElement[]): void {
    this.refMap.clear();
    for (const element of elements) {
      if (element.ref && element.selector) this.refMap.set(element.ref, element.selector);
    }
  }

  resolveRef(ref: string): string | null {
    return this.refMap.get(ref) ?? null;
  }

  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.client.call(method, params);
  }

  // Invoke a page-realm script (an arrow-function string from dom-scripts.ts)
  // with JSON-serializable args. Throws on an exception inside the page.
  async invokeScript<T>(script: string, args: unknown[]): Promise<T> {
    const expression = `(${script})(...${JSON.stringify(args)})`;
    const result = await this.client.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const exception = (result as { exceptionDetails?: { exception?: { description?: string } } })
      .exceptionDetails;
    if (exception) throw new Error(exception.exception?.description ?? "Browser evaluation failed");
    return (result.result as { value?: T } | undefined)?.value as T;
  }

  // Screencast fanout. The first frame subscriber starts Page.startScreencast;
  // the last one to leave stops it. Returns the unsubscribe alongside a promise
  // that resolves once the screencast is started and seeded, so a poller can
  // await a first frame.
  subscribeFrames(callback: FrameSubscriber): { unsubscribe: () => void; ready: Promise<void> } {
    this.frameSubscribers.add(callback);
    const ready = this.ensureScreencast();
    return {
      ready,
      unsubscribe: () => {
        this.frameSubscribers.delete(callback);
        if (this.frameSubscribers.size === 0) void this.stopScreencast();
      },
    };
  }

  subscribeState(callback: StateSubscriber): () => void {
    this.stateSubscribers.add(callback);
    return () => {
      this.stateSubscribers.delete(callback);
    };
  }

  // One-shot-friendly load listener (Page.enable is already on from capture).
  subscribeLoad(callback: () => void): () => void {
    return this.client.on("Page.loadEventFired", callback);
  }

  private bindScreencastListeners(): void {
    if (this.screencastListenersBound) return;
    this.screencastListenersBound = true;
    this.client.on("Page.screencastFrame", (event) => this.onScreencastFrame(event));
    this.client.on("Page.frameNavigated", () => void this.emitState());
    this.client.on("Page.loadEventFired", () => void this.emitState());
  }

  private onScreencastFrame(event: CdpEvent): void {
    const data = event.params?.data as string | undefined;
    const sessionId = event.params?.sessionId as number | undefined;
    if (typeof sessionId === "number") {
      void this.client.call("Page.screencastFrameAck", { sessionId }).catch(() => {});
    }
    if (typeof data !== "string") return;
    const frame: ScreencastFrame = {
      data,
      metadata: (event.params?.metadata as Record<string, unknown>) ?? {},
    };
    this.latestFrame = frame;
    for (const subscriber of this.frameSubscribers) subscriber(frame);
  }

  private async emitState(): Promise<void> {
    if (this.stateSubscribers.size === 0) return;
    try {
      const state = await this.readState();
      for (const subscriber of this.stateSubscribers) subscriber(state);
    } catch {
      // Page may be navigating; the next event will carry fresh state.
    }
  }

  private ensureScreencast(): Promise<void> {
    if (this.screencastReady) return this.screencastReady;
    this.screencasting = true;
    this.bindScreencastListeners();
    this.screencastReady = (async () => {
      await this.client.call("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 2,
      });
      // everyNthFrame: 2 skips the first composite, so a fully idle page would
      // never emit a frame. Seed latestFrame + subscribers with one immediate
      // capture so the panel always has something to render on connect.
      await this.seedScreencastFrame();
    })().catch(() => {
      // Let the next subscribe retry from scratch if startup failed.
      this.screencasting = false;
      this.screencastReady = null;
    });
    return this.screencastReady;
  }

  private async seedScreencastFrame(): Promise<void> {
    try {
      const result = (await this.client.call("Page.captureScreenshot", {
        format: "jpeg",
        quality: 60,
        fromSurface: true,
      })) as { data?: string };
      if (!result.data) return;
      const frame: ScreencastFrame = { data: result.data, metadata: {} };
      this.latestFrame = frame;
      for (const subscriber of this.frameSubscribers) subscriber(frame);
    } catch {
      // A live screencast frame will follow on the next composite.
    }
  }

  private async stopScreencast(): Promise<void> {
    if (!this.screencasting) return;
    this.screencasting = false;
    this.screencastReady = null;
    await this.client.call("Page.stopScreencast").catch(() => {});
  }

  async readState(): Promise<PageState> {
    const history = (await this.client.call("Page.getNavigationHistory")) as {
      currentIndex: number;
      entries: { url: string; title: string }[];
    };
    const current = history.entries[history.currentIndex];
    return {
      url: current?.url ?? "",
      title: current?.title ?? "",
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
      loading: false,
    };
  }
}
