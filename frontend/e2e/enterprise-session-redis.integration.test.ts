import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import type {
  EnterpriseAuthConfig,
  NormalizedPrincipal,
} from "@local-studio/contracts/enterprise-auth";
import { createEnterpriseSession, getEnterpriseSession } from "../src/lib/auth/enterprise-session";
import { withEnterpriseStateLease } from "../src/lib/auth/enterprise-state-store";

const directory = mkdtempSync(join(tmpdir(), "enterprise-session-redis-"));
const container = `local-studio-redis-${randomUUID()}`;
const previousEnvironment = {
  dataDir: process.env.LOCAL_STUDIO_DATA_DIR,
  key: process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY,
  keys: process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS,
  store: process.env.LOCAL_STUDIO_ENTERPRISE_STATE_STORE,
  url: process.env.LOCAL_STUDIO_ENTERPRISE_REDIS_URL,
  namespace: process.env.LOCAL_STUDIO_ENTERPRISE_REDIS_NAMESPACE,
};
let stopped = false;

const config: EnterpriseAuthConfig = {
  mode: "required_oidc",
  issuers: [],
  session_idle_seconds: 900,
  session_absolute_seconds: 3600,
};

const principal: NormalizedPrincipal = {
  subject: "redis-subject",
  issuer: "https://issuer.example.test",
  issuer_id: "issuer",
  tenant: "tenant-1",
  display_name: "Redis Scientist",
  roles: ["scientist"],
  entitlements: ["notebook:read", "notebook:execute", "ray:admit", "model:invoke", "agent:invoke"],
  clearance: "C2",
  issued_at: Math.floor(Date.now() / 1000) - 600,
  expires_at: Math.floor(Date.now() / 1000) - 1,
};

const command = (...arguments_: string[]): string => {
  const result = spawnSync(arguments_[0], arguments_.slice(1), { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};

const redis = (...arguments_: string[]): string =>
  command("docker", "exec", container, "redis-cli", ...arguments_);

const runWorker = (path: URL, arguments_: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const environment = { ...process.env };
    delete environment["NODE_TEST_CONTEXT"];
    delete environment["BUN_TEST_RUNNER"];
    const worker = spawn(process.execPath, [fileURLToPath(path), ...arguments_], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    worker.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    worker.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Redis worker exited with ${code}`));
    });
  });

before(async () => {
  command(
    "docker",
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "-p",
    "127.0.0.1::6379",
    "redis:8-alpine",
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
  );
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = spawnSync("docker", ["exec", container, "redis-cli", "PING"], {
      encoding: "utf8",
    });
    if (result.status === 0 && result.stdout.trim() === "PONG") {
      ready = true;
      break;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (!ready) throw new Error("Redis fixture did not become ready");
  const mapping = command("docker", "port", container, "6379/tcp");
  const port = mapping.slice(mapping.lastIndexOf(":") + 1);
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
  process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = "redis-session-encryption-key-material";
  delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
  process.env.LOCAL_STUDIO_ENTERPRISE_STATE_STORE = "redis";
  process.env.LOCAL_STUDIO_ENTERPRISE_REDIS_URL = `redis://127.0.0.1:${port}`;
  process.env.LOCAL_STUDIO_ENTERPRISE_REDIS_NAMESPACE = "redis-integration";
});

after(() => {
  if (!stopped) spawnSync("docker", ["rm", "-f", container]);
  rmSync(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnvironment)) {
    const environmentKey = {
      dataDir: "LOCAL_STUDIO_DATA_DIR",
      key: "LOCAL_STUDIO_ENTERPRISE_SESSION_KEY",
      keys: "LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS",
      store: "LOCAL_STUDIO_ENTERPRISE_STATE_STORE",
      url: "LOCAL_STUDIO_ENTERPRISE_REDIS_URL",
      namespace: "LOCAL_STUDIO_ENTERPRISE_REDIS_NAMESPACE",
    }[key]!;
    if (value === undefined) delete process.env[environmentKey];
    else process.env[environmentKey] = value;
  }
});

describe("Redis enterprise sessions", () => {
  test("coordinates refresh and back-channel logout across independent processes", async () => {
    const stale = await createEnterpriseSession(principal, "redis-stale-token", config, {
      refreshToken: "redis-refresh-token",
      oidcSessionId: "redis-sid",
    });
    const countPath = join(directory, "redis-refreshes.log");
    writeFileSync(countPath, "");
    const worker = new URL("./fixtures/enterprise-session-worker.ts", import.meta.url);
    const [first, second] = await Promise.all([
      runWorker(worker, [stale.id, countPath]),
      runWorker(worker, [stale.id, countPath]),
    ]);
    const firstResult = JSON.parse(first) as { accessToken: string; sessionId: string };
    assert.deepEqual(JSON.parse(second), firstResult);
    assert.equal(readFileSync(countPath, "utf8").trim().split("\n").length, 1);
    assert.equal((await getEnterpriseSession(stale.id, config))?.id, firstResult.sessionId);
    const logoutWorker = new URL("./fixtures/enterprise-session-logout-worker.ts", import.meta.url);
    const logoutArguments = [
      principal.issuer,
      principal.issuer_id,
      principal.subject,
      "redis-sid",
      "redis-logout-jti",
    ];
    const logoutResults = await Promise.all([
      runWorker(logoutWorker, logoutArguments),
      runWorker(logoutWorker, logoutArguments),
    ]);
    const logouts = logoutResults.map(
      (result) => JSON.parse(result) as { deleted: number; replayed: boolean },
    );
    assert.deepEqual(
      logouts.sort((left, right) => Number(left.replayed) - Number(right.replayed)),
      [
        { deleted: 1, replayed: false },
        { deleted: 0, replayed: true },
      ],
    );
    assert.equal(await getEnterpriseSession(stale.id, config), null);
    const serialized = redis("GET", "redis-integration:{enterprise-state}:records:v1");
    assert.equal(serialized.includes("redis-stale-token"), false);
    assert.equal(serialized.includes("redis-refresh-token"), false);
    assert.equal(serialized.includes("distributed-access-token"), false);
    assert.equal(serialized.includes("distributed-refresh-token"), false);
    assert.equal(serialized.includes("distributed-id-token"), false);
  });

  test("recovers an expired lease and fails closed when Redis is unavailable", async () => {
    const scope = "lease-recovery";
    const digest = createHash("sha256").update(scope, "utf8").digest("hex");
    redis("SET", `redis-integration:{enterprise-state}:lease:${digest}`, "other-owner", "PX", "50");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
    let acquired = false;
    await withEnterpriseStateLease(scope, async () => {
      acquired = true;
    });
    assert.equal(acquired, true);
    const lostScope = "lease-loss";
    const lostDigest = createHash("sha256").update(lostScope, "utf8").digest("hex");
    await assert.rejects(
      withEnterpriseStateLease(lostScope, async () => {
        redis("DEL", `redis-integration:{enterprise-state}:lease:${lostDigest}`);
      }),
      /ownership was lost/u,
    );
    command("docker", "rm", "-f", container);
    stopped = true;
    await assert.rejects(getEnterpriseSession("unavailable", config));
  });
});
