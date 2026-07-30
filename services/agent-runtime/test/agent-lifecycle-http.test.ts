import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LocalFixtureAgentExecutor,
  localFixtureHome,
  type AgentLifecycleIntegration,
} from "../src/agent-lifecycle-controller";
import type { AgentExecutionTarget, AgentLifecycleProfile } from "../src/agent-lifecycle-contract";
import { AgentTargetApplyError, type AgentTargetExecutor } from "../src/agent-lifecycle-service";
import { createAgentLifecycleHandlers } from "../src/http/agent-lifecycle-handlers";
import { defaultOnboardingProfile } from "../src/agent-onboarding-service";

let dataDir = "";
const token = "integration-token";

const request = (pathValue: string, method = "GET", body?: unknown, bearer = token) =>
  new Request(`http://127.0.0.1:8081${pathValue}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const target = (id: string, machineId: string, executionHome: string): AgentExecutionTarget => ({
  id,
  agentId: "pi",
  machineId,
  accessProfileId: `access:${machineId}`,
  mode: machineId === "local-host" ? "local" : "remote-ssh",
  executionHome,
  inferenceEndpoint:
    machineId === "local-host"
      ? "http://127.0.0.1:3000/api/agent/onboarding/inference/v1"
      : `https://${machineId}.example.test/v1`,
  credentialRef: `keyring:agent:${id}`,
  modelId: "qwen3-next-80b-a3b-nvfp4",
  contextWindow: 131072,
  capabilities: ["config.read", "config.write", "config.restore", "inference.invoke"],
});

const profile = (...targets: AgentExecutionTarget[]): AgentLifecycleProfile => ({
  version: 2,
  classification: "C2",
  targets,
  updatedAt: "2026-07-28T00:00:00.000Z",
});

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "agent-lifecycle-http-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  await writeFile(path.join(dataDir, "api-settings.json"), "{}");
});

afterEach(async () => {
  delete process.env.LOCAL_STUDIO_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("agent lifecycle product API", () => {
  test("requires configured bearer authentication", async () => {
    const unavailable = createAgentLifecycleHandlers(undefined, () => undefined);
    expect((await unavailable.get(request("/api/agent/lifecycle"))).status).toBe(503);
    const handlers = createAgentLifecycleHandlers(undefined, () => token);
    expect(
      (await handlers.get(request("/api/agent/lifecycle", "GET", undefined, "wrong"))).status,
    ).toBe(401);
    expect((await handlers.get(request("/api/agent/lifecycle"))).status).toBe(200);
  });

  test("migrates v1, applies multiple agents, survives restart, reapplies, and revokes", async () => {
    const handlers = createAgentLifecycleHandlers(undefined, () => token);
    const legacy = defaultOnboardingProfile("2026-07-28T00:00:00.000Z");
    legacy.localAgents = ["pi", "opencode"];
    const planResponse = await handlers.plan(
      request("/api/agent/lifecycle/plan", "PUT", {
        profile: legacy,
        locality: {
          machineId: "local-host",
          accessProfileId: "local-loopback",
          executionHome: localFixtureHome(),
          inferenceEndpoint: "http://127.0.0.1:3000/api/agent/onboarding/inference/v1",
          credentialRef: "keyring:agent:local",
        },
      }),
    );
    expect(planResponse.status).toBe(200);
    expect((await planResponse.json()).actions).toEqual([
      "apply:local-host:pi",
      "apply:local-host:opencode",
    ]);
    expect((await handlers.apply(request("/api/agent/lifecycle/apply", "POST"))).status).toBe(200);
    expect(
      (await readdir(localFixtureHome())).filter((entry) => entry.endsWith(".json")),
    ).toHaveLength(2);
    const restarted = createAgentLifecycleHandlers(undefined, () => token);
    const state = await (await restarted.get(request("/api/agent/lifecycle"))).json();
    expect(state.receipt.targets).toHaveLength(2);
    expect(JSON.stringify(state)).not.toContain(token);
    expect(JSON.stringify(state)).not.toContain("local-studio-keyring");
    expect((await restarted.apply(request("/api/agent/lifecycle/apply", "POST"))).status).toBe(200);
    expect((await restarted.revoke(request("/api/agent/lifecycle/apply", "DELETE"))).status).toBe(
      200,
    );
    expect(
      (await readdir(localFixtureHome())).filter((entry) => entry.endsWith(".json")),
    ).toHaveLength(0);
  });

  test("supports independent machine targets through an explicit integration resolver", async () => {
    const integration: AgentLifecycleIntegration = {
      resolve: async () => ({
        machineReady: true,
        accessReady: true,
        executor: new LocalFixtureAgentExecutor(),
      }),
    };
    const handlers = createAgentLifecycleHandlers(integration, () => token);
    const desired = profile(
      target("local:pi", "local-host", path.join(dataDir, "machines", "local")),
      target("remote:pi", "gpu-node", path.join(dataDir, "machines", "remote")),
    );
    const planned = await handlers.plan(
      request("/api/agent/lifecycle/plan", "PUT", {
        profile: desired,
        locality: {
          machineId: "unused",
          accessProfileId: "unused",
          executionHome: "/unused",
          inferenceEndpoint: "http://127.0.0.1/v1",
          credentialRef: "keyring:unused",
        },
      }),
    );
    expect(planned.status).toBe(200);
    const applied = await handlers.apply(request("/api/agent/lifecycle/apply", "POST"));
    expect(applied.status).toBe(200);
    const state = await applied.json();
    expect(state.receipt.targets.map((entry: { machineId: string }) => entry.machineId)).toEqual([
      "local-host",
      "gpu-node",
    ]);
  });

  test("fails closed on unconfigured remote, denied access, and unsafe endpoint credentials", async () => {
    const handlers = createAgentLifecycleHandlers(undefined, () => token);
    const remote = profile(target("remote:pi", "gpu-node", path.join(dataDir, "remote")));
    expect(
      (
        await handlers.plan(
          request("/api/agent/lifecycle/plan", "PUT", {
            profile: remote,
            locality: {
              machineId: "unused",
              accessProfileId: "unused",
              executionHome: "/unused",
              inferenceEndpoint: "http://127.0.0.1/v1",
              credentialRef: "keyring:unused",
            },
          }),
        )
      ).status,
    ).toBe(503);
    const denied = createAgentLifecycleHandlers(
      {
        resolve: async () => ({
          machineReady: true,
          accessReady: false,
          executor: new LocalFixtureAgentExecutor(),
        }),
      },
      () => token,
    );
    expect(
      (
        await denied.plan(
          request("/api/agent/lifecycle/plan", "PUT", {
            profile: remote,
            locality: {
              machineId: "unused",
              accessProfileId: "unused",
              executionHome: "/unused",
              inferenceEndpoint: "http://127.0.0.1/v1",
              credentialRef: "keyring:unused",
            },
          }),
        )
      ).status,
    ).toBe(409);
    const unsafe = profile({
      ...remote.targets[0]!,
      inferenceEndpoint: "https://user:secret@gpu-node.example.test/v1",
    });
    const response = await denied.plan(
      request("/api/agent/lifecycle/plan", "PUT", {
        profile: unsafe,
        locality: {
          machineId: "unused",
          accessProfileId: "unused",
          executionHome: "/unused",
          inferenceEndpoint: "http://127.0.0.1/v1",
          credentialRef: "keyring:unused",
        },
      }),
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });

  test("persists recovery across handler restart and retries it", async () => {
    let restoreFails = true;
    const executor: AgentTargetExecutor = {
      inspect: async () => ({
        desiredDigest: null,
        capabilities: ["config.read", "config.write", "config.restore", "inference.invoke"],
      }),
      apply: async (targetValue, desiredDigest) => {
        const mutation = {
          path: path.join(targetValue.executionHome, "agent.json"),
          operation: "created" as const,
          afterDigest: desiredDigest,
        };
        throw new AgentTargetApplyError("partial failure", [mutation]);
      },
      restore: async () => {
        if (restoreFails) throw new Error("restore failure");
      },
    };
    const integration: AgentLifecycleIntegration = {
      resolve: async () => ({ machineReady: true, accessReady: true, executor }),
    };
    const handlers = createAgentLifecycleHandlers(integration, () => token);
    const desired = profile(target("local:pi", "local-host", path.join(dataDir, "recovery")));
    await handlers.plan(
      request("/api/agent/lifecycle/plan", "PUT", {
        profile: desired,
        locality: {
          machineId: "unused",
          accessProfileId: "unused",
          executionHome: "/unused",
          inferenceEndpoint: "http://127.0.0.1/v1",
          credentialRef: "keyring:unused",
        },
      }),
    );
    expect((await handlers.apply(request("/api/agent/lifecycle/apply", "POST"))).status).toBe(500);
    const restarted = createAgentLifecycleHandlers(integration, () => token);
    const failed = await (await restarted.get(request("/api/agent/lifecycle"))).json();
    expect(failed.recovery.pending).toHaveLength(1);
    restoreFails = false;
    expect((await restarted.recover(request("/api/agent/lifecycle/recover", "POST"))).status).toBe(
      200,
    );
    const recovered = await (await restarted.get(request("/api/agent/lifecycle"))).json();
    expect(recovered.recovery).toBeNull();
  });
});
