import { app } from "electron";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import { DESKTOP_CONFIG, resolveStandaloneBaseDir, resolveStaticAssetsSource } from "../configs";
import type { DesktopServerRuntime } from "../types";
import { log } from "../helpers/logger";
import { registerOAuthVault } from "./oauth-vault";
import { resolveStablePort } from "../helpers/ports";
import { resolveAugmentedPath } from "../helpers/resolve-path";

export type AgentRuntimeHandle = {
  frontendUrl: string;
  process?: ChildProcess;
  url: string;
};

export interface ServerHandle {
  agentRuntimeExitListener?: () => void;
  agentRuntime: AgentRuntimeHandle;
  runtime: DesktopServerRuntime;
  process?: ChildProcess;
}

type ServerExitDetails = {
  code: number | null;
  signal: NodeJS.Signals | null;
  pid?: number;
};

type StartFrontendServerOptions = {
  agentRuntime?: AgentRuntimeHandle;
  port?: number;
  onExit?: (details: ServerExitDetails) => void;
};

type StopFrontendServerOptions = {
  stopAgentRuntime?: boolean;
};

type ServiceProbe = {
  intervalMs: number;
  ready: () => Promise<boolean>;
  timeoutMessage: string;
};

const ownedChildren = new Set<ChildProcess>();
let currentEmbeddedServer: ChildProcess | null = null;

process.once("exit", () => {
  for (const child of ownedChildren) {
    if (!child.killed) child.kill("SIGTERM");
  }
});

function superviseChild(
  child: ChildProcess,
  label: string,
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void,
): ChildProcess {
  ownedChildren.add(child);
  child.stdout?.on("data", (chunk: Buffer | string) =>
    log.info(`${label}: ${String(chunk).trim()}`),
  );
  child.stderr?.on("data", (chunk: Buffer | string) =>
    log.warn(`${label}: ${String(chunk).trim()}`),
  );
  child.once("exit", (code, signal) => {
    ownedChildren.delete(child);
    log.warn(`${label} exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    onExit?.(code, signal);
  });
  return child;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPid(pid: number, timeoutMs: number): Promise<void> {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs && isProcessAlive(pid)) await delay(100);
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const pid = child.pid;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const exited = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.off("exit", exited);
      if (pid && isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      resolve();
    }, 5_000);
    child.once("exit", exited);
  });
}

async function waitForService(
  child: ChildProcess,
  timeoutMs: number,
  probe: ServiceProbe,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`${probe.timeoutMessage}; exit=${child.exitCode}`);
    if (await probe.ready()) return;
    await delay(probe.intervalMs);
  }
  throw new Error(probe.timeoutMessage);
}

function embeddedServerPidPath(): string {
  return path.join(DESKTOP_CONFIG.userDataDir, "embedded-frontend.pid");
}

function embeddedServerPortPath(): string {
  return path.join(DESKTOP_CONFIG.userDataDir, "embedded-frontend.port");
}

function readPersistedPort(): number | undefined {
  try {
    const port = Number(readFileSync(embeddedServerPortPath(), "utf8").trim());
    return Number.isInteger(port) && port > 1024 && port <= 65535 ? port : undefined;
  } catch {
    return undefined;
  }
}

function persistPort(port: number): void {
  try {
    mkdirSync(DESKTOP_CONFIG.userDataDir, { recursive: true });
    writeFileSync(embeddedServerPortPath(), String(port));
  } catch {}
}

function writeEmbeddedServerPid(pid: number | undefined): void {
  try {
    mkdirSync(DESKTOP_CONFIG.userDataDir, { recursive: true });
    writeFileSync(embeddedServerPidPath(), String(pid ?? ""));
  } catch {}
}

function clearEmbeddedServerPid(pid: number | undefined): void {
  try {
    if (readFileSync(embeddedServerPidPath(), "utf8") === String(pid ?? "")) {
      rmSync(embeddedServerPidPath(), { force: true });
    }
  } catch {}
}

async function killStaleEmbeddedServer(): Promise<void> {
  const pidFile = embeddedServerPidPath();
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8"));
  rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  await stopPid(pid, 1_500);
}

function resolveStandaloneServerRoot(): string {
  const standaloneBase = resolveStandaloneBaseDir();
  const nestedRoot = path.join(standaloneBase, "frontend");
  return existsSync(path.join(nestedRoot, "server.js")) ? nestedRoot : standaloneBase;
}

function copyDirectory(source: string, target: string): void {
  if (!existsSync(source)) throw new Error(`Missing source directory: ${source}`);
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
}

function agentRuntimeEntry(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app", "agent-runtime", "standalone.mjs")
    : path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "services",
        "agent-runtime",
        "dist",
        "standalone.mjs",
      );
}

async function isAgentRuntimeHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    return (
      ((await response.json()) as { service?: unknown }).service === "local-studio-agent-runtime"
    );
  } catch {
    return false;
  }
}

async function startAgentRuntime(options: {
  frontendUrl: string;
  preferredPort?: number;
}): Promise<AgentRuntimeHandle> {
  const preferredUrl = options.preferredPort ? `http://127.0.0.1:${options.preferredPort}` : null;
  if (preferredUrl && (await isAgentRuntimeHealthy(preferredUrl))) {
    log.info(`Using agent runtime at ${preferredUrl}`);
    return { frontendUrl: options.frontendUrl, url: preferredUrl };
  }
  const entry = agentRuntimeEntry();
  if (!existsSync(entry)) throw new Error(`Missing agent runtime bundle: ${entry}`);
  const port = await resolveStablePort(options.preferredPort);
  const url = `http://127.0.0.1:${port}`;
  const child = superviseChild(
    fork(entry, {
      stdio: "pipe",
      detached: false,
      env: {
        ...process.env,
        PATH: resolveAugmentedPath(),
        PORT: String(port),
        LOCAL_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
        PI_CODING_AGENT_DIR: path.join(DESKTOP_CONFIG.userDataDir, "pi-agent"),
        LOCAL_STUDIO_PROJECTS_FILE: path.join(DESKTOP_CONFIG.userDataDir, "projects.json"),
        LOCAL_STUDIO_RESOURCES_PATH: process.resourcesPath,
        LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || app.getPath("home"),
        LOCAL_STUDIO_FRONTEND_BASE: options.frontendUrl,
      },
    }),
    "agent-runtime",
  );
  try {
    await waitForService(child, DESKTOP_CONFIG.startupTimeoutMs, {
      intervalMs: 200,
      ready: () => isAgentRuntimeHealthy(url),
      timeoutMessage: `Timed out waiting for agent runtime: ${url}`,
    });
    return { frontendUrl: options.frontendUrl, process: child, url };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

async function startOrReuseAgentRuntime(
  options: { frontendUrl: string; preferredPort?: number },
  existing?: AgentRuntimeHandle,
): Promise<AgentRuntimeHandle> {
  if (
    existing?.frontendUrl === options.frontendUrl &&
    (await isAgentRuntimeHealthy(existing.url))
  ) {
    log.info(`Reusing agent runtime at ${existing.url}`);
    return existing;
  }
  if (existing?.process) await stopChild(existing.process);
  return startAgentRuntime(options);
}

async function stopAgentRuntime(handle?: AgentRuntimeHandle): Promise<void> {
  if (handle?.process) await stopChild(handle.process);
}

export async function startFrontendServer(
  options: StartFrontendServerOptions = {},
): Promise<ServerHandle> {
  if (process.env.LOCAL_STUDIO_DESKTOP_DEV_SERVER_URL) {
    const runtime: DesktopServerRuntime = {
      mode: "dev-server",
      port: Number(new URL(DESKTOP_CONFIG.devServerUrl).port || "3000"),
      url: DESKTOP_CONFIG.devServerUrl,
    };
    const agentRuntime = await startOrReuseAgentRuntime(
      { frontendUrl: runtime.url, preferredPort: 8081 },
      options.agentRuntime,
    );
    return { agentRuntime, runtime };
  }
  await killStaleEmbeddedServer();
  const serverRoot = resolveStandaloneServerRoot();
  const serverScript = path.join(serverRoot, "server.js");
  if (!existsSync(serverScript)) {
    throw new Error(`Missing standalone server build: ${serverScript}. Run npm run build first.`);
  }
  const { staticDir, publicDir } = resolveStaticAssetsSource();
  const targetStaticDir = path.join(serverRoot, ".next", "static");
  const targetPublicDir = path.join(serverRoot, "public");
  if (app.isPackaged) {
    if (!existsSync(targetStaticDir))
      throw new Error(`Missing packaged static assets: ${targetStaticDir}`);
    if (!existsSync(targetPublicDir))
      throw new Error(`Missing packaged public assets: ${targetPublicDir}`);
  } else {
    copyDirectory(staticDir, targetStaticDir);
    copyDirectory(publicDir, targetPublicDir);
  }
  const port = await resolveStablePort(options.port ?? readPersistedPort());
  persistPort(port);
  const url = `http://127.0.0.1:${port}`;
  const agentRuntime = await startOrReuseAgentRuntime({ frontendUrl: url }, options.agentRuntime);
  log.info(`Starting embedded frontend server from ${serverScript} on ${url}`);
  const child = fork(serverScript, {
    cwd: serverRoot,
    stdio: "pipe",
    execArgv: ["--network-family-autoselection-attempt-timeout=2000"],
    detached: false,
    env: {
      ...process.env,
      PATH: resolveAugmentedPath(),
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      LOCAL_STUDIO_DESKTOP: "1",
      LOCAL_STUDIO_DATA_DIR: DESKTOP_CONFIG.userDataDir,
      LOCAL_STUDIO_PROJECTS_FILE: path.join(DESKTOP_CONFIG.userDataDir, "projects.json"),
      LOCAL_STUDIO_RESOURCES_PATH: process.resourcesPath,
      LOCAL_STUDIO_AGENT_CWD: process.env.LOCAL_STUDIO_AGENT_CWD || app.getPath("home"),
      LOCAL_STUDIO_AGENT_RUNTIME_URL: agentRuntime.url,
      LOCAL_STUDIO_FRONTEND_BASE: url,
    },
  });
  registerOAuthVault(child, DESKTOP_CONFIG.userDataDir);
  superviseChild(child, "frontend", (code, signal) => {
    clearEmbeddedServerPid(child.pid);
    if (currentEmbeddedServer === child) currentEmbeddedServer = null;
    options.onExit?.({ code, signal, pid: child.pid });
  });
  writeEmbeddedServerPid(child.pid);
  const agentRuntimeExitListener = () => {
    if (currentEmbeddedServer === child && !child.killed) child.kill("SIGTERM");
  };
  agentRuntime.process?.once("exit", agentRuntimeExitListener);
  currentEmbeddedServer = child;
  const handle: ServerHandle = {
    agentRuntime,
    agentRuntimeExitListener,
    process: child,
    runtime: { mode: "embedded-standalone", port, url },
  };
  try {
    await waitForService(child, DESKTOP_CONFIG.startupTimeoutMs, {
      intervalMs: 300,
      ready: async () => {
        try {
          const response = await fetch(url, { redirect: "manual" });
          return response.ok || response.status === 307 || response.status === 308;
        } catch {
          return false;
        }
      },
      timeoutMessage: `Timed out waiting for embedded frontend server: ${url}`,
    });
    return handle;
  } catch (error) {
    await stopFrontendServer(handle, { stopAgentRuntime: agentRuntime !== options.agentRuntime });
    throw error;
  }
}

export async function stopFrontendServer(
  handle?: ServerHandle,
  options: StopFrontendServerOptions = {},
): Promise<void> {
  if (!handle) return;
  if (handle.agentRuntimeExitListener) {
    handle.agentRuntime.process?.off("exit", handle.agentRuntimeExitListener);
  }
  if (handle.process) {
    clearEmbeddedServerPid(handle.process.pid);
    await stopChild(handle.process);
    if (currentEmbeddedServer === handle.process) currentEmbeddedServer = null;
  }
  if (options.stopAgentRuntime !== false) await stopAgentRuntime(handle.agentRuntime);
}
