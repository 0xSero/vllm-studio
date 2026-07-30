import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  MachineEnrollmentProfile,
  MachineOwnedResource,
} from "@local-studio/contracts/machine-enrollment";
import { Effect } from "effect";
import {
  MachineEnrollmentService,
  decodeMachineEnrollmentProfile,
  machinePlanDigest,
  transitionMachine,
} from "../src/modules/machines/enrollment-service";

const roots: string[] = [];
const root = (): string => {
  const value = mkdtempSync(join(tmpdir(), "machine-enrollment-"));
  roots.push(value);
  return value;
};

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

const profile = (changes: Partial<MachineEnrollmentProfile> = {}): MachineEnrollmentProfile => ({
  machine_id: "tensorprime-01",
  display_name: "TensorPrime 01",
  locality: "remote",
  appliance_id: "cortaix-factory",
  classification: "C2",
  rig_id: "rig-01",
  rig_node_id: "node-01",
  runtime_refs: [{ id: "runtime-vllm" }],
  access_refs: [
    {
      id: "access-fabric-01",
      kind: "ssh",
      endpoint: "tensorprime",
      credential_ref: "keyring:machine/tensorprime-01/ssh",
    },
  ],
  agent_refs: [{ id: "agent-runtime-01" }],
  ...changes,
});

const resource = (id = "controller-service"): MachineOwnedResource => ({
  resource_id: id,
  kind: "service",
  external_ref: `systemd:user:${id}`,
  ownership: "local-studio",
  apply_action: "create",
  rollback_action: "remove",
});

describe("machine enrollment", () => {
  test("validates C2 appliance binding, stable ids, keyring refs, and rejects secrets", () => {
    expect(decodeMachineEnrollmentProfile(profile())).toEqual(profile());
    expect(() => decodeMachineEnrollmentProfile(profile({ machine_id: "Bad ID" }))).toThrow();
    expect(() =>
      decodeMachineEnrollmentProfile(profile({ appliance_id: "local-studio" })),
    ).toThrow();
    expect(() =>
      decodeMachineEnrollmentProfile({
        ...profile(),
        access_refs: [
          {
            id: "access-fabric-01",
            kind: "ssh",
            endpoint: "host",
            credential_ref: "plain:value",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeMachineEnrollmentProfile({ ...profile(), api_key: "do-not-store" }),
    ).toThrow(/secret material/);
    expect(
      decodeMachineEnrollmentProfile({
        ...profile(),
        access_refs: [
          {
            id: "access-fabric-01",
            kind: "boundary",
            endpoint: "https://boundary.example",
            credential_ref: "vault:access:boundary",
          },
        ],
      }).access_refs[0]?.credential_ref,
    ).toBe("vault:access:boundary");
  });

  test("creates a deterministic plan digest independent of object key order", () => {
    const first = profile();
    const second = JSON.parse(JSON.stringify(first)) as MachineEnrollmentProfile;
    expect(machinePlanDigest(first)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(machinePlanDigest(first)).toBe(machinePlanDigest(second));
  });

  test("enforces lifecycle transitions and treats same-state transition as idempotent", () => {
    const at = "2026-07-28T12:00:00.000Z";
    const record = {
      profile: profile(),
      state: "draft" as const,
      plan_digest: machinePlanDigest(profile()),
      created_at: at,
      updated_at: at,
      events: [],
      receipt: null,
      recovery_required: false,
    };
    expect(transitionMachine(record, "draft", at, "repeat")).toBe(record);
    expect(transitionMachine(record, "probed", at, "probe passed").state).toBe("probed");
    expect(() => transitionMachine(record, "active", at, "skip")).toThrow(
      "Invalid machine lifecycle transition",
    );
  });

  test("persists atomically with restrictive permissions and registration is idempotent", async () => {
    const directory = root();
    const service = new MachineEnrollmentService(directory, () => "2026-07-28T12:00:00.000Z");
    const first = await service.register(profile());
    const second = await service.register(profile());
    const path = join(directory, "machine-enrollments.json");

    expect(second).toEqual(first);
    expect((await service.list()).length).toBe(1);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).not.toContain("do-not-store");
  });

  test("applies once, records exact owned resources, and reconciles without changes", async () => {
    const service = new MachineEnrollmentService(root(), () => "2026-07-28T12:00:00.000Z");
    await service.register(profile());
    await service.transition("tensorprime-01", "probed", "probe passed");
    await service.transition("tensorprime-01", "admitted", "policy passed");
    await service.transition("tensorprime-01", "configured", "references bound");
    const first = await service.apply("tensorprime-01", [resource()]);
    const second = await service.apply("tensorprime-01", [resource()]);
    const reconciled = await service.reconcile("tensorprime-01");

    expect(second.receipt?.receipt_id).toBe(first.receipt?.receipt_id);
    expect(second.receipt?.owned_resources).toEqual([resource()]);
    expect(second.receipt?.rollback_journal).toEqual([
      { resource_id: "controller-service", status: "pending" },
    ]);
    expect(reconciled).toEqual(second);
    expect(() => service.apply("tensorprime-01", [resource("different")])).toThrow(
      "differ from the existing receipt",
    );
  });

  test("offboards only receipt-owned resources in reverse order", async () => {
    const service = new MachineEnrollmentService(root(), () => "2026-07-28T12:00:00.000Z");
    await service.register(profile());
    await service.transition("tensorprime-01", "probed", "probe passed");
    await service.transition("tensorprime-01", "admitted", "policy passed");
    await service.transition("tensorprime-01", "configured", "references bound");
    await service.apply("tensorprime-01", [resource("first"), resource("second")]);
    const rolledBack: string[] = [];
    const revoked = await Effect.runPromise(
      service.offboard("tensorprime-01", (owned) =>
        Effect.sync(() => rolledBack.push(owned.resource_id)).pipe(Effect.asVoid),
      ),
    );

    expect(rolledBack).toEqual(["second", "first"]);
    expect(revoked.state).toBe("revoked");
    expect(revoked.receipt?.rollback_journal.map(({ status }) => status)).toEqual([
      "rolled_back",
      "rolled_back",
    ]);
  });

  test("persists recovery-required state when rollback fails", async () => {
    const service = new MachineEnrollmentService(root(), () => "2026-07-28T12:00:00.000Z");
    await service.register(profile());
    await service.transition("tensorprime-01", "probed", "probe passed");
    await service.transition("tensorprime-01", "admitted", "policy passed");
    await service.transition("tensorprime-01", "configured", "references bound");
    await service.apply("tensorprime-01", [resource()]);

    await expect(
      Effect.runPromise(
        service.offboard("tensorprime-01", () => Effect.fail(new Error("rollback failed"))),
      ),
    ).rejects.toThrow("rollback failed");
    const [failed] = await service.list();
    expect(failed?.state).toBe("failed");
    expect(failed?.recovery_required).toBe(true);
    expect(failed?.receipt?.owned_resources).toEqual([resource()]);
    expect(failed?.receipt?.rollback_journal[0]?.status).toBe("failed");
  });

  test("recovery retries only unfinished rollback journal entries", async () => {
    const service = new MachineEnrollmentService(root(), () => "2026-07-28T12:00:00.000Z");
    await service.register(profile());
    await service.transition("tensorprime-01", "probed", "probe passed");
    await service.transition("tensorprime-01", "admitted", "policy passed");
    await service.transition("tensorprime-01", "configured", "references bound");
    await service.apply("tensorprime-01", [resource("first"), resource("second")]);
    await expect(
      Effect.runPromise(
        service.offboard("tensorprime-01", ({ resource_id }) =>
          resource_id === "first" ? Effect.fail(new Error("rollback failed")) : Effect.void,
        ),
      ),
    ).rejects.toThrow();
    const retried: string[] = [];
    const revoked = await Effect.runPromise(
      service.offboard("tensorprime-01", ({ resource_id }) =>
        Effect.sync(() => retried.push(resource_id)).pipe(Effect.asVoid),
      ),
    );
    expect(retried).toEqual(["first"]);
    expect(revoked.state).toBe("revoked");
  });

  test("rejects malformed persisted state instead of silently resetting it", async () => {
    const directory = root();
    writeFileSync(join(directory, "machine-enrollments.json"), '{"version":1,"machines":"bad"}');
    chmodSync(join(directory, "machine-enrollments.json"), 0o600);
    const service = new MachineEnrollmentService(directory);
    expect(() => service.list()).toThrow();
  });

  test("serializes mutations across service instances without losing machines", async () => {
    const directory = root();
    const first = new MachineEnrollmentService(directory);
    const second = new MachineEnrollmentService(directory);
    await Promise.all([
      first.register(profile()),
      second.register(profile({ machine_id: "tensorprime-02", display_name: "TensorPrime 02" })),
    ]);
    expect((await first.list()).map(({ profile: value }) => value.machine_id)).toEqual([
      "tensorprime-01",
      "tensorprime-02",
    ]);
  });

  test("rejects persisted digest and rollback journal drift", async () => {
    const directory = root();
    const service = new MachineEnrollmentService(directory);
    await service.register(profile());
    const path = join(directory, "machine-enrollments.json");
    const state = JSON.parse(readFileSync(path, "utf8")) as {
      machines: Array<{ plan_digest: string }>;
    };
    state.machines[0]!.plan_digest = `sha256:${"0".repeat(64)}`;
    writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
    expect(() => service.list()).toThrow("plan digest drift");
  });
});
