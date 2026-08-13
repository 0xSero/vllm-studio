import { browserSessionRequest } from "@/features/agent/browser/session-request";

export type BrowserViewport = { height: number; width: number };
export type BrowserSessionFrame = { sessionId: string; src: string };
export type BrowserSurfaceRequest = {
  controller: AbortController;
  init: RequestInit;
  input: string;
};

export function browserFrameSource(
  frame: BrowserSessionFrame | null,
  sessionId: string | null,
): string | null {
  return frame?.sessionId === sessionId ? frame.src : null;
}

const DEFAULT_VIEWPORT: BrowserViewport = { height: 800, width: 1280 };

export class BrowserSessionSurface {
  private readonly controllers = new Set<AbortController>();
  private inheritedUrl = "";
  private serverUrl = "";
  private sessionId: string | null = null;
  private viewportState = DEFAULT_VIEWPORT;
  private viewportSessionId: string | null = null;

  constructor(sessionId: string | null = null, desiredUrl = "") {
    this.sessionId = sessionId;
    this.inheritedUrl = desiredUrl.trim();
  }

  enterSession(sessionId: string | null, desiredUrl: string): void {
    if (this.sessionId === sessionId) return;
    this.abortRequests();
    this.sessionId = sessionId;
    this.inheritedUrl = desiredUrl.trim();
    this.serverUrl = "";
    this.viewportState = DEFAULT_VIEWPORT;
    this.viewportSessionId = null;
  }

  requestController(sessionId: string | null): AbortController | null {
    if (!sessionId || sessionId !== this.sessionId) return null;
    const controller = new AbortController();
    this.controllers.add(controller);
    return controller;
  }

  ownsSession(sessionId: string | null): boolean {
    return Boolean(sessionId && sessionId === this.sessionId);
  }

  releaseRequest(controller: AbortController): void {
    this.controllers.delete(controller);
  }

  observeServerUrl(sessionId: string, url: string): void {
    if (sessionId === this.sessionId) this.serverUrl = url;
  }

  navigationTarget(sessionId: string | null, desiredUrl: string): string | null {
    const target = desiredUrl.trim();
    if (!sessionId || sessionId !== this.sessionId || !target || target === this.serverUrl) {
      return null;
    }
    if (target === this.inheritedUrl) {
      this.inheritedUrl = "";
      return null;
    }
    return target;
  }

  syncViewport(sessionId: string, viewport: BrowserViewport): boolean {
    if (sessionId !== this.sessionId) return false;
    const changed =
      this.viewportSessionId !== sessionId ||
      viewport.width !== this.viewportState.width ||
      viewport.height !== this.viewportState.height;
    this.viewportState = viewport;
    this.viewportSessionId = sessionId;
    return changed;
  }

  viewport(): BrowserViewport {
    return this.viewportState;
  }

  dispose(): void {
    this.abortRequests();
    this.sessionId = null;
  }

  private abortRequests(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}

export function browserSurfaceRequest(
  surface: BrowserSessionSurface,
  sessionId: string | null,
  path: string,
  init: RequestInit = {},
): BrowserSurfaceRequest | null {
  const controller = surface.requestController(sessionId);
  if (!controller) return null;
  const request = browserSessionRequest(sessionId, path, {
    ...init,
    signal: controller.signal,
  });
  if (!request) {
    surface.releaseRequest(controller);
    return null;
  }
  return { ...request, controller };
}
