import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  agentLifecycleProfileDigest,
  migrateAgentLifecycleProfile,
  type AgentCapability,
  type AgentExecutionTarget,
  type AgentLifecycleProfile,
} from "../src/agent-lifecycle-contract";
import {
  AgentLifecycleError,
  AgentTargetApplyError,
  applyAgentLifecycle,
  recoverAgentLifecycle,
  revokeAgentLifecycle,
  type AgentTargetExecutor,
} from "../src/agent-lifecycle-service";
import { defaultOnboardingProfile } from "../src/agent-onboarding-service";

const allCapabilities: readonly AgentCapability[] = [
  "config.read",
  "config.write",
  "config.restore",
  "inference.invoke",
];

const target = (
  id: string,
  machineId: string,
  mode: "local" | "remote-ssh" = "local",
): AgentExecutionTarget => ({
  id,
  agentId: "pi",
  machineId,
  accessProfileId: `access:${machineId}`,
  mode,
  executionHome: `/home/${machineId}`,
  inferenceEndpoint: `https://${machineId}.example.test/v1`,
  credentialRef: `keyring:agent:${id}`,
  modelId: "qwen3-next-80b-a3b-nvfp4",
  contextWindow: 131072,
  capabilities: [...allCapabilities],
});

const profile = (...targets: AgentExecutionTarget[]): AgentLifecycleProfile => ({
  version: 2,
  classification: "C2",
  targets,
  updatedAt: "2026-07-28T00:00:00.000Z",
});

class MemoryExecutor implements AgentTargetExecutor {
  readonly desired = new Map<string, string>();
  readonly restored: string[] = [];
  failApply = new Set<string>();
  failRestore = new Set<string>();
  partialApply = new Set<string>();
  active = 0;
  maximumActive = 0;
  capabilities: readonly AgentCapability[] = allCapabilities;

  async inspect(targetValue: AgentExecutionTarget) {
    return {
      desiredDigest: this.desired.get(targetValue.id) ?? null,
      capabilities: this.capabilities,
    };
  }

  async apply(targetValue: AgentExecutionTarget, desiredDigest: string) {
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    this.active -= 1;
    const mutation = {
      path: `${targetValue.executionHome}/.pi/agent/models.json`,
      operation: "updated" as const,
      backupRef: `backup:${targetValue.id}`,
      beforeDigest: `sha256:${"a".repeat(64)}`,
      afterDigest: desiredDigest,
    };
    if (this.partialApply.has(targetValue.id)) {
      this.desired.set(targetValue.id, desiredDigest);
      throw new AgentTargetApplyError("injected partial apply failure", [mutation]);
    }
    if (this.failApply.has(targetValue.id)) throw new Error("injected apply failure");
    this.desired.set(targetValue.id, desiredDigest);
    return [mutation];
  }

  async restore(targetValue: AgentExecutionTarget) {
    if (this.failRestore.has(targetValue.id)) throw new Error("injected restore failure");
    this.desired.delete(targetValue.id);
    this.restored.push(targetValue.id);
  }
}

test("deterministically migrates a v1 profile and rejects unknown agents", () => {
  const legacy = defaultOnboardingProfile("2026-07-28T00:00:00.000Z");
  legacy.localAgents = ["pi", "opencode"];
  const locality = {
    machineId: "local-workstation",
    accessProfileId: "access:loopback",
    executionHome: "/Users/scientist",
    inferenceEndpoint: "http://127.0.0.1:3000/api/agent/onboarding/inference/v1",
    credentialRef: "keyring:agent:local",
  };
  const first = migrateAgentLifecycleProfile(legacy, locality);
  const second = migrateAgentLifecycleProfile(legacy, locality);
  expect(first).toEqual(second);
  expect(first.targets.map((entry) => entry.id)).toEqual([
    "local-workstation:pi",
    "local-workstation:opencode",
  ]);
  legacy.localAgents = ["unknown"];
  expect(() => migrateAgentLifecycleProfile(legacy, locality)).toThrow(
    'Unknown local agent "unknown"',
  );
});

describe("agent lifecycle transaction", () => {
  test("applies independent local and remote targets and is idempotent", async () => {
    const executor = new MemoryExecutor();
    const desired = profile(
      target("local:pi", "workstation"),
      target("remote:pi", "gpu-node", "remote-ssh"),
    );
    const first = await Effect.runPromise(applyAgentLifecycle(desired, () => executor));
    expect(first.targets.map((entry) => [entry.targetId, entry.status])).toEqual([
      ["local:pi", "applied"],
      ["remote:pi", "applied"],
    ]);
    const second = await Effect.runPromise(applyAgentLifecycle(desired, () => executor, first));
    expect(second.targets.every((entry) => entry.status === "applied")).toBe(true);
    expect(second.targets.every((entry) => entry.mutations.length === 1)).toBe(true);
    expect(new Set(first.targets.map((entry) => entry.machineId))).toEqual(
      new Set(["workstation", "gpu-node"]),
    );
    expect(JSON.stringify(first)).not.toContain("secret");
    await Effect.runPromise(revokeAgentLifecycle(desired, second, () => executor));
    expect(executor.desired.size).toBe(0);
  });

  test("denies an executor missing a profile capability before mutation", async () => {
    const executor = new MemoryExecutor();
    executor.capabilities = ["config.read", "config.write"];
    const error = await Effect.runPromise(
      applyAgentLifecycle(
        profile(target("remote:pi", "gpu-node", "remote-ssh")),
        () => executor,
      ).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(AgentLifecycleError);
    expect(error.status).toBe(403);
    expect(executor.desired.size).toBe(0);
  });

  test("rolls back earlier machines when a later apply fails", async () => {
    const executor = new MemoryExecutor();
    executor.failApply.add("remote:pi");
    const error = await Effect.runPromise(
      applyAgentLifecycle(
        profile(target("local:pi", "workstation"), target("remote:pi", "gpu-node", "remote-ssh")),
        () => executor,
      ).pipe(Effect.flip),
    );
    expect(error.status).toBe(409);
    expect(error.recovery).toBeNull();
    expect(executor.restored).toEqual(["local:pi"]);
  });

  test("rolls back mutations reported by a partially failed executor", async () => {
    const executor = new MemoryExecutor();
    executor.partialApply.add("remote:pi");
    const error = await Effect.runPromise(
      applyAgentLifecycle(
        profile(target("remote:pi", "gpu-node", "remote-ssh")),
        () => executor,
      ).pipe(Effect.flip),
    );
    expect(error.status).toBe(409);
    expect(executor.restored).toEqual(["remote:pi"]);
    expect(executor.desired.size).toBe(0);
  });

  test("persists scoped recovery evidence and retries only pending restoration", async () => {
    const executor = new MemoryExecutor();
    executor.failApply.add("remote:pi");
    executor.failRestore.add("local:pi");
    const desired = profile(
      target("local:pi", "workstation"),
      target("remote:pi", "gpu-node", "remote-ssh"),
    );
    const failed = await Effect.runPromise(
      applyAgentLifecycle(desired, () => executor).pipe(Effect.flip),
    );
    expect(failed.recovery?.pending.map((entry) => entry.targetId)).toEqual(["local:pi"]);
    expect(failed.recovery?.profileDigest).toBe(agentLifecycleProfileDigest(desired));
    expect(JSON.stringify(failed.recovery)).not.toContain("injected");
    executor.failRestore.clear();
    await Effect.runPromise(recoverAgentLifecycle(desired, failed.recovery!, () => executor));
    expect(executor.restored).toContain("local:pi");
  });

  test("revoke is receipt-scoped and rejects another profile", async () => {
    const executor = new MemoryExecutor();
    const desired = profile(target("remote:pi", "gpu-node", "remote-ssh"));
    const receipt = await Effect.runPromise(applyAgentLifecycle(desired, () => executor));
    const changed = profile(target("other:pi", "other-node", "remote-ssh"));
    const denied = await Effect.runPromise(
      revokeAgentLifecycle(changed, receipt, () => executor).pipe(Effect.flip),
    );
    expect(denied.status).toBe(409);
    expect(executor.desired.has("remote:pi")).toBe(true);
    await Effect.runPromise(revokeAgentLifecycle(desired, receipt, () => executor));
    expect(executor.desired.has("remote:pi")).toBe(false);
  });

  test("serializes concurrent lifecycle mutations", async () => {
    const executor = new MemoryExecutor();
    const first = profile(target("first:pi", "first-node", "remote-ssh"));
    const second = profile(target("second:pi", "second-node", "remote-ssh"));
    await Promise.all([
      Effect.runPromise(applyAgentLifecycle(first, () => executor)),
      Effect.runPromise(applyAgentLifecycle(second, () => executor)),
    ]);
    expect(executor.maximumActive).toBe(1);
  });

  test("canonicalizes target and capability ordering in profile digests", () => {
    const first = target("first:pi", "first-node");
    const second = target("second:pi", "second-node");
    const reordered = {
      ...first,
      capabilities: [...first.capabilities].reverse(),
    };
    expect(agentLifecycleProfileDigest(profile(first, second))).toBe(
      agentLifecycleProfileDigest(profile(second, reordered)),
    );
  });

  test("rejects duplicate machine-agent bindings and excess profile fields", () => {
    const duplicate = profile(target("first:pi", "first-node"), target("second:pi", "first-node"));
    expect(() =>
      migrateAgentLifecycleProfile(duplicate, {
        machineId: "unused",
        accessProfileId: "unused",
        executionHome: "/unused",
        inferenceEndpoint: "http://127.0.0.1/v1",
        credentialRef: "keyring:unused",
      }),
    ).toThrow("binding must be unique");
    expect(() =>
      migrateAgentLifecycleProfile(
        { ...profile(target("first:pi", "first-node")), unexpected: true },
        {
          machineId: "unused",
          accessProfileId: "unused",
          executionHome: "/unused",
          inferenceEndpoint: "http://127.0.0.1/v1",
          credentialRef: "keyring:unused",
        },
      ),
    ).toThrow("Unexpected key");
  });

  test("rejects insecure remote endpoints and receipt paths outside execution home", async () => {
    expect(() =>
      migrateAgentLifecycleProfile(
        profile({
          ...target("remote:pi", "gpu-node", "remote-ssh"),
          inferenceEndpoint: "http://gpu-node.example.test/v1",
        }),
        {
          machineId: "unused",
          accessProfileId: "unused",
          executionHome: "/unused",
          inferenceEndpoint: "http://127.0.0.1/v1",
          credentialRef: "keyring:unused",
        },
      ),
    ).toThrow("invalid inference endpoint");
    const executor = new MemoryExecutor();
    const desired = profile(target("remote:pi", "gpu-node", "remote-ssh"));
    const receipt = await Effect.runPromise(applyAgentLifecycle(desired, () => executor));
    receipt.targets[0]!.mutations[0]!.path = "/tmp/escaped";
    const error = await Effect.runPromise(
      revokeAgentLifecycle(desired, receipt, () => executor).pipe(Effect.flip),
    );
    expect(error.status).toBe(409);
  });
});
