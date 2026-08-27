import { app, BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const windows = new Map<string, BrowserWindow>();

async function scanRequests(): Promise<void> {
  const root = path.join(app.getPath("userData"), "browser-host");
  const requests = path.join(root, "requests");
  const responses = path.join(root, "responses");
  await mkdir(requests, { recursive: true, mode: 0o700 });
  await mkdir(responses, { recursive: true, mode: 0o700 });
  for (const filename of await readdir(requests)) {
    if (!filename.endsWith(".json")) continue;
    const requestPath = path.join(requests, filename);
    try {
      const request = JSON.parse(await readFile(requestPath, "utf8")) as {
        marker?: string;
        sessionId?: string;
      };
      if (!request.marker || !request.sessionId) continue;
      let window = windows.get(request.sessionId);
      if (!window || window.isDestroyed()) {
        const partition = `persist:local-studio-${createHash("sha256").update(request.sessionId).digest("hex")}`;
        window = new BrowserWindow({
          show: false,
          webPreferences: {
            partition,
            sandbox: true,
            nodeIntegration: false,
            contextIsolation: true,
          },
        });
        windows.set(request.sessionId, window);
        await window.loadURL(`about:blank#${request.marker}`);
      }
      await writeFile(path.join(responses, filename), JSON.stringify({ marker: request.marker }), {
        mode: 0o600,
      });
      await rm(requestPath);
    } catch {}
  }
}

export function runBrowserHost(): void {
  app.on("window-all-closed", () => undefined);
  void app.whenReady().then(() => {
    setInterval(() => void scanRequests(), 50);
    void scanRequests();
  });
}
