import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../../../config/env";
import { delay } from "../../../core/async";
import type { EngineBackend } from "../../shared/system-types";
import { ENGINE_INSTALL_TIMEOUT_MS } from "../configs";

interface EngineInstallLock {
  path: string;
  release: () => void;
}

interface AcquireEngineInstallLockOptions {
  timeoutMs?: number | undefined;
  pollMs?: number | undefined;
  onWait?: ((path: string) => void) | undefined;
  shouldContinue?: (() => boolean) | undefined;
}

const installLockDirectory = (config: Pick<Config, "data_dir">): string =>
  join(config.data_dir, "runtime", "locks");

const installLockPath = (
  config: Pick<Config, "data_dir">,
  backend: EngineBackend,
): string => join(installLockDirectory(config), `${backend}.install.lock`);

const nodeErrorCode = (error: unknown): string | null =>
  error instanceof Error && "code" in error ? String(error.code) : null;

const releaseInstallLock = (path: string): void => {
  try {
    rmSync(path);
  } catch {
  }
};

const tryAcquireInstallLock = (
  config: Pick<Config, "data_dir">,
  backend: EngineBackend,
): EngineInstallLock | null => {
  const path = installLockPath(config, backend);
  mkdirSync(installLockDirectory(config), { recursive: true });
  try {
    writeFileSync(path, JSON.stringify({ backend, pid: process.pid, startedAt: new Date().toISOString() }), { flag: "wx" });
    return { path, release: () => releaseInstallLock(path) };
  } catch (error) {
    if (nodeErrorCode(error) !== "EEXIST") throw error;
    return null;
  }
};

export const acquireEngineInstallLock = async (
  config: Pick<Config, "data_dir">,
  backend: EngineBackend,
  options: AcquireEngineInstallLockOptions = {},
): Promise<EngineInstallLock | null> => {
  const timeoutMs = options.timeoutMs ?? ENGINE_INSTALL_TIMEOUT_MS;
  const pollMs = options.pollMs ?? 3_000;
  const startedAt = Date.now();
  let reportedWait = false;
  while (Date.now() - startedAt < timeoutMs) {
    if (options.shouldContinue && !options.shouldContinue()) return null;
    const lock = tryAcquireInstallLock(config, backend);
    if (lock) return lock;
    if (!reportedWait) {
      reportedWait = true;
      options.onWait?.(installLockPath(config, backend));
    }
    await delay(pollMs);
  }
  return null;
};

export const installLockTimeoutMessage = (backend: EngineBackend, timeoutMs = ENGINE_INSTALL_TIMEOUT_MS): string =>
  `${backend} install lock still present after ${Math.round(timeoutMs / 60_000)} minutes`;
