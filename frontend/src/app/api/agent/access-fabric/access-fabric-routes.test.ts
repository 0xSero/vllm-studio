import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { GET, PUT } from "./route";
import { POST as probe } from "./probe/route";
import { POST as plan } from "./plan/route";
import { POST as apply, DELETE as offboard } from "./apply/route";

let directory = "";
const original = {
  dataDir: process.env.LOCAL_STUDIO_DATA_DIR,
  nodeEnv: process.env.NODE_ENV,
  token: process.env.LOCAL_STUDIO_FRONTEND_TOKEN,
  appliance: process.env.LOCAL_STUDIO_APPLIANCE,
  hosts: process.env.LOCAL_STUDIO_ACCESS_FABRIC_HOSTS,
};

const request = (pathname: string, method = "GET", body?: unknown, headers?: HeadersInit) =>
  new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const profile = () => ({
  version: 1,
  classification: "C2",
  machine: { id: "tensorprime", sshTarget: "scientist@tensorprime" },
  netbird: {
    enabled: true,
    managementUrl: "https://api.netbird.io",
    sourceGroupId: "grp_scientists",
    machineGroupId: "grp_tensorprime",
    ports: [22],
    credentialRef: "vault:access:netbird",
  },
  boundary: {
    enabled: false,
    controllerUrl: "",
    scopeId: "",
    targetIds: [],
    sessionMaxSeconds: 3600,
    credentialRef: "vault:access:boundary",
  },
  updatedAt: "2026-07-28T00:00:00.000Z",
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "access-fabric-routes-"));
  process.env.LOCAL_STUDIO_APPLIANCE = "cortaix-factory";
  process.env.LOCAL_STUDIO_ACCESS_FABRIC_HOSTS = "";
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  if (original.dataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = original.dataDir;
  if (original.nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", original.nodeEnv);
  if (original.token === undefined) delete process.env.LOCAL_STUDIO_FRONTEND_TOKEN;
  else process.env.LOCAL_STUDIO_FRONTEND_TOKEN = original.token;
  if (original.appliance === undefined) delete process.env.LOCAL_STUDIO_APPLIANCE;
  else process.env.LOCAL_STUDIO_APPLIANCE = original.appliance;
  if (original.hosts === undefined) delete process.env.LOCAL_STUDIO_ACCESS_FABRIC_HOSTS;
  else process.env.LOCAL_STUDIO_ACCESS_FABRIC_HOSTS = original.hosts;
});

describe("access fabric authenticated routes", () => {
  it("rejects a shared production deployment without OIDC", async () => {
    delete process.env.LOCAL_STUDIO_DATA_DIR;
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.LOCAL_STUDIO_FRONTEND_TOKEN = "route-token";
    const response = await GET(request("/api/agent/access-fabric"));
    assert.equal(response.status, 503);
  });

  it("validates input and persists redacted state across route calls", async () => {
    process.env.LOCAL_STUDIO_DATA_DIR = directory;
    const malformed = await PUT(
      request("/api/agent/access-fabric", "PUT", { profile: { classification: "C2" } }),
    );
    assert.equal(malformed.status, 400);
    const saved = await PUT(
      request("/api/agent/access-fabric", "PUT", { profile: profile(), credentials: [] }),
    );
    assert.equal(saved.status, 200);
    const loaded = await GET(request("/api/agent/access-fabric"));
    const body = await loaded.text();
    assert.equal(loaded.status, 200);
    assert.equal(body.includes("tensorprime"), true);
    assert.equal(body.includes("credentialRef"), true);
    assert.equal(body.includes("route-token"), false);
  });

  it("fails closed through probe, plan, apply, and leaves empty offboard idempotent", async () => {
    process.env.LOCAL_STUDIO_DATA_DIR = directory;
    await PUT(request("/api/agent/access-fabric", "PUT", { profile: profile() }));
    assert.equal(
      (await probe(request("/api/agent/access-fabric/probe", "POST", { target: "netbird" })))
        .status,
      401,
    );
    assert.equal((await plan(request("/api/agent/access-fabric/plan", "POST"))).status, 409);
    assert.equal((await apply(request("/api/agent/access-fabric/apply", "POST"))).status, 409);
    assert.equal((await offboard(request("/api/agent/access-fabric/apply", "DELETE"))).status, 200);
  });

  it("runs plan, apply, persisted receipt, and offboard through the route boundary", async () => {
    process.env.LOCAL_STUDIO_DATA_DIR = directory;
    const localProfile = profile();
    localProfile.netbird.enabled = false;
    await PUT(request("/api/agent/access-fabric", "PUT", { profile: localProfile }));
    assert.equal((await plan(request("/api/agent/access-fabric/plan", "POST"))).status, 200);
    const applied = await apply(request("/api/agent/access-fabric/apply", "POST"));
    assert.equal(applied.status, 200);
    assert.notEqual((await applied.json()).receipt, null);
    const persisted = await GET(request("/api/agent/access-fabric"));
    assert.notEqual((await persisted.json()).receipt, null);
    assert.equal((await offboard(request("/api/agent/access-fabric/apply", "DELETE"))).status, 200);
    const cleared = await GET(request("/api/agent/access-fabric"));
    assert.equal((await cleared.json()).receipt, null);
  });
});
