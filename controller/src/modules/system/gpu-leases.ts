import { Effect, Semaphore } from "effect";
import type { GpuInfo, Recipe } from "../models/types";

const fullNvidiaUuid =
  /^GPU-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const directVisibilityKeys = [
  "visible_devices",
  "VISIBLE_DEVICES",
  "CUDA_VISIBLE_DEVICES",
  "cuda_visible_devices",
  "cuda-visible-devices",
] as const;

export type GpuLeaseOwner = "llm" | "speech";

export interface GpuLease {
  readonly uuid: string;
  readonly owner: GpuLeaseOwner;
}

export interface GpuVisibilityResolution {
  readonly source: "all" | "recipe";
  readonly selector: string | null;
  readonly uuids: readonly string[];
  readonly unresolvedTokens: readonly string[];
}

export interface GpuLeaseConflictEntry {
  readonly uuid: string;
  readonly heldBy: GpuLeaseOwner;
}

export class GpuLeaseConflict extends Error {
  readonly _tag = "GpuLeaseConflict";

  constructor(
    readonly requestedBy: GpuLeaseOwner,
    readonly conflicts: readonly GpuLeaseConflictEntry[],
  ) {
    super(
      `GPU lease conflict for ${requestedBy}: ${conflicts
        .map(({ uuid, heldBy }) => `${uuid} held by ${heldBy}`)
        .join(", ")}`,
    );
    this.name = "GpuLeaseConflict";
  }
}

export class InvalidGpuLeaseUuid extends Error {
  readonly _tag = "InvalidGpuLeaseUuid";

  constructor(readonly invalidUuids: readonly string[]) {
    super(`GPU leases require full NVIDIA UUIDs: ${invalidUuids.join(", ")}`);
    this.name = "InvalidGpuLeaseUuid";
  }
}

export interface GpuLeaseRegistry {
  readonly claim: (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ) => Effect.Effect<readonly GpuLease[], GpuLeaseConflict | InvalidGpuLeaseUuid>;
  readonly replace: (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ) => Effect.Effect<readonly GpuLease[], GpuLeaseConflict | InvalidGpuLeaseUuid>;
  readonly release: (
    owner: GpuLeaseOwner,
    uuids?: readonly string[],
  ) => Effect.Effect<readonly GpuLease[], InvalidGpuLeaseUuid>;
  readonly snapshot: () => Effect.Effect<readonly GpuLease[]>;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extraArgument(extraArguments: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(extraArguments, key)) return extraArguments[key];
  const kebab = key.replace(/_/g, "-");
  if (Object.prototype.hasOwnProperty.call(extraArguments, kebab)) return extraArguments[kebab];
  const snake = key.replace(/-/g, "_");
  return Object.prototype.hasOwnProperty.call(extraArguments, snake)
    ? extraArguments[snake]
    : undefined;
}

function directVisibilitySelector(recipe: Recipe): string | null {
  for (const key of directVisibilityKeys) {
    const value = extraArgument(recipe.extra_args, key);
    if (value === undefined || value === null) continue;
    return value === false ? null : String(value);
  }
  return null;
}

function environmentVisibilitySelector(recipe: Recipe): string | null {
  let selector = recipe.env_vars?.["CUDA_VISIBLE_DEVICES"] ?? null;
  const extraEnvironment =
    recipe.extra_args["env_vars"] || recipe.extra_args["env-vars"] || recipe.extra_args["envVars"];
  if (!isUnknownRecord(extraEnvironment)) return selector;
  const value = extraEnvironment["CUDA_VISIBLE_DEVICES"];
  if (value !== undefined && value !== null) selector = String(value);
  return selector;
}

function recipeVisibilitySelector(recipe: Recipe): string | null {
  return directVisibilitySelector(recipe) ?? environmentVisibilitySelector(recipe);
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

  const selector = recipeVisibilitySelector(recipe);
  if (selector === null) {
    return { source: "all", selector, uuids: allUuids, unresolvedTokens: [] };
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

function uniqueUuids(uuids: readonly string[]): string[] {
  return [...new Set(uuids)];
}

function invalidUuidRequest(uuids: readonly string[]): InvalidGpuLeaseUuid | null {
  const invalidUuids = uniqueUuids(uuids).filter((uuid) => !fullNvidiaUuid.test(uuid));
  return invalidUuids.length > 0 ? new InvalidGpuLeaseUuid(invalidUuids) : null;
}

function leaseSnapshot(leases: ReadonlyMap<string, GpuLeaseOwner>): readonly GpuLease[] {
  return [...leases]
    .map(([uuid, owner]) => ({ uuid, owner }))
    .sort((left, right) => left.uuid.localeCompare(right.uuid));
}

function conflictingLeases(
  leases: ReadonlyMap<string, GpuLeaseOwner>,
  owner: GpuLeaseOwner,
  uuids: readonly string[],
): GpuLeaseConflictEntry[] {
  const conflicts: GpuLeaseConflictEntry[] = [];
  for (const uuid of uuids) {
    const heldBy = leases.get(uuid);
    if (heldBy && heldBy !== owner) conflicts.push({ uuid, heldBy });
  }
  return conflicts;
}

function releaseOwnerLeases(
  leases: Map<string, GpuLeaseOwner>,
  owner: GpuLeaseOwner,
  uuids?: readonly string[],
): void {
  for (const [uuid, heldBy] of leases) {
    if (heldBy === owner && (!uuids || uuids.includes(uuid))) leases.delete(uuid);
  }
}

export function createGpuLeaseRegistry(): GpuLeaseRegistry {
  const leases = new Map<string, GpuLeaseOwner>();
  const semaphore = Semaphore.makeUnsafe(1);
  const assign = (
    owner: GpuLeaseOwner,
    requestedUuids: readonly string[],
    replace: boolean,
  ): Effect.Effect<readonly GpuLease[], GpuLeaseConflict | InvalidGpuLeaseUuid> =>
    semaphore.withPermit(
      Effect.gen(function* () {
        const requested = uniqueUuids(requestedUuids);
        const invalid = invalidUuidRequest(requested);
        if (invalid) return yield* Effect.fail(invalid);
        const uuids = uniqueUuids(requested.map(canonicalNvidiaUuid));
        const conflicts = conflictingLeases(leases, owner, uuids);
        if (conflicts.length > 0) return yield* Effect.fail(new GpuLeaseConflict(owner, conflicts));
        if (replace) releaseOwnerLeases(leases, owner);
        for (const uuid of uuids) leases.set(uuid, owner);
        return leaseSnapshot(leases);
      }),
    );
  const release = (
    owner: GpuLeaseOwner,
    requestedUuids?: readonly string[],
  ): Effect.Effect<readonly GpuLease[], InvalidGpuLeaseUuid> =>
    semaphore.withPermit(
      Effect.gen(function* () {
        const requested = requestedUuids ? uniqueUuids(requestedUuids) : undefined;
        const invalid = requested ? invalidUuidRequest(requested) : null;
        if (invalid) return yield* Effect.fail(invalid);
        const uuids = requested?.map(canonicalNvidiaUuid);
        releaseOwnerLeases(leases, owner, uuids);
        return leaseSnapshot(leases);
      }),
    );
  return {
    claim: (owner, uuids) => assign(owner, uuids, false),
    replace: (owner, uuids) => assign(owner, uuids, true),
    release,
    snapshot: () => semaphore.withPermit(Effect.sync(() => leaseSnapshot(leases))),
  };
}
