import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  MachineEnrollmentFileSchema,
  MachineEnrollmentProfileSchema,
  MachineOwnedResourceSchema,
  type MachineEnrollmentProfile,
  type MachineEnrollmentReceipt,
  type MachineEnrollmentRecord,
  type MachineLifecycleState,
  type MachineOwnedResource,
} from "@local-studio/contracts/machine-enrollment";
import { Effect, Schema } from "effect";

type StoredFile = {
  version: 1;
  machines: MachineEnrollmentRecord[];
};

const EMPTY_FILE: StoredFile = { version: 1, machines: [] };
const MACHINE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const CREDENTIAL_REF = /^(?:keyring|vault):[a-zA-Z0-9._:/-]+$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SECRET_KEY = /(api.?key|password|secret|token|private.?key|credential(?!_ref))/iu;
const TRANSITIONS: Record<MachineLifecycleState, readonly MachineLifecycleState[]> = {
  draft: ["probed", "failed"],
  probed: ["admitted", "failed"],
  admitted: ["configured", "failed"],
  configured: ["active", "failed"],
  active: ["draining", "failed"],
  draining: ["revoked", "failed"],
  revoked: ["draft"],
  failed: ["draft", "draining"],
};
const activeOffboards = new Set<string>();

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const rejectSecrets = (value: unknown, path = "profile"): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecrets(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`${path}.${key} must not contain secret material`);
    if (
      typeof entry === "string" &&
      (/-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(entry) ||
        /^Bearer\s+/iu.test(entry) ||
        /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+:[^@\s]+@/iu.test(entry))
    ) {
      throw new Error(`${path}.${key} must not contain secret material`);
    }
    rejectSecrets(entry, `${path}.${key}`);
  }
};

export const machinePlanDigest = (profile: MachineEnrollmentProfile): string =>
  `sha256:${createHash("sha256").update(canonical(profile)).digest("hex")}`;

export const decodeMachineEnrollmentProfile = (input: unknown): MachineEnrollmentProfile => {
  rejectSecrets(input);
  const profile = Schema.decodeUnknownSync(MachineEnrollmentProfileSchema, {
    onExcessProperty: "error",
  })(input);
  if (!MACHINE_ID.test(profile.machine_id)) {
    throw new Error("machine_id must be a stable lowercase identifier");
  }
  if (!profile.display_name.trim()) throw new Error("display_name is required");
  if (profile.appliance_id !== "cortaix-factory") {
    throw new Error("C2 machine enrollment requires the cortaix-factory appliance");
  }
  const referenceIds = new Set<string>();
  for (const reference of [...profile.runtime_refs, ...profile.agent_refs]) {
    if (!reference.id.trim() || referenceIds.has(reference.id)) {
      throw new Error("Runtime and agent reference identifiers must be non-empty and unique");
    }
    referenceIds.add(reference.id);
  }
  for (const access of profile.access_refs) {
    if (!access.id.trim() || referenceIds.has(access.id)) {
      throw new Error("Access reference identifiers must be non-empty and unique");
    }
    referenceIds.add(access.id);
    if (!access.endpoint.trim()) throw new Error(`${access.kind} endpoint is required`);
    if (access.credential_ref && !CREDENTIAL_REF.test(access.credential_ref)) {
      throw new Error(`${access.kind} credentials must use an opaque credential-store reference`);
    }
  }
  if (profile.locality === "remote" && profile.access_refs.length === 0) {
    throw new Error("Remote machine enrollment requires an access reference");
  }
  return profile;
};

export const transitionMachine = (
  record: MachineEnrollmentRecord,
  to: MachineLifecycleState,
  at: string,
  reason: string,
): MachineEnrollmentRecord => {
  if (record.state === to) return record;
  if (!TRANSITIONS[record.state].includes(to)) {
    throw new Error(`Invalid machine lifecycle transition: ${record.state} -> ${to}`);
  }
  return {
    ...record,
    state: to,
    updated_at: at,
    events: [...record.events, { from: record.state, to, at, reason }],
  };
};

const normalizeResources = (
  resources: readonly MachineOwnedResource[],
): MachineOwnedResource[] => {
  rejectSecrets(resources, "owned_resources");
  const ids = new Set<string>();
  return [...resources]
    .map((resource) =>
      Schema.decodeUnknownSync(MachineOwnedResourceSchema, {
        onExcessProperty: "error",
      })(resource),
    )
    .sort((left, right) => left.resource_id.localeCompare(right.resource_id))
    .map((resource) => {
      if (!resource.resource_id.trim() || ids.has(resource.resource_id)) {
        throw new Error("Owned resource identifiers must be non-empty and unique");
      }
      if (resource.previous_digest && !DIGEST.test(resource.previous_digest)) {
        throw new Error("Owned resource previous_digest must be sha256");
      }
      ids.add(resource.resource_id);
      return resource;
    });
};

export class MachineEnrollmentService {
  private readonly filePath: string;

  public constructor(
    dataDirectory: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.filePath = resolve(dataDirectory, "machine-enrollments.json");
  }

  public list(): readonly MachineEnrollmentRecord[] {
    return this.read().machines;
  }

  public register(input: unknown): MachineEnrollmentRecord {
    const profile = decodeMachineEnrollmentProfile(input);
    if (activeOffboards.has(profile.machine_id)) {
      throw new Error(`Machine "${profile.machine_id}" is currently offboarding`);
    }
    return this.mutate((file) => {
      const existing = file.machines.find(({ profile: value }) => value.machine_id === profile.machine_id);
      const digest = machinePlanDigest(profile);
      if (existing && existing.plan_digest === digest && existing.state !== "revoked") return existing;
      const at = this.now();
      const base: MachineEnrollmentRecord = existing
        ? transitionMachine(existing, "draft", at, "profile replaced")
        : {
            profile,
            state: "draft",
            plan_digest: digest,
            created_at: at,
            updated_at: at,
            events: [],
            receipt: null,
            recovery_required: false,
          };
      const record = { ...base, profile, plan_digest: digest, receipt: null };
      return this.replace(file, record);
    });
  }

  public transition(
    machineId: string,
    to: MachineLifecycleState,
    reason: string,
  ): MachineEnrollmentRecord {
    return this.mutate((file) => {
      const current = this.require(file, machineId);
      return this.replace(file, transitionMachine(current, to, this.now(), reason));
    });
  }

  public apply(
    machineId: string,
    resources: readonly MachineOwnedResource[],
  ): MachineEnrollmentRecord {
    const ownedResources = normalizeResources(resources);
    if (activeOffboards.has(machineId)) {
      throw new Error(`Machine "${machineId}" is currently offboarding`);
    }
    return this.mutate((file) => {
      const current = this.require(file, machineId);
      if (current.state === "active" && current.receipt?.plan_digest === current.plan_digest) {
        if (canonical(current.receipt.owned_resources) !== canonical(ownedResources)) {
          throw new Error("Applied owned resources differ from the existing receipt");
        }
        return current;
      }
      if (current.state !== "configured") {
        throw new Error("Machine must be configured before apply");
      }
      const at = this.now();
      const receipt: MachineEnrollmentReceipt = {
        receipt_id: randomUUID(),
        machine_id: machineId,
        plan_digest: current.plan_digest,
        applied_at: at,
        classification: "C2",
        owned_resources: ownedResources,
        rollback_journal: ownedResources.map(({ resource_id }) => ({
          resource_id,
          status: "pending",
        })),
      };
      const active = transitionMachine({ ...current, receipt }, "active", at, "plan applied");
      return this.replace(file, active);
    });
  }

  public reconcile(machineId: string): MachineEnrollmentRecord {
    if (activeOffboards.has(machineId)) {
      throw new Error(`Machine "${machineId}" is currently offboarding`);
    }
    return this.mutate((file) => {
      const current = this.require(file, machineId);
      if (current.receipt && current.receipt.plan_digest !== current.plan_digest) {
        const failed = transitionMachine(current, "failed", this.now(), "receipt plan drift");
        return this.replace(file, { ...failed, recovery_required: true });
      }
      return current;
    });
  }

  public offboard(
    machineId: string,
    rollback: (resource: MachineOwnedResource) => Effect.Effect<void, unknown>,
  ): Effect.Effect<MachineEnrollmentRecord, unknown> {
    if (activeOffboards.has(machineId)) {
      return Effect.fail(new Error(`Machine "${machineId}" is already offboarding`));
    }
    activeOffboards.add(machineId);
    return this.runOffboard(machineId, rollback).pipe(
      Effect.ensuring(Effect.sync(() => activeOffboards.delete(machineId))),
    );
  }

  private runOffboard(
    machineId: string,
    rollback: (resource: MachineOwnedResource) => Effect.Effect<void, unknown>,
  ): Effect.Effect<MachineEnrollmentRecord, unknown> {
    const service = this;
    return Effect.gen(function* () {
      const existing = service.list().find(({ profile }) => profile.machine_id === machineId);
      if (!existing) return yield* Effect.fail(new Error(`Machine "${machineId}" is not enrolled`));
      const current =
        existing.state === "draining"
          ? existing
          : service.transition(machineId, "draining", "offboarding started");
      for (const resource of [...(current.receipt?.owned_resources ?? [])].reverse()) {
        const latest = service.list().find(({ profile }) => profile.machine_id === machineId);
        const journal = latest?.receipt?.rollback_journal ?? [];
        if (
          journal.find(({ resource_id }) => resource_id === resource.resource_id)?.status ===
          "rolled_back"
        ) {
          continue;
        }
        const result = yield* rollback(resource).pipe(
          Effect.as({ ok: true as const }),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
        );
        if (result.ok) {
          service.updateRollback(machineId, resource.resource_id, "rolled_back");
          continue;
        }
        service.updateRollback(machineId, resource.resource_id, "failed");
        service.mutate((file) => {
          const value = service.require(file, machineId);
          const failed = transitionMachine(
            value,
            "failed",
            service.now(),
            "rollback incomplete",
          );
          return service.replace(file, { ...failed, recovery_required: true });
        });
        return yield* Effect.fail(result.error);
      }
      return service.mutate((file) => {
        const latest = service.require(file, machineId);
        const revoked = transitionMachine(
          latest,
          "revoked",
          service.now(),
          "owned resources rolled back",
        );
        return service.replace(file, { ...revoked, recovery_required: false });
      });
    });
  }

  private updateRollback(
    machineId: string,
    resourceId: string,
    status: "rolled_back" | "failed",
  ): void {
    this.mutate((file) => {
      const current = this.require(file, machineId);
      if (!current.receipt) throw new Error("Machine has no apply receipt");
      const receipt = {
        ...current.receipt,
        rollback_journal: current.receipt.rollback_journal.map((entry) =>
          entry.resource_id === resourceId
            ? { ...entry, status, attempted_at: this.now() }
            : entry,
        ),
      };
      return this.replace(file, { ...current, receipt, updated_at: this.now() });
    });
  }

  private require(file: StoredFile, machineId: string): MachineEnrollmentRecord {
    const record = file.machines.find(({ profile }) => profile.machine_id === machineId);
    if (!record) throw new Error(`Machine "${machineId}" is not enrolled`);
    return record;
  }

  private replace(
    file: StoredFile,
    record: MachineEnrollmentRecord,
  ): MachineEnrollmentRecord {
    const machines = file.machines.filter(
      ({ profile }) => profile.machine_id !== record.profile.machine_id,
    );
    file.machines = [...machines, record].sort((left, right) =>
      left.profile.machine_id.localeCompare(right.profile.machine_id),
    );
    return record;
  }

  private read(): StoredFile {
    try {
      const input = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      const decoded = Schema.decodeUnknownSync(MachineEnrollmentFileSchema, {
        onExcessProperty: "error",
      })(input);
      const machines = [...decoded.machines];
      const ids = new Set<string>();
      for (const record of machines) {
        decodeMachineEnrollmentProfile(record.profile);
        if (ids.has(record.profile.machine_id)) throw new Error("Persisted machine IDs must be unique");
        ids.add(record.profile.machine_id);
        if (record.plan_digest !== machinePlanDigest(record.profile)) {
          throw new Error(`Persisted machine "${record.profile.machine_id}" has plan digest drift`);
        }
        if (record.receipt) {
          if (
            record.receipt.machine_id !== record.profile.machine_id ||
            record.receipt.plan_digest !== record.plan_digest
          ) {
            throw new Error(`Persisted machine "${record.profile.machine_id}" has receipt drift`);
          }
          const resources = normalizeResources(record.receipt.owned_resources);
          const resourceIds = resources.map(({ resource_id }) => resource_id).sort();
          const journalIds = record.receipt.rollback_journal
            .map(({ resource_id }) => resource_id)
            .sort();
          if (canonical(resourceIds) !== canonical(journalIds)) {
            throw new Error(`Persisted machine "${record.profile.machine_id}" has rollback drift`);
          }
        }
      }
      return { version: 1, machines };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_FILE);
      throw error;
    }
  }

  private write(file: StoredFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, this.filePath);
      chmodSync(dirname(this.filePath), 0o700);
      chmodSync(this.filePath, 0o600);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    }
  }

  private mutate(
    operation: (file: StoredFile) => MachineEnrollmentRecord,
  ): MachineEnrollmentRecord {
    const file = this.read();
    const result = operation(file);
    this.write(file);
    return result;
  }
}
