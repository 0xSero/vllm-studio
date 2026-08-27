import { app } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { DESKTOP_CONFIG, resolveDevelopmentFrontendDir } from "../configs";
import { log } from "../helpers/logger";
import { resolveStablePort } from "../helpers/ports";
import { resolveAugmentedPath } from "../helpers/resolve-path";

export type ControllerHandle = {
  frontendUrl: string;
  process?: ChildProcess;
  url: string;
};

type StartControllerOptions = {
  frontendUrl: string;
  preferredPort?: number;
};

let currentController: ChildProcess | null = null;

process.once("exit", () => {
  if (currentController && !currentController.killed) {
    currentController.kill("SIGTERM");
  }
});

function controllerEntry(): string {
  const executable =
    process.platform === "win32" ? "local-studio-controller.exe" : "local-studio-controller";
  return app.isPackaged
    ? path.join(process.resourcesPath, "app", "controller", executable)
    : path.resolve(
        resolveDevelopmentFrontendDir(),
        "..",
        "controller",
        "zig-out",
        "bin",
        executable,
      );
}

function browserHostEntry(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app", "browser-host.js")
    : path.resolve(resolveDevelopmentFrontendDir(), "desktop", "dist", "browser-host.js");
}

async function isControllerHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const payload = (await response.json()) as { service?: unknown; status?: unknown };
    return payload.service === "local-studio-controller" && payload.status === "ok";
  } catch {
    return false;
  }
}

async function waitForController(
  child: ChildProcess,
  url: string,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Controller exited with code ${child.exitCode}`);
    }
    if (await isControllerHealthy(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for controller: ${url}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const pid = child.pid;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function startController(options: StartControllerOptions): Promise<ControllerHandle> {
  const preferredUrl = options.preferredPort ? `http://127.0.0.1:${options.preferredPort}` : null;
  if (preferredUrl && (await isControllerHealthy(preferredUrl))) {
    log.info(`Using controller at ${preferredUrl}`);
    return { frontendUrl: options.frontendUrl, url: preferredUrl };
  }

  const entry = controllerEntry();
  if (!existsSync(entry)) {
    throw new Error(`Missing controller bundle: ${entry}`);
  }

  const port = await resolveStablePort(options.preferredPort);
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    entry,
    ["--mode", "standalone", "--host", "127.0.0.1", "--port", String(port)],
    {
      stdio: "pipe",
      detached: true,
      env: {
        ...process.env,
        PATH: resolveAugmentedPath(),
        LOCAL_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
        LOCAL_STUDIO_MODELS_DIR: path.join(DESKTOP_CONFIG.userDataDir, "models"),
        LOCAL_STUDIO_RESOURCES_PATH: process.resourcesPath,
        LOCAL_STUDIO_BUNDLED_CHROMIUM_PATH: process.execPath,
        LOCAL_STUDIO_BROWSER_HOST_SCRIPT: browserHostEntry(),
        LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || app.getPath("home"),
        LOCAL_STUDIO_FRONTEND_BASE: options.frontendUrl,
      },
    },
  );

  child.stdout?.on("data", (chunk: Buffer | string) => {
    log.info(`controller: ${String(chunk).trim()}`);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    log.warn(`controller: ${String(chunk).trim()}`);
  });
  child.once("exit", (code, signal) => {
    log.warn(`Controller exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  currentController = child;
  try {
    await waitForController(child, url, DESKTOP_CONFIG.startupTimeoutMs);
    return { frontendUrl: options.frontendUrl, process: child, url };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

export async function startOrReuseController(
  options: StartControllerOptions,
  existing?: ControllerHandle,
): Promise<ControllerHandle> {
  if (existing?.frontendUrl === options.frontendUrl && (await isControllerHealthy(existing.url))) {
    log.info(`Reusing controller at ${existing.url}`);
    return existing;
  }
  if (existing) await stopController(existing);
  return startController(options);
}

export async function stopController(handle?: ControllerHandle): Promise<void> {
  if (!handle?.process) return;
  await stopChild(handle.process);
  if (currentController === handle.process) currentController = null;
}

export function releaseController(handle?: ControllerHandle): void {
  const child = handle?.process;
  if (!child) return;
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
  if (currentController === child) currentController = null;
  handle.process = undefined;
}
