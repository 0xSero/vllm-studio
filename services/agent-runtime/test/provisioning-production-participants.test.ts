import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { AgentLifecycleController } from "../src/agent-lifecycle-controller";
import {
  agentLifecycleProfileDigest,
  agentTargetDesiredDigest,
  type AgentExecutionTarget,
  type AgentLifecycleProfile,
} from "../src/agent-lifecycle-contract";
import {
  accessFabricProfileDigest,
  defaultAccessFabricProfile,
  getAccessFabricState,
  planAccessFabric,
  saveAccessFabric,
  type AccessFabricTransport,
} from "../src/access-fabric-service";
import { createProvisioningCoordinatorHandlers } from "../src/http/provisioning-coordinator-handlers";
import { productionLocalAgentIntegration } from "../src/local-agent-lifecycle-integration";
import {
  AccessFabricParticipant,
  AgentLifecycleParticipant,
  ControllerMachineParticipant,
  productionProvisioningParticipants,
} from "../src/provisioning-production-participants";
import type { ProvisioningParticipants } from "../src/provisioning-coordinator-service";

let directory = "";
const original = {
  dataDir: process.env.LOCAL_STUDIO_DATA_DIR,
  appliance: process.env.LOCAL_STUDIO_APPLIANCE,
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "provisioning-production-"));
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
  process.env.LOCAL_STUDIO_APPLIANCE = "cortaix-factory";
});

afterEach(async () => {
  if (original.dataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = original.dataDir;
  if (original.appliance === undefined) delete process.env.LOCAL_STUDIO_APPLIANCE;
  else process.env.LOCAL_STUDIO_APPLIANCE = original.appliance;
  await rm(directory, { recursive: true, force: true });
});

const disabledTransport: AccessFabricTransport = {
  probe: async () => {
    throw new Error("provider network must not be called");
  },
  apply: async () => {
    throw new Error("provider network must not be called");
  },
  remove: async () => {
    throw new Error("provider network must not be called");
  },
  cancelBoundarySession: async () => {
    throw new Error("provider network must not be called");
  },
};

const machineBoundary = (planDigest: string, failDeleteOnce = false) => {
  let state = "draft";
  let deleteFailures = failDeleteOnce ? 1 : 0;
  let receipt: null | {
    receipt_id: string;
    machine_id: string;
    plan_digest: string;
  } = null;
  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? "GET";
    calls.push(`${method}:${url.pathname}`);
    if (new Headers(init?.headers).get("authorization") !== "Bearer controller-token") {
      return Response.json({ detail: "Unauthorized" }, { status: 401 });
    }
    if (method === "PATCH") {
      const body = JSON.parse(String(init?.body)) as { state: string };
      const allowed: Record<string, string> = {
        draft: "probed",
        probed: "admitted",
        admitted: "configured",
      };
      if (allowed[state] !== body.state) {
        return Response.json({ detail: "invalid transition" }, { status: 400 });
      }
      state = body.state;
    } else if (method === "POST" && url.pathname.endsWith("/apply")) {
      if (state !== "configured") {
        return Response.json({ detail: "not configured" }, { status: 409 });
      }
      state = "active";
      receipt = {
        receipt_id: "machine-receipt",
        machine_id: "local-host",
        plan_digest: planDigest,
      };
    } else if (method === "DELETE" && deleteFailures > 0) {
      deleteFailures -= 1;
      return Response.json({ detail: "fixture rollback interruption" }, { status: 500 });
    } else if (method === "DELETE") {
      state = "revoked";
    }
    return Response.json({
      machine: {
        profile: { machine_id: "local-host" },
        state,
        plan_digest: planDigest,
        receipt,
        recovery_required: false,
      },
    });
  };
  return { fetcher, calls, state: () => state };
};

const request = (pathname: string, method = "GET", body?: unknown) =>
  new Request(`http://127.0.0.1:8081${pathname}`, {
    method,
    headers: {
      Authorization: "Bearer lifecycle-token",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("production provisioning participants", () => {
  test("routes every remote lifecycle phase to the remote participant set", async () => {
    const calls: string[] = [];
    const remote: ProvisioningParticipants = {
      machine: {
        setup: async (spec) => {
          calls.push("machine");
          return { receiptId: "machine", machineId: spec.id, planDigest: spec.planDigest };
        },
        reconcile: async (_spec, binding) => binding,
        offboard: async () => undefined,
        recover: async () => undefined,
      },
      access: {
        setup: async (spec) => {
          calls.push("access");
          return { receiptId: "access", ...spec };
        },
        reconcile: async (_spec, binding) => binding,
        offboard: async () => undefined,
        recover: async () => undefined,
      },
      agents: {
        setup: async (spec) => {
          calls.push("agents");
          return { receiptId: "agents", profileDigest: spec.profileDigest, targets: spec.targets };
        },
        reconcile: async (_spec, binding) => binding,
        offboard: async () => undefined,
        recover: async () => undefined,
      },
    };
    const participants = productionProvisioningParticipants({ remote });
    await participants.machine.setup({
      id: "remote-host",
      locality: "remote",
      planDigest: "sha256:remote",
      accessRefIds: ["remote-access"],
      agentRefIds: ["remote-agent"],
    });
    await participants.access.setup({
      locality: "remote",
      profileId: "remote-access",
      machineId: "remote-host",
      profileDigest: "sha256:remote",
      planDigest: "sha256:remote",
    });
    await participants.agents.setup({
      locality: "remote",
      profileDigest: "sha256:remote",
      targets: [],
    });
    expect(calls).toEqual(["machine", "access", "agents"]);
  });

  test("deterministically migrates a v1 access profile identity without changing its digest", async () => {
    const legacy = defaultAccessFabricProfile("2026-07-28T00:00:00.000Z");
    delete legacy.profileId;
    legacy.machine = { id: "legacy-host", sshTarget: "legacy@127.0.0.1" };
    const before = accessFabricProfileDigest(legacy);
    await writeFile(
      path.join(directory, "access-fabric.json"),
      JSON.stringify({
        profile: legacy,
        probes: [],
        plan: null,
        receipt: null,
        recovery: null,
      }),
      { mode: 0o600 },
    );
    const migrated = await Effect.runPromise(getAccessFabricState());
    expect(migrated.profile.profileId).toBe("access:legacy-host");
    expect(accessFabricProfileDigest(migrated.profile)).toBe(before);
    expect(await readFile(path.join(directory, "access-fabric.json"), "utf8")).toContain(
      '"profileId": "access:legacy-host"',
    );
  });

  test("runs authenticated machine, access, and real local agent lifecycle end to end", async () => {
    const machinePlanDigest = `sha256:${"1".repeat(64)}`;
    const machine = machineBoundary(machinePlanDigest);
    const accessProfile = {
      ...defaultAccessFabricProfile("2026-07-28T00:00:00.000Z"),
      profileId: "access:local-host",
      machine: { id: "local-host", sshTarget: "local@127.0.0.1" },
    };
    await Effect.runPromise(saveAccessFabric({ profile: accessProfile }));
    const accessState = await Effect.runPromise(planAccessFabric());
    const home = path.join(directory, "home");
    const config = path.join(home, ".pi", "agent", "models.json");
    await mkdir(path.dirname(config), { recursive: true });
    await writeFile(config, '{"sentinel":"pi"}\n', { mode: 0o600 });
    const target: AgentExecutionTarget = {
      id: "local-host:pi",
      agentId: "pi",
      machineId: "local-host",
      accessProfileId: "access:local-host",
      mode: "local",
      executionHome: home,
      inferenceEndpoint: "http://127.0.0.1:3000/api/agent/onboarding/inference/v1",
      credentialRef: "keyring:runtime:inference",
      modelId: "qwen3-next-80b-a3b-nvfp4",
      contextWindow: 32768,
      capabilities: ["config.read", "config.write", "config.restore", "inference.invoke"],
    };
    const agentProfile: AgentLifecycleProfile = {
      version: 2,
      classification: "C2",
      targets: [target],
      updatedAt: "2026-07-28T00:00:00.000Z",
    };
    const integration = productionLocalAgentIntegration();
    const agentController = new AgentLifecycleController(integration);
    await agentController.plan({
      profile: agentProfile,
      locality: {
        machineId: "unused",
        accessProfileId: "unused",
        executionHome: "/unused",
        inferenceEndpoint: "http://127.0.0.1/v1",
        credentialRef: "keyring:unused",
      },
    });
    const participants = productionProvisioningParticipants({
      machine: new ControllerMachineParticipant(
        "http://127.0.0.1:8080",
        "controller-token",
        machine.fetcher,
      ),
      access: new AccessFabricParticipant(disabledTransport),
      agents: new AgentLifecycleParticipant(agentController, integration),
    });
    const coordinatorProfile = {
      version: 1 as const,
      classification: "C2" as const,
      applianceId: "cortaix-factory" as const,
      machine: {
        id: "local-host",
        locality: "local" as const,
        planDigest: machinePlanDigest,
        accessRefIds: ["access:local-host"],
        agentRefIds: ["local-host:pi"],
      },
      access: {
        locality: "local" as const,
        profileId: "access:local-host",
        machineId: "local-host",
        profileDigest: accessFabricProfileDigest(accessProfile),
        planDigest: accessState.plan!.digest,
      },
      agents: {
        locality: "local" as const,
        profileDigest: agentLifecycleProfileDigest(agentProfile),
        targets: [
          {
            id: target.id,
            machineId: target.machineId,
            accessProfileId: target.accessProfileId,
            desiredDigest: agentTargetDesiredDigest(target),
          },
        ],
      },
    };
    const handlers = createProvisioningCoordinatorHandlers(
      participants,
      () => "lifecycle-token",
      directory,
    );
    const setup = await handlers.setup(
      request("/api/provisioning/setup", "POST", coordinatorProfile),
    );
    expect(setup.status).toBe(200);
    const active = await setup.json();
    expect(active.phase).toBe("active");
    expect(active.receipt.machine.receiptId).toBe("machine-receipt");
    expect(active.receipt.access.profileId).toBe("access:local-host");
    expect(active.receipt.agents.targets[0].id).toBe("local-host:pi");
    expect(await readFile(config, "utf8")).toContain("qwen3-next-80b-a3b-nvfp4");

    const restarted = createProvisioningCoordinatorHandlers(
      productionProvisioningParticipants({
        machine: new ControllerMachineParticipant(
          "http://127.0.0.1:8080",
          "controller-token",
          machine.fetcher,
        ),
        access: new AccessFabricParticipant(disabledTransport),
        agents: new AgentLifecycleParticipant(
          new AgentLifecycleController(integration),
          integration,
        ),
      }),
      () => "lifecycle-token",
      directory,
    );
    expect((await restarted.get(request("/api/provisioning"))).status).toBe(200);
    expect((await restarted.reconcile(request("/api/provisioning/reconcile", "POST"))).status).toBe(
      200,
    );
    expect((await restarted.offboard(request("/api/provisioning", "DELETE"))).status).toBe(200);
    expect(machine.state()).toBe("revoked");
    expect(await readFile(config, "utf8")).toBe('{"sentinel":"pi"}\n');
    expect((await Effect.runPromise(getAccessFabricState())).receipt).toBeNull();
    expect(machine.calls).toEqual([
      "GET:/machines/local-host",
      "PATCH:/machines/local-host/state",
      "PATCH:/machines/local-host/state",
      "PATCH:/machines/local-host/state",
      "POST:/machines/local-host/apply",
      "POST:/machines/local-host/reconcile",
      "GET:/machines/local-host",
      "DELETE:/machines/local-host",
    ]);
  });

  test("persists interrupted compensation and recovers through production participants", async () => {
    const machinePlanDigest = `sha256:${"6".repeat(64)}`;
    const machine = machineBoundary(machinePlanDigest, true);
    const accessProfile = {
      ...defaultAccessFabricProfile("2026-07-28T00:00:00.000Z"),
      profileId: "access:local-host",
      machine: { id: "local-host", sshTarget: "local@127.0.0.1" },
    };
    await Effect.runPromise(saveAccessFabric({ profile: accessProfile }));
    const accessState = await Effect.runPromise(planAccessFabric());
    const home = path.join(directory, "home");
    const outside = path.join(directory, "outside");
    await mkdir(home, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(home, ".pi"));
    const target: AgentExecutionTarget = {
      id: "local-host:pi",
      agentId: "pi",
      machineId: "local-host",
      accessProfileId: "access:local-host",
      mode: "local",
      executionHome: home,
      inferenceEndpoint: "http://127.0.0.1:3000/api/agent/onboarding/inference/v1",
      credentialRef: "keyring:runtime:inference",
      modelId: "qwen3-next-80b-a3b-nvfp4",
      contextWindow: 32768,
      capabilities: ["config.read", "config.write", "config.restore", "inference.invoke"],
    };
    const agentProfile: AgentLifecycleProfile = {
      version: 2,
      classification: "C2",
      targets: [target],
      updatedAt: "2026-07-28T00:00:00.000Z",
    };
    const integration = productionLocalAgentIntegration();
    const agentController = new AgentLifecycleController(integration);
    await agentController.plan({
      profile: agentProfile,
      locality: {
        machineId: "unused",
        accessProfileId: "unused",
        executionHome: "/unused",
        inferenceEndpoint: "http://127.0.0.1/v1",
        credentialRef: "keyring:unused",
      },
    });
    const participants = productionProvisioningParticipants({
      machine: new ControllerMachineParticipant(
        "http://127.0.0.1:8080",
        "controller-token",
        machine.fetcher,
      ),
      access: new AccessFabricParticipant(disabledTransport),
      agents: new AgentLifecycleParticipant(agentController, integration),
    });
    const desired = {
      version: 1 as const,
      classification: "C2" as const,
      applianceId: "cortaix-factory" as const,
      machine: {
        id: "local-host",
        locality: "local" as const,
        planDigest: machinePlanDigest,
        accessRefIds: ["access:local-host"],
        agentRefIds: ["local-host:pi"],
      },
      access: {
        locality: "local" as const,
        profileId: "access:local-host",
        machineId: "local-host",
        profileDigest: accessFabricProfileDigest(accessProfile),
        planDigest: accessState.plan!.digest,
      },
      agents: {
        locality: "local" as const,
        profileDigest: agentLifecycleProfileDigest(agentProfile),
        targets: [
          {
            id: target.id,
            machineId: target.machineId,
            accessProfileId: target.accessProfileId,
            desiredDigest: agentTargetDesiredDigest(target),
          },
        ],
      },
    };
    const handlers = createProvisioningCoordinatorHandlers(
      participants,
      () => "lifecycle-token",
      directory,
    );
    expect((await handlers.setup(request("/api/provisioning/setup", "POST", desired))).status).toBe(
      502,
    );
    const failed = await (await handlers.get(request("/api/provisioning"))).json();
    expect(failed.phase).toBe("recovery_required");
    expect(failed.recovery.pending).toEqual([{ participant: "machine", action: "offboard" }]);
    expect((await Effect.runPromise(getAccessFabricState())).receipt).toBeNull();
    const restarted = createProvisioningCoordinatorHandlers(
      productionProvisioningParticipants({
        machine: new ControllerMachineParticipant(
          "http://127.0.0.1:8080",
          "controller-token",
          machine.fetcher,
        ),
        access: new AccessFabricParticipant(disabledTransport),
        agents: new AgentLifecycleParticipant(
          new AgentLifecycleController(integration),
          integration,
        ),
      }),
      () => "lifecycle-token",
      directory,
    );
    expect((await restarted.recover(request("/api/provisioning/recover", "POST"))).status).toBe(
      200,
    );
    expect(machine.state()).toBe("revoked");
  });
});
