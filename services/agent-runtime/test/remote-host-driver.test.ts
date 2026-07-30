import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RemoteProvisioningProfile } from "../src/remote-provisioning-contract";
import { ProductionRemoteHostDriver } from "../src/remote-host-driver";
import { RemoteProcessError, runProcess } from "../src/remote-process";
import { RemoteProvisioningError } from "../src/remote-provisioning-validation";

const fixture = path.resolve(import.meta.dir, "fixtures/remote-ssh-fixture.mjs");
const boundaryFixture = path.resolve(import.meta.dir, "fixtures/boundary-fixture.mjs");
const checksum = `sha256:${createHash("sha256").update("{}").digest("hex")}`;
const originalCapture = process.env.REMOTE_FIXTURE_CAPTURE;
const originalDigest = process.env.REMOTE_FIXTURE_DIGEST;
const originalMode = process.env.REMOTE_FIXTURE_MODE;
const originalBoundaryCapture = process.env.BOUNDARY_FIXTURE_CAPTURE;
const originalFetch = globalThis.fetch;
let temporary: string | undefined;

const profile = (): RemoteProvisioningProfile => ({
  version: 1,
  classification: "C2",
  machineId: "tensorprime-01",
  accessProfileId: "access-01",
  applianceId: "cortaix-factory",
  access: {
    kind: "direct-ssh",
    sshTarget: "scientist@tensorprime",
    knownHostsPath: "/tmp/pinned-known-hosts",
    hostKeyAlias: "tensorprime",
    credentialRef: "keyring:ssh/tensorprime",
  },
  release: {
    root: "/opt/local-studio/releases",
    id: "release-01",
    manifest: "{}",
    checksum,
    services: ["local-studio-agent"],
  },
  agentRoot: "/etc/local-studio/agents",
  netbird: null,
  inference: {
    baseUrl: "https://api.tprime.vlans.ca",
    modelId: "qwen3-next-80b-a3b-nvfp4",
    credentialRef: "keyring:inference/tensorprime",
  },
  agents: [],
});

afterEach(async () => {
  if (originalCapture === undefined) delete process.env.REMOTE_FIXTURE_CAPTURE;
  else process.env.REMOTE_FIXTURE_CAPTURE = originalCapture;
  if (originalDigest === undefined) delete process.env.REMOTE_FIXTURE_DIGEST;
  else process.env.REMOTE_FIXTURE_DIGEST = originalDigest;
  if (originalMode === undefined) delete process.env.REMOTE_FIXTURE_MODE;
  else process.env.REMOTE_FIXTURE_MODE = originalMode;
  if (originalBoundaryCapture === undefined) delete process.env.BOUNDARY_FIXTURE_CAPTURE;
  else process.env.BOUNDARY_FIXTURE_CAPTURE = originalBoundaryCapture;
  globalThis.fetch = originalFetch;
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

test("process runner uses argv and stdin without a shell", async () => {
  const secret = "stdin-only-secret";
  const result = await runProcess({
    file: process.execPath,
    args: ["-e", "process.stdin.pipe(process.stdout)", "literal;$(false)"],
    stdin: secret,
  });
  expect(result.stdout).toBe(secret);
});

test("process runner enforces timeout and combined output cap", async () => {
  await expect(
    runProcess({
      file: process.execPath,
      args: ["-e", "setTimeout(()=>{},10000)"],
      timeoutMs: 20,
    }),
  ).rejects.toThrow("timed out");
  await expect(
    runProcess({
      file: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(4096))"],
      maxOutputBytes: 32,
    }),
  ).rejects.toBeInstanceOf(RemoteProcessError);
});

test("direct SSH pins host identity and keeps payload off argv", async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "remote-driver-"));
  const capture = path.join(temporary, "capture.json");
  await chmod(fixture, 0o755);
  process.env.REMOTE_FIXTURE_CAPTURE = capture;
  process.env.REMOTE_FIXTURE_DIGEST = checksum;
  const driver = new ProductionRemoteHostDriver({ sshBinary: fixture });
  const connection = await driver.connect(profile(), "not-used");
  const captured = JSON.parse(await readFile(capture, "utf8")) as {
    argv: string[];
    stdin: string;
  };
  expect(captured.argv).toContain("BatchMode=yes");
  expect(captured.argv).toContain("StrictHostKeyChecking=yes");
  expect(captured.argv).toContain("UserKnownHostsFile=/tmp/pinned-known-hosts");
  expect(captured.argv).toContain("HostKeyAlias=tensorprime");
  expect(captured.argv.join(" ")).not.toContain("not-used");
  expect(JSON.parse(captured.stdin)).toMatchObject({ op: "inspect" });
  expect(connection.hostKeyVerified).toBe(true);
  await driver.close(connection);
});

test("host-key rejection fails closed with a governed error", async () => {
  await chmod(fixture, 0o755);
  process.env.REMOTE_FIXTURE_MODE = "host-key";
  const driver = new ProductionRemoteHostDriver({ sshBinary: fixture });
  await expect(driver.connect(profile(), "")).rejects.toEqual(
    expect.objectContaining<Partial<RemoteProvisioningError>>({
      status: 409,
      message: "Pinned remote host-key verification failed",
    }),
  );
});

test("fixed remote operations activate atomically, restore, and reject duplicate staging", async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "remote-atomic-"));
  await chmod(fixture, 0o755);
  process.env.REMOTE_FIXTURE_MODE = "passthrough";
  const releaseRoot = path.join(temporary, "releases");
  const agentRoot = path.join(temporary, "agents");
  await mkdir(releaseRoot, { recursive: true });
  await mkdir(agentRoot, { recursive: true });
  const input = {
    ...profile(),
    release: { ...profile().release, root: releaseRoot },
    agentRoot,
  };
  const driver = new ProductionRemoteHostDriver({ sshBinary: fixture });
  const connection = await driver.connect(input, "");
  const staged = await driver.stageRelease(input, connection);
  await driver.activateRelease(input, connection, staged.path);
  expect(await readlink(path.join(releaseRoot, "current"))).toBe(staged.path);
  await expect(driver.stageRelease(input, connection)).rejects.toBeInstanceOf(RemoteProcessError);
  await driver.restoreRelease(input, connection, {
    kind: "release",
    id: input.release.id,
    path: staged.path,
    previousRelease: null,
    ownership: "created",
  });
  await expect(readlink(path.join(releaseRoot, "current"))).rejects.toThrow();
  await driver.close(connection);
});

test("fixed config operation creates, backs up, and restores content", async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "remote-config-"));
  await chmod(fixture, 0o755);
  process.env.REMOTE_FIXTURE_MODE = "passthrough";
  const agentRoot = path.join(temporary, "agents");
  const configPath = path.join(agentRoot, "pi.json");
  await mkdir(agentRoot, { recursive: true });
  await writeFile(configPath, "before");
  const input = { ...profile(), agentRoot };
  const driver = new ProductionRemoteHostDriver({ sshBinary: fixture });
  const connection = await driver.connect(input, "");
  const mutation = await driver.applyAgentConfig(input, connection, {
    id: "pi-primary",
    agentId: "pi",
    configPath,
    content: "after",
    credentialRefs: [],
  });
  expect(mutation.operation).toBe("updated");
  expect(await readFile(configPath, "utf8")).toBe("after");
  await driver.restoreAgentConfig(input, connection, {
    kind: "agent-config",
    id: "pi-primary",
    path: configPath,
    backupRef: mutation.backupRef,
    beforeDigest: mutation.beforeDigest,
    afterDigest: mutation.afterDigest,
    ownership: "updated",
  });
  expect(await readFile(configPath, "utf8")).toBe("before");
  await driver.close(connection);
});

test("Boundary authorizes the target, passes only authz material on stdin, and cancels", async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "remote-boundary-"));
  const capture = path.join(temporary, "boundary.json");
  await chmod(fixture, 0o755);
  await chmod(boundaryFixture, 0o755);
  process.env.BOUNDARY_FIXTURE_CAPTURE = capture;
  process.env.REMOTE_FIXTURE_DIGEST = checksum;
  const requests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.includes(":authorize-session")) {
      return Response.json({
        authorization_token: "authz-stdin-only",
        session_id: "s_fixture01",
      });
    }
    if (url.endsWith("/v1/sessions/s_fixture01")) {
      return Response.json({ item: { version: 2, status: "active" } });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const direct = profile();
  const input: RemoteProvisioningProfile = {
    ...direct,
    access: {
      kind: "boundary",
      controllerUrl: "https://boundary.example.test",
      scopeId: "p_scope01",
      targetId: "tssh_fixture01",
      knownHostsPath: direct.access.knownHostsPath,
      hostKeyAlias: "tssh_fixture01",
      credentialRef: direct.access.credentialRef,
    },
  };
  const driver = new ProductionRemoteHostDriver({
    sshBinary: fixture,
    boundaryBinary: boundaryFixture,
  });
  const connection = await driver.connect(input, "boundary-login-token");
  const captured = JSON.parse(await readFile(capture, "utf8")) as {
    argv: string[];
    stdin: string;
  };
  expect(captured.argv).not.toContain("-target-id");
  expect(captured.argv).toContain("-authz-token");
  expect(captured.stdin).toBe("authz-stdin-only");
  expect(captured.argv.join(" ")).not.toContain("boundary-login-token");
  await driver.close(connection);
  expect(requests).toEqual([
    "https://boundary.example.test/v1/targets/tssh_fixture01:authorize-session",
    "https://boundary.example.test/v1/sessions/s_fixture01",
    "https://boundary.example.test/v1/sessions/s_fixture01:cancel",
  ]);
});
