import { app, shell, BrowserWindow, type WebContents } from "electron";
import { isHttpUrl } from "../helpers/url";

export function hardenWebContents(window: BrowserWindow, appOrigin: string): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event) => {
    const targetUrl = event.url;
    const targetOrigin = safeOrigin(targetUrl);
    if (!targetOrigin || targetOrigin !== appOrigin) {
      event.preventDefault();
      if (isHttpUrl(targetUrl)) {
        void shell.openExternal(targetUrl);
      }
    }
  });
}

export function registerNavigationPolicy(appOrigin: string): void {
  app.on("web-contents-created", (_, contents: WebContents) => {
    contents.on("will-attach-webview", (_event, webPreferences, _params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
    });

    contents.on("will-navigate", (event) => {
      // Guest WebContents (the embedded browser webview plus cross-origin
      // iframes / OOPIFs) must be able to perform their own navigations.
      // Keep the app shell origin-locked, but do not turn the Computer browser
      // into a single-load preview.
      if (contents.getType() === "webview" || BrowserWindow.fromWebContents(contents) == null) {
        return;
      }
      const targetUrl = event.url;
      const targetOrigin = safeOrigin(targetUrl);
      if (!targetOrigin || targetOrigin !== appOrigin) {
        event.preventDefault();
      }
    });
  });
}

function safeOrigin(input: string): string | null {
  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}
