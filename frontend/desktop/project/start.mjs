import { cpSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const frontendRoot = path.resolve(import.meta.dirname, "../..");
const runtimeUrl = (process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL || "http://127.0.0.1:8081").replace(
  /\/+$/,
  "",
);
let agentRuntime;
let server;
let runtimeExitCode = 0;

function copyDirectory(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

async function runtimeHealthy() {
  try {
    const response = await fetch(`${runtimeUrl}/health`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    return (await response.json()).service === "local-studio-agent-runtime";
  } catch {
    return false;
  }
}

async function waitForRuntime(child) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) throw Error(`Agent runtime exited with code ${child.exitCode}`);
    if (await runtimeHealthy()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw Error(`Timed out waiting for agent runtime: ${runtimeUrl}`);
}

async function startRuntime(port) {
  if (await runtimeHealthy()) return null;
  const url = new URL(runtimeUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    throw Error(`Agent runtime is unavailable: ${runtimeUrl}`);
  const entry = path.resolve(
    frontendRoot,
    "..",
    "services",
    "agent-runtime",
    "dist",
    "standalone.mjs",
  );
  if (!existsSync(entry)) throw Error(`Missing agent runtime bundle: ${entry}`);
  const child = spawn(process.execPath, [entry], {
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: url.port || "8081",
      LOCAL_STUDIO_FRONTEND_BASE: `http://127.0.0.1:${port}`,
    },
  });
  try {
    await waitForRuntime(child);
    return child;
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
}

function stopOwnedRuntime() {
  if (agentRuntime?.exitCode === null) agentRuntime.kill("SIGTERM");
}

export async function start() {
  const standaloneRoot = path.resolve(frontendRoot, ".next", "standalone");
  const nestedRoot = path.resolve(standaloneRoot, "frontend");
  const serverRoot = existsSync(nestedRoot) ? nestedRoot : standaloneRoot;
  const port = Number(process.env.PORT || "4783");
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("PORT must be an integer from 1024 through 65535");
  if (!existsSync(standaloneRoot))
    throw Error('Missing ".next/standalone". Run "npm run build" first.');
  copyDirectory(path.resolve(frontendRoot, "public"), path.resolve(serverRoot, "public"));
  copyDirectory(
    path.resolve(frontendRoot, ".next", "static"),
    path.resolve(serverRoot, ".next", "static"),
  );
  agentRuntime = await startRuntime(port);
  server = spawn(process.execPath, ["server.js"], {
    cwd: serverRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
      PORT: String(port),
      LOCAL_STUDIO_AGENT_CWD:
        process.env.LOCAL_STUDIO_AGENT_CWD || path.resolve(frontendRoot, ".."),
      LOCAL_STUDIO_AGENT_RUNTIME_URL: runtimeUrl,
    },
  });
  console.log(`Local Studio: http://127.0.0.1:${port}`);
  server.on("exit", (code) => {
    stopOwnedRuntime();
    process.exit(runtimeExitCode || code || 0);
  });
  agentRuntime?.on("exit", (code) => {
    runtimeExitCode = code || 1;
    if (server.exitCode === null) server.kill("SIGTERM");
  });
  process.on("SIGINT", () => server.kill("SIGINT"));
  process.on("SIGTERM", () => server.kill("SIGTERM"));
}
