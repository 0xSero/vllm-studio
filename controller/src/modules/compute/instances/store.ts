import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Effect, Exit } from "effect";
import type {
  DeviceId,
  EngineId,
  InstanceRecord,
  LaunchFailure,
  NodeId,
  EngineRuntimeKind,
} from "../contracts";

export interface InstanceStore {
  readonly directory: string;
  readonly read: (name: string) => InstanceRecord | null;
  readonly all: () => readonly InstanceRecord[];
  readonly write: (record: InstanceRecord) => void;
  readonly drop: (name: string) => void;
  readonly acquire: (record: Omit<InstanceRecord, "nonce">) => InstanceRecord | null;
  readonly replace: (record: InstanceRecord, attemptNonce: string) => boolean;
  readonly release: (name: string, attemptNonce: string) => boolean;
  readonly logPath: (name: string) => string;
  readonly reserve: (
    reservation: Reservation,
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ) => Effect.Effect<InstanceRecord, LaunchFailure>;
  readonly heldDevices: (
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ) => Effect.Effect<ReadonlySet<DeviceId>>;
  readonly allocatePort: (basePort: number, attemptNonce?: string) => number;
}

const PLACEMENT_RETRY_LIMIT = 8;

export interface Reservation {
  readonly name: string;
  readonly nodeId: NodeId;
  readonly engine: EngineId;
  readonly recipeId: string;
  readonly runtime: EngineRuntimeKind;
  readonly attemptNonce: string;
  readonly candidates: readonly DeviceId[];
  readonly need: number;
  /** Unified-memory accelerators (Apple Silicon, DGX Spark) are shared by design: the
   *  SoC is one pool and RAM is the real budget, so instances stack on the same device
   *  instead of leasing it exclusively. */
  readonly shareable: boolean;
  readonly basePort: number;
  /** Reserve exactly this port (legacy inference_port semantics) instead of scanning
   *  upward from basePort; fails when something else already holds it. */
  readonly exactPort?: number;
  readonly readyDeadlineMs: number;
  readonly isCancelled?: () => boolean;
}

/** Names come from recipes but stop/drop accept user input — keep them inside the dir. */
const safeName = (name: string): string => name.replace(/[/\\]/g, "_");

const isRecord = (value: unknown): value is InstanceRecord =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as InstanceRecord).name === "string" &&
  typeof (value as InstanceRecord).engine === "string" &&
  typeof (value as InstanceRecord).port === "number" &&
  Array.isArray((value as InstanceRecord).devices);

/* ── store ───────────────────────────────────────────────────────────────── */

type MutationPayload =
  | { readonly operation: "write"; readonly record: InstanceRecord }
  | { readonly operation: "drop"; readonly name: string };
type JournalEntry =
  | ({ readonly type: "mutation"; readonly id: string } & MutationPayload)
  | { readonly type: "done"; readonly id: string };

export const makeInstanceStore = (dataDirectory: string): InstanceStore => {
  const directory = join(dataDirectory, "instances");
  const logsDirectory = join(directory, "logs");
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const mutationPath = join(directory, "mutations.sqlite");
  const journalPath = join(directory, "mutations.journal");
  const recordPath = (name: string): string => join(directory, `${safeName(name)}.json`);

  const appendJournal = (entry: JournalEntry): void => {
    const file = openSync(journalPath, "a", 0o600);
    try {
      writeFileSync(file, `${JSON.stringify(entry)}\n`);
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
  };

  const writeJournal = (entries: readonly JournalEntry[]): void => {
    const temporaryPath = `${journalPath}.tmp`;
    writeFileSync(
      temporaryPath,
      entries.length === 0 ? "" : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      { mode: 0o600 },
    );
    renameSync(temporaryPath, journalPath);
  };

  const readJournal = (): JournalEntry[] => {
    let entries: JournalEntry[] = [];
    try {
      entries = readFileSync(journalPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JournalEntry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return entries;
  };

  const replayJournal = (): void => {
    const entries = readJournal();
    if (entries.length === 0) return;
    const database = openMutationDatabase();
    try {
      database.run("BEGIN IMMEDIATE");
      database.run("UPDATE instance_store_mutex SET generation = generation + 1 WHERE id = 1");
      const completed = new Set(
        entries
          .filter(
            (entry): entry is Extract<JournalEntry, { type: "done" }> => entry.type === "done",
          )
          .map((entry) => entry.id),
      );
      for (const entry of entries) {
        if (entry.type === "done" || completed.has(entry.id)) continue;
        if (entry.operation === "write") writeRecordRaw(entry.record);
        else dropRecordRaw(entry.name);
      }
      writeJournal([]);
      database.run("COMMIT");
    } catch (error) {
      try {
        database.run("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      database.close();
    }
  };

  const openMutationDatabase = (): Database => {
    const database = new Database(mutationPath, { create: true });
    database.run("PRAGMA busy_timeout = 5000");
    return database;
  };
  const initialize = openMutationDatabase();
  initialize.run("CREATE TABLE IF NOT EXISTS instance_store_mutex (id INTEGER PRIMARY KEY, generation INTEGER NOT NULL)");
  initialize.run("INSERT OR IGNORE INTO instance_store_mutex (id, generation) VALUES (1, 0)");
  initialize.close();
  chmodSync(mutationPath, 0o600);
  let activeMutationId: string | null = null;
  const mutationJournal = (entry: MutationPayload): void => {
    if (activeMutationId === null) throw new Error("mutation journal is not active");
    appendJournal({ type: "mutation", id: activeMutationId, ...entry } as JournalEntry);
  };

  const completeMutation = (id: string): void => {
    try {
      appendJournal({ type: "done", id });
    } catch {}
  };

  const compactJournal = (): void => {
    const entries = readJournal();
    if (entries.length === 0) return;
    const completed = new Set(
      entries
        .filter((entry): entry is Extract<JournalEntry, { type: "done" }> => entry.type === "done")
        .map((entry) => entry.id),
    );
    writeJournal(entries.filter((entry) => entry.type === "mutation" && !completed.has(entry.id)));
  };

  const mutate = <A>(operation: () => A): A => {
    const database = openMutationDatabase();
    try {
      database.run("BEGIN IMMEDIATE");
      database.run("UPDATE instance_store_mutex SET generation = generation + 1 WHERE id = 1");
      compactJournal();
      activeMutationId = randomUUID();
      const mutationId = activeMutationId;
      const result = operation();
      database.run("COMMIT");
      completeMutation(mutationId);
      return result;
    } catch (error) {
      try {
        database.run("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      activeMutationId = null;
      database.close();
    }
  };

  const mutateEffect = <A, E>(
    operation: () => Effect.Effect<A, E>,
    isCancelled: () => boolean = () => false,
  ): Effect.Effect<A, E | LaunchFailure> =>
    Effect.acquireUseRelease(
      Effect.gen(function* () {
        const startedAt = Date.now();
        while (true) {
          if (isCancelled()) {
            return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
          }
          const database = openMutationDatabase();
          database.run("PRAGMA busy_timeout = 0");
          try {
            database.run("BEGIN IMMEDIATE");
            database.run(
              "UPDATE instance_store_mutex SET generation = generation + 1 WHERE id = 1",
            );
            compactJournal();
            return database;
          } catch (error) {
            database.close();
            if (!/busy|locked/u.test(String(error).toLowerCase())) throw error;
            if (Date.now() - startedAt > 5_000) {
              return yield* Effect.fail<LaunchFailure>({
                kind: "spawn-failed",
                detail: "instance placement transaction remained busy",
              });
            }
            if (isCancelled()) {
              return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
            }
            yield* Effect.sleep(25);
          }
        }
      }),
      (database) =>
        Effect.gen(function* () {
          activeMutationId = randomUUID();
          const mutationId = activeMutationId;
          const result = yield* operation();
          yield* Effect.sync(() => database.run("COMMIT"));
          completeMutation(mutationId);
          return result;
        }),
      (database, exit) =>
        Effect.sync(() => {
          if (!Exit.isSuccess(exit)) {
            try {
              database.run("ROLLBACK");
            } catch {}
          }
          activeMutationId = null;
          database.close();
        }),
    );

  const read = (name: string): InstanceRecord | null => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(recordPath(name), "utf8"));
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const all = (): readonly InstanceRecord[] => {
    try {
      return readdirSync(directory)
        .filter((file) => file.endsWith(".json"))
        .map((file) => read(file.slice(0, -".json".length)))
        .filter((record): record is InstanceRecord => record !== null);
    } catch {
      return [];
    }
  };

  const writeRecordRaw = (record: InstanceRecord): void => {
    const path = recordPath(record.name);
    writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 2));
    renameSync(`${path}.tmp`, path);
  };

  const dropRecordRaw = (name: string): void => rmSync(recordPath(name), { force: true });

  const writeRecord = (record: InstanceRecord): void => {
    mutationJournal({ operation: "write", record });
    writeRecordRaw(record);
  };

  const dropRecord = (name: string): void => {
    mutationJournal({ operation: "drop", name });
    dropRecordRaw(name);
  };

  replayJournal();

  const write = (record: InstanceRecord): void => mutate(() => writeRecord(record));
  const drop = (name: string): void => mutate(() => dropRecord(name));
  const acquire = (seed: Omit<InstanceRecord, "nonce">): InstanceRecord | null => {
    const record = { ...seed, nonce: randomUUID() };
    return mutate(() => {
      if (existsSync(recordPath(record.name))) return null;
      writeRecord(record);
      return record;
    });
  };

  const replace = (record: InstanceRecord, attemptNonce: string): boolean =>
    mutate(() => {
      if (record.nonce !== attemptNonce || read(record.name)?.nonce !== attemptNonce) return false;
      writeRecord(record);
      return true;
    });

  const release = (name: string, attemptNonce: string): boolean =>
    mutate(() => {
      if (read(name)?.nonce !== attemptNonce) return false;
      dropRecord(name);
      return true;
    });

  const heldDevicesFrom = (
    records: readonly InstanceRecord[],
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ): Effect.Effect<ReadonlySet<DeviceId>> =>
    Effect.gen(function* () {
      const held = new Set<DeviceId>();
      for (const record of records) {
        // A reservation with no handle yet still holds its devices — that is the point
        // of reserving before spawning.
        const holds = record.ref === null ? true : yield* alive(record);
        if (holds) for (const device of record.devices) held.add(device);
      }
      return held;
    });

  const heldDevices = (
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ): Effect.Effect<ReadonlySet<DeviceId>> => heldDevicesFrom(all(), alive);

  const recordFingerprint = (records: readonly InstanceRecord[]): string =>
    JSON.stringify([...records].sort((left, right) => left.name.localeCompare(right.name)));

  // Record-held ports are not enough: an unrelated process (an orphaned dev server, a
  // hand-started engine) can squat a port and answer 200 on /health, and a launch that
  // lands on it would be declared ready by someone else's server. A bind probe is the
  // only honest test of "free".
  // Both interfaces: engines bind 127.0.0.1, dev servers bind 0.0.0.0, and macOS lets a
  // specific-interface bind coexist with a wildcard one — probing only loopback would
  // declare a wildcard-held port free.
  const portIsBindable = (port: number): boolean => {
    for (const hostname of ["127.0.0.1", "0.0.0.0"]) {
      try {
        const listener = Bun.listen({ hostname, port, socket: { data: () => {} } });
        listener.stop(true);
      } catch {
        return false;
      }
    }
    return true;
  };

  const allocatePort = (basePort: number, attemptNonce?: string): number => {
    const used = new Set(
      all()
        .filter((record) => record.nonce !== attemptNonce)
        .map((record) => record.port),
    );
    let port = basePort;
    while (used.has(port) || !portIsBindable(port)) port += 1;
    return port;
  };

  const reserve = (
    reservation: Reservation,
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ): Effect.Effect<InstanceRecord, LaunchFailure> =>
    Effect.gen(function* () {
      let placementRetries = 0;
      while (true) {
        if (reservation.isCancelled?.()) {
          return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
        }
        const snapshot = all();
        const snapshotId = recordFingerprint(snapshot);
        const attempt = snapshot.find((record) => record.name === reservation.name) ?? null;
        if (attempt?.nonce !== reservation.attemptNonce) {
          return yield* Effect.fail<LaunchFailure>({
            kind: "already-running",
            name: reservation.name,
          });
        }
        const held = reservation.shareable
          ? new Set<DeviceId>()
          : yield* heldDevicesFrom(snapshot, alive);
        const free = reservation.candidates.filter((device) => !held.has(device));
        if (free.length < reservation.need) {
          return yield* Effect.fail<LaunchFailure>({
            kind: "no-capacity",
            need: reservation.need,
            free: free.length,
          });
        }
        const outcome = yield* mutateEffect(() =>
          Effect.gen(function* () {
            if (recordFingerprint(all()) !== snapshotId) {
              return { kind: "placement-retry" as const };
            }
            const current = read(reservation.name);
            if (current?.nonce !== reservation.attemptNonce) {
              return yield* Effect.fail<LaunchFailure>({
                kind: "already-running",
                name: reservation.name,
              });
            }
            let port: number;
            if (reservation.exactPort !== undefined) {
              const takenByRecord = all().some(
                (record) =>
                  record.nonce !== reservation.attemptNonce && record.port === reservation.exactPort,
              );
              if (takenByRecord || !portIsBindable(reservation.exactPort)) {
                return yield* Effect.fail<LaunchFailure>({
                  kind: "spawn-failed",
                  detail: `port ${reservation.exactPort} is already in use`,
                });
              }
              port = reservation.exactPort;
            } else {
              port = allocatePort(reservation.basePort, reservation.attemptNonce);
            }
            const now = Date.now();
            const reserved: InstanceRecord = {
              name: reservation.name,
              nodeId: reservation.nodeId,
              engine: reservation.engine,
              recipeId: reservation.recipeId,
              runtime: reservation.runtime,
              ref: null,
              port,
              devices: free.slice(0, reservation.need),
              nonce: reservation.attemptNonce,
              startedAt: current.startedAt,
              readyDeadlineAt: new Date(now + reservation.readyDeadlineMs).toISOString(),
            };
            writeRecord(reserved);
            return reserved;
          }),
          reservation.isCancelled,
        );
        if (!("kind" in outcome)) return outcome;
        placementRetries += 1;
        if (reservation.isCancelled?.()) {
          return yield* Effect.fail<LaunchFailure>({ kind: "cancelled" });
        }
        if (placementRetries >= PLACEMENT_RETRY_LIMIT) {
          return yield* Effect.fail<LaunchFailure>({
            kind: "spawn-failed",
            detail: "instance placement changed too often",
          });
        }
      }
    });

  return {
    directory,
    read,
    all,
    write,
    drop,
    acquire,
    replace,
    release,
    logPath: (name: string) => join(logsDirectory, `${safeName(name)}.log`),
    reserve,
    heldDevices,
    allocatePort,
  };
};
