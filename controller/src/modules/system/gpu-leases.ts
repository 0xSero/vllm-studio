import { Effect } from "effect";
import { getExtraArgument } from "../engines/argument-utilities";
import type { GpuInfo, Recipe } from "../models/types";
import type { InstanceRecord } from "../compute/contracts";
import type { InstanceStore } from "../compute/instances/store";

/**
 * GPU lease view over the compute instance store.
 *
 * This replaces a 600-line registry (in-memory map + hardlink lock files + a mkdir
 * reaper + /proc start tokens) whose whole job was keeping a SECOND source of truth in
 * sync with reality — and whose failure mode was the leaked-lease split-brain between
 * the engine coordinator's cache and the on-disk locks. Under records-as-lease there is
 * nothing to sync: a device is held iff a live instance record claims it, so this file
 * only translates that fact into the lease vocabulary the speech service speaks.
 *
 * The "llm" owner is the compute-launched model instance; its devices are authoritative
 * in its record, so `replace("llm", …)` validates instead of writing. The "speech"
 * owner is a pinned record (no supervised process) freed only by explicit release.
 */

export type GpuLeaseOwner = "llm" | "speech";

export interface GpuLease {
  readonly uuid: string;
  readonly owner: GpuLeaseOwner;
  readonly acquired_at: string;
}

export interface GpuVisibilityResolution {
  readonly source: "all" | "recipe";
  readonly selector: string | null;
  readonly uuids: readonly string[];
  readonly unresolvedTokens: readonly string[];
}

export class GpuLeaseConflict extends Error {
  constructor(
    readonly uuid: string,
    readonly holder: GpuLeaseOwner,
  ) {
    super(`GPU ${uuid} is held by ${holder}`);
    this.name = "GpuLeaseConflict";
  }
}

export class GpuLeaseLockFailure extends Error {
  constructor(
    readonly operation: "acquire" | "release",
    message: string,
  ) {
    super(message);
    this.name = "GpuLeaseLockFailure";
  }
}

export class InvalidGpuLeaseUuid extends Error {
  constructor(readonly uuid: string) {
    super(`Not a canonical NVIDIA GPU uuid: ${uuid}`);
    this.name = "InvalidGpuLeaseUuid";
  }
}

export type GpuLeaseError = GpuLeaseConflict | GpuLeaseLockFailure | InvalidGpuLeaseUuid;

export interface GpuLeaseRegistry {
  readonly claim: (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ) => Effect.Effect<readonly GpuLease[], GpuLeaseError>;
  readonly replace: (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ) => Effect.Effect<readonly GpuLease[], GpuLeaseError>;
  readonly release: (
    owner: GpuLeaseOwner,
    uuids?: readonly string[],
  ) => Effect.Effect<readonly GpuLease[], GpuLeaseLockFailure | InvalidGpuLeaseUuid>;
  readonly snapshot: () => Effect.Effect<readonly GpuLease[]>;
}

const SPEECH_RECORD = "speech";

export interface GpuLeaseShimDependencies {
  readonly store: InstanceStore;
  readonly recordAlive: (record: InstanceRecord) => Effect.Effect<boolean>;
}

export const createGpuLeaseRegistry = (deps: GpuLeaseShimDependencies): GpuLeaseRegistry => {
  const ownerOf = (record: InstanceRecord): GpuLeaseOwner =>
    record.name === SPEECH_RECORD ? "speech" : "llm";

  const heldLeases = (): Effect.Effect<readonly GpuLease[]> =>
    Effect.gen(function* () {
      const leases: GpuLease[] = [];
      for (const record of deps.store.all()) {
        if (record.ref !== null && !(yield* deps.recordAlive(record))) continue;
        for (const uuid of record.devices) {
          leases.push({ uuid, owner: ownerOf(record), acquired_at: record.startedAt });
        }
      }
      return leases;
    });

  const ownedLeases = (owner: GpuLeaseOwner): Effect.Effect<readonly GpuLease[]> =>
    heldLeases().pipe(Effect.map((leases) => leases.filter((lease) => lease.owner === owner)));

  const claim = (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ): Effect.Effect<readonly GpuLease[], GpuLeaseError> =>
    Effect.gen(function* () {
      const held = yield* heldLeases();
      for (const uuid of uuids) {
        const conflict = held.find((lease) => lease.uuid === uuid && lease.owner !== owner);
        if (conflict) return yield* Effect.fail(new GpuLeaseConflict(uuid, conflict.owner));
      }
      if (owner === "speech") {
        const existing = deps.store.read(SPEECH_RECORD);
        const devices = [...new Set([...(existing?.devices ?? []), ...uuids])];
        const now = new Date().toISOString();
        deps.store.write({
          name: SPEECH_RECORD,
          nodeId: existing?.nodeId ?? "self",
          engine: "llamacpp", // unused for pinned holds; the schema requires an engine
          recipeId: SPEECH_RECORD,
          runtime: "process",
          ref: { kind: "pinned", holder: SPEECH_RECORD },
          port: existing?.port ?? 0,
          devices,
          nonce: existing?.nonce ?? SPEECH_RECORD,
          startedAt: existing?.startedAt ?? now,
          readyDeadlineAt: existing?.readyDeadlineAt ?? now,
        });
      }
      // owner === "llm": the model's own instance record is the lease; nothing to write.
      return yield* ownedLeases(owner);
    });

  const replace = (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ): Effect.Effect<readonly GpuLease[], GpuLeaseError> =>
    Effect.gen(function* () {
      if (owner === "speech") {
        deps.store.drop(SPEECH_RECORD);
        return yield* claim(owner, uuids);
      }
      // The llm record is authoritative; replace() only checks the requested set does
      // not collide with speech's hold, which is the invariant callers relied on.
      const held = yield* heldLeases();
      for (const uuid of uuids) {
        const conflict = held.find((lease) => lease.uuid === uuid && lease.owner === "speech");
        if (conflict) return yield* Effect.fail(new GpuLeaseConflict(uuid, "speech"));
      }
      return yield* ownedLeases(owner);
    });

  const release = (
    owner: GpuLeaseOwner,
    uuids?: readonly string[],
  ): Effect.Effect<readonly GpuLease[], GpuLeaseLockFailure | InvalidGpuLeaseUuid> =>
    Effect.gen(function* () {
      if (owner === "speech") {
        const existing = deps.store.read(SPEECH_RECORD);
        if (existing) {
          const remaining = uuids
            ? existing.devices.filter((device) => !uuids.includes(device))
            : [];
          if (remaining.length === 0) deps.store.drop(SPEECH_RECORD);
          else deps.store.write({ ...existing, devices: remaining });
        }
      }
      // owner === "llm": stopping the model drops its record; nothing to release here.
      return yield* ownedLeases(owner);
    });

  return { claim, replace, release, snapshot: heldLeases };
};

/* ── recipe GPU selector resolution (unchanged semantics) ─────────────────── */

const fullNvidiaUuid =
  /^GPU-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const directVisibilityKeys = [
  "visible_devices",
  "VISIBLE_DEVICES",
  "CUDA_VISIBLE_DEVICES",
  "cuda_visible_devices",
  "cuda-visible-devices",
] as const;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function directVisibilitySelector(recipe: Recipe): string | null {
  for (const key of directVisibilityKeys) {
    const value = getExtraArgument(recipe.extra_args, key);
    if (value === undefined || value === null) continue;
    return value === false ? null : String(value);
  }
  return null;
}

function environmentVisibilitySelector(recipe: Recipe): string | null {
  let selector = recipe.env_vars?.["CUDA_VISIBLE_DEVICES"] ?? null;
  const extraEnvironment =
    getExtraArgument(recipe.extra_args, "env_vars") ?? recipe.extra_args["envVars"];
  if (!isUnknownRecord(extraEnvironment)) return selector;
  const value = extraEnvironment["CUDA_VISIBLE_DEVICES"];
  if (value !== undefined && value !== null) selector = String(value);
  return selector;
}

function canonicalNvidiaUuid(uuid: string): string {
  return `GPU-${uuid.slice(4).toLowerCase()}`;
}

function leaseableUuid(gpu: GpuInfo): string | null {
  const uuid = gpu.uuid?.trim();
  return uuid && fullNvidiaUuid.test(uuid) ? canonicalNvidiaUuid(uuid) : null;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

export function resolveRecipeGpuUuids(
  recipe: Recipe,
  gpus: readonly GpuInfo[],
): GpuVisibilityResolution {
  const byIndex = new Map<number, string>();
  const byUuid = new Map<string, string>();
  const allUuids: string[] = [];
  for (const gpu of gpus) {
    const uuid = leaseableUuid(gpu);
    if (!uuid) continue;
    if (!byIndex.has(gpu.index)) byIndex.set(gpu.index, uuid);
    byUuid.set(uuid.toLowerCase(), uuid);
    appendUnique(allUuids, uuid);
  }

  const selector = directVisibilitySelector(recipe) ?? environmentVisibilitySelector(recipe);
  if (selector === null) {
    const required = Math.max(1, recipe.tensor_parallel_size * recipe.pipeline_parallel_size);
    return { source: "all", selector, uuids: allUuids.slice(0, required), unresolvedTokens: [] };
  }

  const uuids: string[] = [];
  const unresolvedTokens: string[] = [];
  const tokens = selector
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const uuid = /^\d+$/.test(token) ? byIndex.get(Number(token)) : byUuid.get(token.toLowerCase());
    if (uuid) appendUnique(uuids, uuid);
    else appendUnique(unresolvedTokens, token);
  }
  return { source: "recipe", selector, uuids, unresolvedTokens };
}
