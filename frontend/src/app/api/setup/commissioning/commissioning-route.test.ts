import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { NextRequest } from "next/server";
import { GET, POST, PUT } from "./route";
import type {
  SetupCommissioningProfile,
  SetupCommissioningSave,
} from "@local-studio/contracts/setup-commissioning";

let directory = "";
let server: Server | null = null;
const original = {
  dataDir: process.env.LOCAL_STUDIO_DATA_DIR,
  nodeEnv: process.env.NODE_ENV,
  allowlist: process.env.LOCAL_STUDIO_SETUP_PROBE_ALLOWLIST,
  token: process.env.LOCAL_STUDIO_FRONTEND_TOKEN,
};

const request = (method = "GET", body?: unknown, headers?: HeadersInit) =>
  new NextRequest("http://localhost/api/setup/commissioning", {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const saveInput = (profile: SetupCommissioningProfile): SetupCommissioningSave => ({
  revision: profile.revision,
  requirements: profile.requirements,
  oidc: {
    enabled: profile.oidc.enabled,
    kind: profile.oidc.kind,
    issuer: profile.oidc.issuer,
    client_id: profile.oidc.client_id,
    audience: profile.oidc.audience,
    tenant_or_realm: profile.oidc.tenant_or_realm,
  },
  tensorprime_probes: profile.tensorprime_probes.map(({ probe: _probe, ...entry }) => entry),
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "setup-commissioning-"));
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
  Reflect.set(process.env, "NODE_ENV", "test");
  process.env.LOCAL_STUDIO_SETUP_PROBE_ALLOWLIST = "127.0.0.1";
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve())),
    );
    server = null;
  }
  await rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(original)) {
    const name =
      key === "dataDir"
        ? "LOCAL_STUDIO_DATA_DIR"
        : key === "nodeEnv"
          ? "NODE_ENV"
          : key === "allowlist"
            ? "LOCAL_STUDIO_SETUP_PROBE_ALLOWLIST"
            : "LOCAL_STUDIO_FRONTEND_TOKEN";
    if (value === undefined) delete process.env[name];
    else Reflect.set(process.env, name, value);
  }
});

describe("setup commissioning route", () => {
  test("fails closed for a shared deployment without enterprise OIDC", async () => {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.LOCAL_STUDIO_FRONTEND_TOKEN = "route-token";
    assert.equal((await GET(request())).status, 503);
  });

  test("persists only schema-approved metadata with revision conflict protection", async () => {
    const initial = (await (await GET(request())).json()) as SetupCommissioningProfile;
    assert.equal(initial.tensorprime_probes.length, 4);
    const input = saveInput(initial);
    const [first, second] = await Promise.all([
      PUT(request("PUT", input)),
      PUT(request("PUT", input)),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const content = await (await GET(request())).text();
    assert.equal(content.includes("api_key"), false);
    assert.equal(
      (await stat(path.join(directory, "setup-commissioning.json"))).mode & 0o777,
      0o600,
    );
  });

  test("rejects excess secret fields, embedded credentials, and oversized bodies", async () => {
    const initial = (await (await GET(request())).json()) as SetupCommissioningProfile;
    const input = saveInput(initial);
    assert.equal(
      (await PUT(request("PUT", { ...input, api_key: "must-not-be-accepted" }))).status,
      400,
    );
    const embedded = {
      ...input,
      tensorprime_probes: input.tensorprime_probes.map((entry, index) =>
        index === 0 ? { ...entry, base_url: "http://user:secret@127.0.0.1" } : entry,
      ),
    };
    assert.equal((await PUT(request("PUT", embedded))).status, 400);
    const insecureIssuer = {
      ...input,
      oidc: {
        ...input.oidc,
        enabled: true,
        issuer: "http://login.example.com",
        client_id: "client",
        audience: "audience",
      },
    };
    assert.equal((await PUT(request("PUT", insecureIssuer))).status, 400);
    assert.equal(
      (await PUT(request("PUT", {}, { "content-length": String(64 * 1024 + 1) }))).status,
      400,
    );
  });

  test("probes an allowlisted route and records redirect denial as contradicted evidence", async () => {
    server = createServer((incoming, response) => {
      if (incoming.url === "/redirect") {
        response.writeHead(302, { location: "http://127.0.0.1/private" }).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "model" }] }));
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    const initial = (await (await GET(request())).json()) as SetupCommissioningProfile;
    const baseInput = saveInput(initial);
    const input = {
      ...baseInput,
      tensorprime_probes: baseInput.tensorprime_probes.map((entry) =>
        entry.id === "api"
          ? {
              ...entry,
              base_url: `http://127.0.0.1:${address.port}`,
              host_header: "",
              probe_path: "/v1/models",
            }
          : entry,
      ),
    };
    assert.equal((await PUT(request("PUT", input))).status, 200);
    const observed = (await (
      await POST(request("POST", { target: "api" }))
    ).json()) as SetupCommissioningProfile;
    assert.equal(
      observed.tensorprime_probes.find(({ id }) => id === "api")?.probe.state,
      "observed",
    );
    const redirectBase = saveInput(observed);
    const redirectedInput = {
      ...redirectBase,
      tensorprime_probes: redirectBase.tensorprime_probes.map((entry) =>
        entry.id === "api" ? { ...entry, probe_path: "/redirect" } : entry,
      ),
    };
    assert.equal((await PUT(request("PUT", redirectedInput))).status, 200);
    const contradicted = (await (
      await POST(request("POST", { target: "api" }))
    ).json()) as SetupCommissioningProfile;
    assert.equal(
      contradicted.tensorprime_probes.find(({ id }) => id === "api")?.probe.state,
      "contradicted",
    );
  });
});
