import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AccessBinding,
  AgentBinding,
  MachineBinding,
  ProvisioningProfile,
} from "../src/provisioning-coordinator-contract";
import { provisioningProfileDigest } from "../src/provisioning-coordinator-contract";
import {
  ProvisioningCoordinator,
  type ProvisioningParticipants,
} from "../src/provisioning-coordinator-service";
import { createProvisioningCoordinatorHandlers } from "../src/http/provisioning-coordinator-handlers";

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const profile = (): ProvisioningProfile => ({
  version: 1,
  classification: "C2",
  applianceId: "cortaix-factory",
  machine: {
    id: "tensorprime",
    locality: "local",
    planDigest: digest("1"),
    accessRefIds: ["access:tensorprime"],
    agentRefIds: ["tensorprime:pi"],
  },
  access: {
    locality: "local",
    profileId: "access:tensorprime",
    machineId: "tensorprime",
    profileDigest: digest("2"),
    planDigest: digest("3"),
  },
  agents: {
    locality: "local",
    profileDigest: digest("4"),
    targets: [
      {
        id: "tensorprime:pi",
        machineId: "tensorprime",
        accessProfileId: "access:tensorprime",
        desiredDigest: digest("5"),
      },
    ],
  },
});

const machineBinding = (): MachineBinding => ({
  receiptId: "machine-receipt",
  machineId: "tensorprime",
  planDigest: digest("1"),
});
const accessBinding = (): AccessBinding => ({
  receiptId: "access-receipt",
  profileId: "access:tensorprime",
  machineId: "tensorprime",
  profileDigest: digest("2"),
  planDigest: digest("3"),
});
const agentBinding = (): AgentBinding => ({
  receiptId: "agent-receipt",
  profileDigest: digest("4"),
  targets: profile().agents.targets,
});

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "provisioning-coordinator-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const participants = (
  calls: string[],
  failure?: string,
  recoveryFailure?: string,
  receiptDrift = false,
): ProvisioningParticipants => {
  const invoke = async <A>(name: string, value?: A): Promise<A> => {
    calls.push(name);
    if (failure === name || recoveryFailure === name) throw new Error(`${name} failed`);
    return value as A;
  };
  return {
    machine: {
      setup: () => invoke("machine.setup", machineBinding()),
      reconcile: () =>
        invoke(
          "machine.reconcile",
          receiptDrift ? { ...machineBinding(), receiptId: "machine-drift" } : machineBinding(),
        ),
      offboard: () => invoke("machine.offboard"),
      recover: () => invoke("machine.recover"),
    },
    access: {
      setup: () => invoke("access.setup", accessBinding()),
      reconcile: () => invoke("access.reconcile", accessBinding()),
      offboard: () => invoke("access.offboard"),
      recover: () => invoke("access.recover"),
    },
    agents: {
      setup: () => invoke("agents.setup", agentBinding()),
      reconcile: () => invoke("agents.reconcile", agentBinding()),
      offboard: () => invoke("agents.offboard"),
      recover: () => invoke("agents.recover"),
    },
  };
};

describe("provisioning coordinator", () => {
  test("persists lineage and enforces forward and reverse ordering", async () => {
    const calls: string[] = [];
    const first = new ProvisioningCoordinator(participants(calls), directory);
    const active = await first.setup(profile());
    expect(active.phase).toBe("active");
    expect(active.receipt?.machine.receiptId).toBe("machine-receipt");
    expect(active.receipt?.access.receiptId).toBe("access-receipt");
    expect(active.receipt?.agents.receiptId).toBe("agent-receipt");
    expect(calls).toEqual(["machine.setup", "access.setup", "agents.setup"]);

    const restarted = new ProvisioningCoordinator(participants(calls), directory);
    expect((await restarted.setup(profile())).receipt?.id).toBe(active.receipt?.id);
    await restarted.reconcile();
    expect(calls.slice(3)).toEqual(["machine.reconcile", "access.reconcile", "agents.reconcile"]);
    const revoked = await restarted.offboard();
    expect(revoked.phase).toBe("revoked");
    expect(revoked.receipt?.status).toBe("revoked");
    expect(calls.slice(-3)).toEqual(["agents.offboard", "access.offboard", "machine.offboard"]);
    expect((await restarted.offboard()).phase).toBe("revoked");
  });

  test("serializes coordinators across process-style instances", async () => {
    const calls: string[] = [];
    const integrated = participants(calls);
    const setup = integrated.machine.setup;
    integrated.machine.setup = async (spec) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return setup(spec);
    };
    const first = new ProvisioningCoordinator(integrated, directory);
    const second = new ProvisioningCoordinator(integrated, directory);
    const states = await Promise.all([first.setup(profile()), second.setup(profile())]);
    expect(states.every((state) => state.phase === "active")).toBe(true);
    expect(calls).toEqual(["machine.setup", "access.setup", "agents.setup"]);
  });

  test.each([
    ["machine.setup", ["machine.setup", "machine.recover"]],
    ["access.setup", ["machine.setup", "access.setup", "access.recover", "machine.offboard"]],
    [
      "agents.setup",
      [
        "machine.setup",
        "access.setup",
        "agents.setup",
        "agents.recover",
        "access.offboard",
        "machine.offboard",
      ],
    ],
  ])("compensates a %s failure", async (failure, expected) => {
    const calls: string[] = [];
    const coordinator = new ProvisioningCoordinator(participants(calls, failure), directory);
    await expect(coordinator.setup(profile())).rejects.toThrow();
    expect(calls).toEqual(expected);
    expect((await coordinator.get()).phase).toBe("revoked");
  });

  test("persists incomplete compensation and recovers after reconstruction", async () => {
    const calls: string[] = [];
    const first = new ProvisioningCoordinator(
      participants(calls, "agents.setup", "access.offboard"),
      directory,
    );
    await expect(first.setup(profile())).rejects.toThrow("requires recovery");
    const failed = await first.get();
    expect(failed.phase).toBe("recovery_required");
    expect(failed.recovery?.pending.map((step) => step.participant)).toEqual(["access", "machine"]);

    const restarted = new ProvisioningCoordinator(participants(calls), directory);
    expect((await restarted.recover()).phase).toBe("revoked");
    expect((await restarted.get()).recovery).toBeNull();
  });

  test.each(["agents.offboard", "access.offboard", "machine.offboard"])(
    "persists and resumes a %s failure",
    async (failure) => {
      const calls: string[] = [];
      const first = new ProvisioningCoordinator(participants(calls, failure), directory);
      await first.setup(profile());
      await expect(first.offboard()).rejects.toThrow("requires recovery");
      expect((await first.get()).phase).toBe("recovery_required");
      const restarted = new ProvisioningCoordinator(participants(calls), directory);
      expect((await restarted.recover()).phase).toBe("revoked");
    },
  );

  test("resumes a write-ahead access phase after reconstruction", async () => {
    const desired = profile();
    await writeFile(
      path.join(directory, "provisioning-coordinator.json"),
      JSON.stringify({
        version: 1,
        operationId: "provision-crash",
        profile: desired,
        profileDigest: provisioningProfileDigest(desired),
        phase: "access_pending",
        bindings: { machine: machineBinding(), access: null, agents: null },
        receipt: null,
        recovery: null,
        updatedAt: "2026-07-28T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    const calls: string[] = [];
    const restarted = new ProvisioningCoordinator(participants(calls), directory);
    expect((await restarted.setup(desired)).phase).toBe("active");
    expect(calls).toEqual(["access.setup", "agents.setup"]);
  });

  test("offboards a crashed setup without leaking admitted participants", async () => {
    const desired = profile();
    await writeFile(
      path.join(directory, "provisioning-coordinator.json"),
      JSON.stringify({
        version: 1,
        operationId: "provision-crash",
        profile: desired,
        profileDigest: provisioningProfileDigest(desired),
        phase: "agent_pending",
        bindings: {
          machine: machineBinding(),
          access: accessBinding(),
          agents: null,
        },
        receipt: null,
        recovery: null,
        updatedAt: "2026-07-28T00:00:00.000Z",
      }),
      { mode: 0o600 },
    );
    const calls: string[] = [];
    const restarted = new ProvisioningCoordinator(participants(calls), directory);
    expect((await restarted.offboard()).phase).toBe("revoked");
    expect(calls).toEqual(["agents.recover", "access.offboard", "machine.offboard"]);
  });

  test("does not persist participant error details", async () => {
    const calls: string[] = [];
    const integrated = participants(calls);
    integrated.agents.setup = async () => {
      throw new Error("token=supersecret");
    };
    integrated.agents.recover = async () => {
      throw new Error("password=supersecret");
    };
    const coordinator = new ProvisioningCoordinator(integrated, directory);
    await expect(coordinator.setup(profile())).rejects.toThrow("requires recovery");
    expect(JSON.stringify(await coordinator.get())).not.toContain("supersecret");
  });

  test("refuses identity, reference, and receipt drift", async () => {
    const calls: string[] = [];
    const coordinator = new ProvisioningCoordinator(participants(calls), directory);
    const invalid = profile();
    invalid.access.machineId = "other-machine";
    await expect(coordinator.setup(invalid)).rejects.toThrow("profile is invalid");
    await coordinator.setup(profile());
    const restarted = new ProvisioningCoordinator(
      participants(calls, undefined, undefined, true),
      directory,
    );
    await expect(restarted.reconcile()).rejects.toThrow("receipt lineage drift");
  });

  test("rejects tampered persisted lineage before participant calls", async () => {
    const calls: string[] = [];
    const coordinator = new ProvisioningCoordinator(participants(calls), directory);
    await coordinator.setup(profile());
    calls.length = 0;
    const file = path.join(directory, "provisioning-coordinator.json");
    const state = JSON.parse(await readFile(file, "utf8"));
    state.receipt.machine.receiptId = "tampered-receipt";
    await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    const restarted = new ProvisioningCoordinator(participants(calls), directory);
    await expect(restarted.get()).rejects.toThrow("state is invalid");
    expect(calls).toEqual([]);
  });

  test("authenticates the complete HTTP lifecycle", async () => {
    const calls: string[] = [];
    const handlers = createProvisioningCoordinatorHandlers(
      participants(calls),
      () => "provision-token",
      directory,
    );
    const request = (pathname: string, method = "GET", body?: unknown, token = "provision-token") =>
      new Request(`http://127.0.0.1:8081${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect(
      (await handlers.get(request("/api/provisioning", "GET", undefined, "wrong"))).status,
    ).toBe(401);
    expect(
      (await handlers.setup(request("/api/provisioning/setup", "POST", profile()))).status,
    ).toBe(200);
    expect((await handlers.get(request("/api/provisioning"))).status).toBe(200);
    expect((await handlers.reconcile(request("/api/provisioning/reconcile", "POST"))).status).toBe(
      200,
    );
    expect((await handlers.offboard(request("/api/provisioning", "DELETE"))).status).toBe(200);
    expect((await handlers.recover(request("/api/provisioning/recover", "POST"))).status).toBe(409);
  });
});
