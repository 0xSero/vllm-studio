import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import type {
  EnterpriseAuthConfig,
  NormalizedPrincipal,
} from "@local-studio/contracts/enterprise-auth";
import { createEnterpriseSession, getEnterpriseSession } from "../src/lib/auth/enterprise-session";
import { withEnterpriseStateLease } from "../src/lib/auth/enterprise-state-store";

const directory = mkdtempSync(join(tmpdir(), "enterprise-session-distributed-"));
const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
const previousSessionKey = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
const previousSessionKeys = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
process.env.LOCAL_STUDIO_DATA_DIR = directory;
process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = "distributed-session-encryption-key";
delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;

const config: EnterpriseAuthConfig = {
  mode: "required_oidc",
  issuers: [],
  session_idle_seconds: 900,
  session_absolute_seconds: 3600,
};

const principal: NormalizedPrincipal = {
  subject: "distributed-subject",
  issuer: "https://issuer.example.test",
  issuer_id: "issuer",
  tenant: "tenant-1",
  display_name: "Distributed Scientist",
  roles: ["scientist"],
  entitlements: ["notebook:read", "notebook:execute", "ray:admit", "model:invoke", "agent:invoke"],
  clearance: "C2",
  issued_at: Math.floor(Date.now() / 1000) - 600,
  expires_at: Math.floor(Date.now() / 1000) - 1,
};

const workerEnvironment = (): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  delete environment["NODE_TEST_CONTEXT"];
  delete environment["BUN_TEST_RUNNER"];
  return environment;
};

const runWorker = (sessionId: string, countPath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const worker = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./fixtures/enterprise-session-worker.ts", import.meta.url)),
        sessionId,
        countPath,
      ],
      {
        cwd: process.cwd(),
        env: workerEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    worker.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    worker.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Session worker exited with ${code}`));
    });
  });

const crashLeaseOwner = async (scope: string): Promise<void> => {
  const worker = spawn(
    process.execPath,
    [fileURLToPath(new URL("./fixtures/enterprise-lease-owner-worker.ts", import.meta.url)), scope],
    {
      cwd: process.cwd(),
      env: workerEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    worker.stdout?.once("data", (chunk) => {
      if (String(chunk).trim() === "ready") resolve();
      else reject(new Error("Lease owner returned an invalid readiness signal"));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      reject(new Error(`Lease owner exited before readiness with ${code}`));
    });
  });
  const exited = once(worker, "exit");
  worker.kill("SIGKILL");
  await exited;
};

after(() => {
  rmSync(directory, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  if (previousSessionKey === undefined) delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
  else process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = previousSessionKey;
  if (previousSessionKeys === undefined) delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
  else process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = previousSessionKeys;
});

describe("distributed enterprise sessions", () => {
  test("converges refresh across independent processes", async () => {
    const stale = await createEnterpriseSession(principal, "distributed-stale-token", config, {
      refreshToken: "distributed-refresh-token",
    });
    const countPath = join(directory, "distributed-refreshes.log");
    writeFileSync(countPath, "");
    const [first, second] = await Promise.all([
      runWorker(stale.id, countPath),
      runWorker(stale.id, countPath),
    ]);
    const firstResult = JSON.parse(first) as { accessToken: string; sessionId: string };
    const secondResult = JSON.parse(second) as typeof firstResult;
    assert.deepEqual(secondResult, firstResult);
    assert.equal(firstResult.accessToken, "distributed-access-token");
    assert.equal(readFileSync(countPath, "utf8").trim().split("\n").length, 1);
    assert.equal((await getEnterpriseSession(stale.id, config))?.id, firstResult.sessionId);
  });

  test("recovers a stale lease after its owning process is killed", async () => {
    const scope = `crashed-owner:${randomUUID()}`;
    await crashLeaseOwner(scope);
    const digest = createHash("sha256").update(scope, "utf8").digest("hex");
    const lockPath = join(directory, `.enterprise-state-${digest}.lease.lock`);
    assert.equal(existsSync(lockPath), true);
    const stale = new Date(Date.now() - 60_000);
    utimesSync(lockPath, stale, stale);
    let acquired = false;
    await withEnterpriseStateLease(scope, async () => {
      acquired = true;
    });
    assert.equal(acquired, true);
    assert.equal(existsSync(lockPath), false);
  });
});
