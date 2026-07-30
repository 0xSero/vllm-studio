import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { OAuthVault } from "./oauth-vault";
import type { AccessFabricTransport } from "./access-fabric-service";
import {
  AccessFabricError,
  applyAccessFabric,
  cancelAccessFabricBoundarySession,
  defaultAccessFabricProfile,
  getAccessFabricState,
  offboardAccessFabric,
  planAccessFabric,
  probeAccessFabric,
  saveAccessFabric,
} from "./access-fabric-service";

let directory = "";
let events: string[] = [];
const secrets = new Map<string, string>();

const vault: OAuthVault = {
  read: (key) => Effect.succeed(secrets.get(key)),
  write: (key, value) => Effect.sync(() => void secrets.set(key, value)),
  remove: (key) => Effect.sync(() => void secrets.delete(key)),
};

const profile = () => ({
  ...defaultAccessFabricProfile("2026-07-28T12:00:00.000Z"),
  machine: { id: "tensorprime-01", sshTarget: "scientist@tensorprime" },
  netbird: {
    ...defaultAccessFabricProfile().netbird,
    enabled: true,
    sourceGroupId: "grp_scientists",
    machineGroupId: "grp_tensorprime",
  },
  boundary: {
    ...defaultAccessFabricProfile().boundary,
    enabled: true,
    controllerUrl: "https://boundary.example.test",
    scopeId: "p_science",
    targetIds: ["tssh_tensorprime"],
  },
});

const transport = (options?: { unsafe?: boolean; failBoundary?: boolean }): AccessFabricTransport => ({
  async probe(provider) {
    events.push(`probe:${provider}`);
    return { status: `${provider}:200`, policySafe: !options?.unsafe };
  },
  async apply(provider, _profile, owner) {
    if (provider === "netbird") {
      events.push("netbird:create-one-off-key");
      events.push("machine:enroll-peer");
      events.push("netbird:delete-setup-key");
      return [{ provider, kind: "peer", id: "peer_tensorprime", owner, lifecycle: "created" }];
    }
    if (options?.failBoundary) throw new Error("boundary unavailable");
    events.push("boundary:bind-target:tssh_tensorprime");
    return [
      {
        provider,
        kind: "target-binding",
        id: "tssh_tensorprime",
        owner,
        lifecycle: "created",
      },
    ];
  },
  async remove(resource) {
    events.push(`remove:${resource.provider}:${resource.id}`);
  },
  async cancelBoundarySession(sessionId) {
    events.push(`cancel:${sessionId}`);
  },
});

const run = <A>(effect: Effect.Effect<A, AccessFabricError>) => Effect.runPromise(effect);

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "access-fabric-"));
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
  process.env.LOCAL_STUDIO_ACCESS_FABRIC_HOSTS = "boundary.example.test";
  process.env.LOCAL_STUDIO_APPLIANCE = "cortaix-factory";
  events = [];
  secrets.clear();
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function configured(fixture = transport()) {
  await run(
    saveAccessFabric(
      {
        profile: profile(),
        credentials: [
          { ref: "vault:access:netbird", value: "netbird-secret" },
          { ref: "vault:access:boundary", value: "boundary-secret" },
        ],
      },
      vault,
    ),
  );
  await run(probeAccessFabric("netbird", fixture, vault));
  await run(probeAccessFabric("boundary", fixture, vault));
  await run(planAccessFabric());
}

describe("access fabric lifecycle", () => {
  it("orders ephemeral enrollment cleanup and persists only references and digests", async () => {
    const fixture = transport();
    await configured(fixture);
    const applied = await run(applyAccessFabric(fixture, vault));
    assert.deepEqual(events, [
      "probe:netbird",
      "probe:boundary",
      "netbird:create-one-off-key",
      "machine:enroll-peer",
      "netbird:delete-setup-key",
      "boundary:bind-target:tssh_tensorprime",
    ]);
    assert.deepEqual(applied.receipt?.resources.map((resource) => resource.id), [
      "peer_tensorprime",
      "tssh_tensorprime",
    ]);
    const persisted = await readFile(path.join(directory, "access-fabric.json"), "utf8");
    assert.equal(persisted.includes("netbird-secret"), false);
    assert.equal(persisted.includes("boundary-secret"), false);
    await run(applyAccessFabric(fixture, vault));
    assert.equal(events.filter((event) => event === "machine:enroll-peer").length, 1);
  });

  it("rejects permissive policy observations and stale probes", async () => {
    await run(saveAccessFabric({ profile: profile() }, vault));
    const unsafe = transport({ unsafe: true });
    await run(probeAccessFabric("netbird", unsafe, vault));
    await assert.rejects(run(planAccessFabric()), /Fresh safe probes required/);
    const safe = transport();
    await run(probeAccessFabric("netbird", safe, vault));
    await run(probeAccessFabric("boundary", safe, vault));
    await run(planAccessFabric());
    const file = path.join(directory, "access-fabric.json");
    const state = JSON.parse(await readFile(file, "utf8")) as {
      probes: Array<{ checkedAt: string }>;
    };
    state.probes.forEach((probe) => {
      probe.checkedAt = "2020-01-01T00:00:00.000Z";
    });
    await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    await assert.rejects(run(applyAccessFabric(safe, vault)), /Fresh safe probes required/);
  });

  it("rejects non-C2 appliances, unapproved hosts, and duplicate credential refs", async () => {
    process.env.LOCAL_STUDIO_APPLIANCE = "local-studio";
    await assert.rejects(
      run(saveAccessFabric({ profile: profile() }, vault)),
      /requires a C2 appliance profile/,
    );
    process.env.LOCAL_STUDIO_APPLIANCE = "cortaix-factory";
    process.env.LOCAL_STUDIO_ACCESS_FABRIC_HOSTS = "";
    await assert.rejects(
      run(saveAccessFabric({ profile: profile() }, vault)),
      /host is not allowed/,
    );
    process.env.LOCAL_STUDIO_ACCESS_FABRIC_HOSTS = "boundary.example.test";
    await assert.rejects(
      run(
        saveAccessFabric(
          {
            profile: profile(),
            credentials: [
              { ref: "vault:access:netbird", value: "first" },
              { ref: "vault:access:netbird", value: "second" },
            ],
          },
          vault,
        ),
      ),
      /must be unique/,
    );
  });

  it("rolls back in reverse and makes offboarding idempotent", async () => {
    const failing = transport({ failBoundary: true });
    await configured(failing);
    await assert.rejects(run(applyAccessFabric(failing, vault)), /boundary unavailable/);
    assert.equal(events.at(-1), "remove:netbird:peer_tensorprime");
    const fixture = transport();
    await run(probeAccessFabric("boundary", fixture, vault));
    await run(planAccessFabric());
    await run(applyAccessFabric(fixture, vault));
    events = [];
    await run(offboardAccessFabric(fixture, vault));
    assert.deepEqual(events, [
      "remove:boundary:tssh_tensorprime",
      "remove:netbird:peer_tensorprime",
    ]);
    await run(offboardAccessFabric(fixture, vault));
    assert.equal(events.length, 2);
    assert.equal((await run(getAccessFabricState())).receipt, null);
  });

  it("does not delete provider references and cancels only exact session identifiers", async () => {
    const fixture = transport();
    fixture.apply = async (provider, _profile, owner) => [
      {
        provider,
        kind: "existing-reference",
        id: provider === "netbird" ? "peer_existing" : "tssh_tensorprime",
        owner,
        lifecycle: "reference",
      },
    ];
    await configured(fixture);
    await run(applyAccessFabric(fixture, vault));
    events = [];
    await run(offboardAccessFabric(fixture, vault));
    assert.deepEqual(events, []);
    await configured(transport());
    await run(applyAccessFabric(transport(), vault));
    events = [];
    await assert.rejects(
      run(cancelAccessFabricBoundarySession("../sessions", fixture, vault)),
      /Invalid Boundary session ID/,
    );
    await run(cancelAccessFabricBoundarySession("s_ABC123", fixture, vault));
    assert.deepEqual(events, ["cancel:s_ABC123"]);
  });
});
