import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type {
  RemoteOwnedResource,
  RemoteProvisioningProfile,
  RemoteProvisioningState,
} from "../src/remote-provisioning-contract";
import {
  ProductionRemoteProvisioningAdapter,
  type RemoteHostDriver,
} from "../src/remote-provisioning-adapters";
import {
  RemoteProvisioningError,
  RemoteProvisioningService,
  validateRemoteProvisioningProfile,
  validateRemoteProvisioningState,
  type RemoteConnection,
  type RemoteProvisioningAdapter,
  type RemoteProvisioningStore,
  type RemoteProvisioningVault,
} from "../src/remote-provisioning-service";

const checksum = `sha256:${"a".repeat(64)}`;

const profile = (access: "direct-ssh" | "boundary" = "direct-ssh"): RemoteProvisioningProfile => ({
  version: 1,
  classification: "C2",
  machineId: "tensorprime-01",
  accessProfileId: "access:tensorprime-01",
  applianceId: "cortaix-factory",
  access:
    access === "direct-ssh"
      ? {
          kind: "direct-ssh",
          sshTarget: "scientist@tensorprime",
          knownHostsPath: "/etc/local-studio/known_hosts",
          hostKeyAlias: "tensorprime",
          credentialRef: "keyring:ssh:tensorprime",
        }
      : {
          kind: "boundary",
          controllerUrl: "https://boundary.example.test",
          scopeId: "p_cortaix",
          targetId: "tssh_TENSORPRIME",
          knownHostsPath: "/etc/local-studio/known_hosts",
          hostKeyAlias: "hst_01",
          credentialRef: "keyring:boundary:cortaix",
        },
  release: {
    root: "/opt/local-studio/releases",
    id: "release-20260728",
    manifest: '{"version":1}',
    checksum,
    services: ["local-studio-controller", "local-studio-agent-runtime"],
  },
  agentRoot: "/home/scientist",
  netbird: {
    managementUrl: "https://netbird.example.test",
    machineGroupId: "group_tensorprime",
    credentialRef: "keyring:netbird:cortaix",
  },
  inference: {
    baseUrl: "https://api.tprime.vlans.ca",
    modelId: "qwen3-next-80b-a3b-nvfp4",
    credentialRef: "keyring:inference:tensorprime",
  },
  agents: [
    {
      id: "tensorprime-01:pi",
      agentId: "pi",
      configPath: "/home/scientist/.pi/agent/models.json",
      content: '{"provider":"tensorprime"}',
      credentialRefs: ["keyring:inference:tensorprime"],
    },
  ],
});

class MemoryStore implements RemoteProvisioningStore {
  value: RemoteProvisioningState = {
    version: 1,
    profile: null,
    receipt: null,
    recovery: null,
    updatedAt: new Date(0).toISOString(),
  };

  async read() {
    return structuredClone(this.value);
  }

  async write(value: RemoteProvisioningState) {
    this.value = structuredClone(value);
  }
}

const vault: RemoteProvisioningVault = {
  async read(ref) {
    return `credential-for:${ref}`;
  },
};

class FakeAdapter implements RemoteProvisioningAdapter {
  events: string[] = [];
  fail = "";
  setupKey = "";
  activeRelease: string | null = null;
  configDigest: string | null = null;

  async inspect() {
    return {
      releaseId: this.activeRelease,
      releaseDigest: this.activeRelease ? checksum : null,
      agentDigests: { "tensorprime-01:pi": this.configDigest },
      services: { "local-studio-controller": Boolean(this.activeRelease) },
    };
  }

  async createNetbirdSetupKey() {
    this.events.push("netbird:key:create");
    this.setupKey = "one-off-material";
    return { id: "key_01", key: this.setupKey };
  }

  async enrollNetbird(_profile: RemoteProvisioningProfile, setupKey: string) {
    expect(setupKey).toBe(this.setupKey);
    this.events.push("netbird:enroll:stdin");
    if (this.fail.includes("enroll")) throw new Error("enrollment unavailable");
  }

  async observeNetbirdPeer() {
    this.events.push("netbird:peer:observe");
    return { id: "peer_owned", created: true };
  }

  async verifyNetbirdPeer() {
    this.events.push("netbird:peer:verify");
  }

  async deleteNetbirdSetupKey() {
    this.events.push("netbird:key:delete");
    if (this.fail.includes("delete-key")) throw new Error("key deletion unavailable");
    this.setupKey = "";
  }

  async deleteNetbirdPeer() {
    this.events.push("netbird:peer:delete");
  }

  async connect(profileValue: RemoteProvisioningProfile) {
    this.events.push(`${profileValue.access.kind}:connect`);
    return {
      kind: profileValue.access.kind === "boundary" ? "boundary" : "direct-ssh",
      id: "connection-01",
      hostKeyVerified: true,
      knownHostsPath: profileValue.access.knownHostsPath,
      hostKeyAlias: profileValue.access.hostKeyAlias,
      ...(profileValue.access.kind === "boundary" ? { sessionId: "s_SESSION01" } : {}),
    } as RemoteConnection;
  }

  async close(connection: RemoteConnection) {
    this.events.push(`${connection.kind}:close`);
    return {
      closed: true,
      ...(connection.kind === "boundary" ? { sessionCancelled: true } : {}),
    };
  }

  async cancelBoundarySession(
    _profile: RemoteProvisioningProfile,
    _credential: string,
    sessionId: string,
  ) {
    this.events.push(`boundary:cancel:${sessionId}`);
  }

  async stageRelease() {
    this.events.push("release:stage");
    return {
      path: "/opt/local-studio/releases/release-20260728",
      previousRelease: "/opt/local-studio/releases/previous",
      digest: checksum,
    };
  }

  async activateRelease() {
    this.events.push("release:activate");
    this.activeRelease = "release-20260728";
  }

  async restoreRelease() {
    this.events.push("release:restore");
    this.activeRelease = null;
  }

  async applyAgentConfig() {
    this.events.push("agent:backup-atomic-write");
    this.configDigest = `sha256:${"b".repeat(64)}`;
    return {
      path: "/home/scientist/.pi/agent/models.json",
      backupRef: "/home/scientist/.pi/agent/models.json.backup",
      beforeDigest: `sha256:${"c".repeat(64)}`,
      afterDigest: this.configDigest,
      operation: "updated" as const,
    };
  }

  async restoreAgentConfig() {
    this.events.push("agent:restore");
    if (this.fail.includes("restore-agent")) throw new Error("restore unavailable");
    this.configDigest = null;
  }

  async restartServices() {
    this.events.push("services:restart-owned");
  }

  async probe(profileValue: RemoteProvisioningProfile) {
    this.events.push("health:models:inference");
    if (this.fail.includes("probe")) throw new Error("probe unavailable");
    return { models: [profileValue.inference.modelId], fingerprint: "fp_qwen3" };
  }
}

describe("remote provisioning transaction", () => {
  test("applies, reports status, closes access, deletes the setup key, and offboards in reverse", async () => {
    const store = new MemoryStore();
    const adapter = new FakeAdapter();
    const service = new RemoteProvisioningService(store, vault, adapter);
    const applied = await service.apply(profile("boundary"));
    expect(applied.receipt?.boundarySessionId).toBe("s_SESSION01");
    expect(applied.receipt?.observedModels).toEqual(["qwen3-next-80b-a3b-nvfp4"]);
    expect(adapter.setupKey).toBe("");
    expect(adapter.events).toEqual([
      "boundary:connect",
      "netbird:key:create",
      "netbird:enroll:stdin",
      "netbird:peer:observe",
      "netbird:key:delete",
      "release:stage",
      "agent:backup-atomic-write",
      "release:activate",
      "services:restart-owned",
      "health:models:inference",
      "boundary:close",
    ]);
    const again = await service.apply(profile("boundary"));
    expect(again.receipt?.id).toBe(applied.receipt?.id);
    const status = await service.status();
    expect(status.inspection?.releaseId).toBe("release-20260728");
    await service.offboard();
    expect(adapter.events.slice(-5)).toEqual([
      "boundary:connect",
      "agent:restore",
      "release:restore",
      "netbird:peer:delete",
      "boundary:close",
    ]);
    expect(store.value.receipt).toBeNull();
  });

  test("rolls back partial apply and persists only failed inverse work", async () => {
    const store = new MemoryStore();
    const adapter = new FakeAdapter();
    adapter.fail = "probe";
    const service = new RemoteProvisioningService(store, vault, adapter);
    await expect(service.apply(profile())).rejects.toBeInstanceOf(RemoteProvisioningError);
    expect(adapter.events).toContain("agent:restore");
    expect(adapter.events).toContain("release:restore");
    expect(adapter.events).toContain("netbird:peer:delete");
    expect(adapter.events).toContain("netbird:key:delete");
    expect(store.value.recovery).toBeNull();

    const failingStore = new MemoryStore();
    const failing = new FakeAdapter();
    failing.fail = "probe+restore-agent";
    const failingService = new RemoteProvisioningService(failingStore, vault, failing);
    await expect(failingService.apply(profile())).rejects.toMatchObject({ status: 500 });
    expect(failingStore.value.recovery?.pending.some((item) => item.kind === "agent-config")).toBe(
      true,
    );
    expect(JSON.stringify(failingStore.value)).not.toContain("one-off-material");
    failing.fail = "";
    await failingService.recover();
    expect(failingStore.value.recovery).toBeNull();
  });

  test("journals a setup key before enrollment and retains only failed key cleanup", async () => {
    const rolledBackStore = new MemoryStore();
    const rolledBack = new FakeAdapter();
    rolledBack.fail = "enroll";
    await expect(
      new RemoteProvisioningService(rolledBackStore, vault, rolledBack).apply(profile()),
    ).rejects.toMatchObject({ status: 409 });
    expect(rolledBack.events.filter((event) => event === "netbird:key:delete")).toHaveLength(1);
    expect(rolledBackStore.value.recovery).toBeNull();

    const recoveryStore = new MemoryStore();
    const recoveryAdapter = new FakeAdapter();
    recoveryAdapter.fail = "enroll+delete-key";
    const service = new RemoteProvisioningService(recoveryStore, vault, recoveryAdapter);
    await expect(service.apply(profile())).rejects.toMatchObject({ status: 500 });
    expect(recoveryStore.value.recovery?.pending).toEqual([
      { kind: "netbird-setup-key", id: "key_01", ownership: "created" },
    ]);
    expect(JSON.stringify(recoveryStore.value)).not.toContain("one-off-material");
    recoveryAdapter.fail = "";
    await service.recover();
    expect(recoveryStore.value.recovery).toBeNull();
  });

  test("rejects raw secrets, unpinned access, invalid refs, and non-HTTPS providers", () => {
    expect(() =>
      validateRemoteProvisioningProfile({
        ...profile(),
        apiKey: "raw-secret",
      }),
    ).toThrow("profile.apiKey is forbidden");
    expect(() =>
      validateRemoteProvisioningProfile({
        ...profile(),
        access: { ...profile().access, knownHostsPath: "", hostKeyAlias: "" },
      }),
    ).toThrow("known_hosts path");
    expect(() =>
      validateRemoteProvisioningProfile({
        ...profile(),
        inference: { ...profile().inference, baseUrl: "http://api.example.test" },
      }),
    ).toThrow("HTTPS");
    expect(() =>
      validateRemoteProvisioningProfile({
        ...profile(),
        agents: [
          {
            ...profile().agents[0],
            configPath: "/home/scientist/../root/config.json",
          },
        ],
      }),
    ).toThrow("contained");
  });

  test("rejects forged receipt lineage before offboard can delete resources", async () => {
    const store = new MemoryStore();
    const adapter = new FakeAdapter();
    const service = new RemoteProvisioningService(store, vault, adapter);
    await service.apply(profile());
    const forged = structuredClone(store.value);
    const release = forged.receipt?.resources.find((resource) => resource.kind === "release");
    if (release?.kind === "release") release.path = "/opt/other/release";
    expect(() => validateRemoteProvisioningState(forged)).toThrow("contained");
    store.value = forged;
    await expect(service.offboard()).rejects.toThrow("contained");
    expect(adapter.events).not.toContain("release:restore");
  });
});

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

test("production NetBird adapter creates one-off keys, observes a unique grouped peer, and deletes owned resources", async () => {
  const calls: Array<{ method: string; url: string; body: string }> = [];
  let peerVisible = false;
  server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    calls.push({ method: request.method ?? "", url: request.url ?? "", body });
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/api/peers") {
      response.end(JSON.stringify([]));
      return;
    }
    if (request.method === "GET" && request.url === "/api/groups/group_tensorprime") {
      response.end(
        JSON.stringify({
          id: "group_tensorprime",
          peers: peerVisible ? [{ id: "peer_created", name: "tensorprime-01" }] : [],
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/api/setup-keys") {
      peerVisible = true;
      response.end(JSON.stringify({ id: "setup_01", key: "KEY-MATERIAL" }));
      return;
    }
    response.statusCode = 204;
    response.end();
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const managementUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const host: RemoteHostDriver = {
    inspect: async () => ({
      releaseId: null,
      releaseDigest: null,
      agentDigests: {},
      services: {},
    }),
    connect: async (profileValue) => ({
      kind: "direct-ssh",
      id: "local",
      hostKeyVerified: true,
      knownHostsPath: profileValue.access.knownHostsPath,
      hostKeyAlias: profileValue.access.hostKeyAlias,
    }),
    close: async () => ({ closed: true }),
    cancelBoundarySession: async () => undefined,
    enrollNetbird: async () => undefined,
    stageRelease: async () => ({
      path: "/tmp/release",
      previousRelease: null,
      digest: checksum,
    }),
    activateRelease: async () => undefined,
    restoreRelease: async () => undefined,
    applyAgentConfig: async () => ({
      path: "/tmp/agent",
      operation: "created",
      afterDigest: checksum,
    }),
    restoreAgentConfig: async () => undefined,
    restartServices: async () => undefined,
    probe: async () => ({ models: [], fingerprint: "" }),
  };
  const adapter = new ProductionRemoteProvisioningAdapter(host, {
    allowTestLoopback: true,
  });
  const input = {
    ...profile(),
    netbird: { ...profile().netbird!, managementUrl },
  };
  const setup = await adapter.createNetbirdSetupKey(input, "pat");
  expect(setup.key).toBe("KEY-MATERIAL");
  expect(JSON.parse(calls[1]!.body)).toMatchObject({
    type: "one-off",
    expires_in: 86400,
    usage_limit: 1,
    auto_groups: ["group_tensorprime"],
  });
  expect(await adapter.observeNetbirdPeer(input, "pat")).toEqual({
    id: "peer_created",
    created: true,
  });
  await adapter.deleteNetbirdSetupKey(input, "pat", setup.id);
  await adapter.deleteNetbirdPeer(input, "pat", "peer_created");
  expect(calls.slice(-2).map((entry) => `${entry.method} ${entry.url}`)).toEqual([
    "DELETE /api/setup-keys/setup_01",
    "DELETE /api/peers/peer_created",
  ]);
});
