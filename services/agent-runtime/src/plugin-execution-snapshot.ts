import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  opendir,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { Effect, Semaphore } from "effect";
import type { ConnectorConfig } from "./connector-contract";
import { resolveDataDir } from "./data-dir";
import {
  closePendingPooledConnections,
  closeSnapshotConnections,
  hasPendingPooledConnections,
} from "./connector-pool-state";
import { pluginArtifactDigest } from "./plugin-artifact-digest";
import { pluginConnectorConfigurationDigest } from "./plugin-connector-identity";
import type { PluginBundle } from "./plugin-discovery";

export class PluginExecutionSnapshotError extends Error {}

declare const pluginExecutionSnapshotLease: unique symbol;

export type PluginExecutionSnapshotLease = {
  readonly [pluginExecutionSnapshotLease]: true;
};

const snapshotLifecycle = Semaphore.makeUnsafe(1);
const activeLifecycles = new WeakSet<PluginExecutionSnapshotLease>();

export function withPluginExecutionSnapshotLifecycle<A, E, R>(
  use: (lifecycle: PluginExecutionSnapshotLease) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return snapshotLifecycle.withPermit(
    Effect.suspend(() => {
      const lifecycle = {} as PluginExecutionSnapshotLease;
      activeLifecycles.add(lifecycle);
      return use(lifecycle).pipe(
        Effect.ensuring(Effect.sync(() => activeLifecycles.delete(lifecycle))),
      );
    }),
  );
}

function assertActiveLifecycle(lifecycle: PluginExecutionSnapshotLease): void {
  if (!activeLifecycles.has(lifecycle)) {
    throw new PluginExecutionSnapshotError("Plugin execution snapshot lifecycle is inactive");
  }
}

type PathIdentity = {
  dev: number;
  ino: number;
};

type SnapshotStorageGuard = {
  root: string;
  assertRoot: (currentRoot?: string) => Promise<void>;
  close: () => Promise<void>;
};

const pathIdentity = (stats: { dev: number; ino: number }): PathIdentity => ({
  dev: stats.dev,
  ino: stats.ino,
});

const samePathIdentity = (left: PathIdentity, right: PathIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino;

async function privateDirectoryIdentity(entryPath: string): Promise<PathIdentity> {
  const stats = await lstat(entryPath);
  const getuid = process.getuid;
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    (typeof getuid === "function" && stats.uid !== getuid.call(process)) ||
    (stats.mode & 0o077) !== 0
  ) {
    throw new PluginExecutionSnapshotError("Plugin snapshot storage is invalid");
  }
  return pathIdentity(stats);
}

async function ensurePrivateDirectory(entryPath: string): Promise<PathIdentity> {
  try {
    await mkdir(entryPath, { mode: 0o700 });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  return privateDirectoryIdentity(entryPath);
}

async function acquireSnapshotStorage(create: boolean): Promise<SnapshotStorageGuard> {
  const dataRoot = resolveDataDir();
  const runtimeRoot = path.join(dataRoot, "runtime");
  const root = path.join(runtimeRoot, "plugin-executables");
  const dataIdentity = await privateDirectoryIdentity(dataRoot);
  const runtimeIdentity = create
    ? await ensurePrivateDirectory(runtimeRoot)
    : await privateDirectoryIdentity(runtimeRoot);
  const rootIdentity = create
    ? await ensurePrivateDirectory(root)
    : await privateDirectoryIdentity(root);
  if (typeof constants.O_DIRECTORY !== "number" || typeof constants.O_NOFOLLOW !== "number") {
    throw new PluginExecutionSnapshotError("Plugin snapshot storage cannot be verified");
  }
  const handle = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const assertRoot = async (currentRoot = root): Promise<void> => {
    const [currentData, currentRuntime, currentPath, currentHandle] = await Promise.all([
      privateDirectoryIdentity(dataRoot),
      privateDirectoryIdentity(runtimeRoot),
      privateDirectoryIdentity(currentRoot),
      handle.stat().then(pathIdentity),
    ]);
    if (
      !samePathIdentity(dataIdentity, currentData) ||
      !samePathIdentity(runtimeIdentity, currentRuntime) ||
      !samePathIdentity(rootIdentity, currentPath) ||
      !samePathIdentity(rootIdentity, currentHandle)
    ) {
      throw new PluginExecutionSnapshotError("Plugin snapshot storage changed");
    }
  };
  try {
    await assertRoot();
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
  return {
    root,
    assertRoot,
    close: () => handle.close(),
  };
}

const contained = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

async function fileDigest(file: string): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    const before = await handle.stat();
    if (!before.isFile()) throw new PluginExecutionSnapshotError("Plugin runtime is invalid");
    while (position < before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (bytesRead === 0) throw new PluginExecutionSnapshotError("Plugin runtime changed while copying");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new PluginExecutionSnapshotError("Plugin runtime changed while copying");
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function hardenTree(root: string): Promise<void> {
  const visit = async (entryPath: string): Promise<void> => {
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      const directory = await opendir(entryPath);
      for await (const entry of directory) await visit(path.join(entryPath, entry.name));
      await chmod(entryPath, 0o500);
      return;
    }
    if (!stats.isFile()) throw new PluginExecutionSnapshotError("Plugin snapshot contains an unsupported entry");
    await chmod(entryPath, stats.mode & 0o111 ? 0o500 : 0o400);
  };
  await visit(root);
}

async function assertHardened(root: string): Promise<void> {
  const visit = async (entryPath: string): Promise<void> => {
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) return;
    if ((stats.mode & 0o0222) !== 0) throw new PluginExecutionSnapshotError("Plugin snapshot is writable");
    if (stats.isDirectory()) {
      const directory = await opendir(entryPath);
      for await (const entry of directory) await visit(path.join(entryPath, entry.name));
      return;
    }
    if (!stats.isFile()) throw new PluginExecutionSnapshotError("Plugin snapshot contains an unsupported entry");
  };
  await visit(root);
}

async function assertSnapshotPath(root: string, value: string): Promise<void> {
  if (!path.isAbsolute(value) || !contained(root, value)) {
    throw new PluginExecutionSnapshotError("Plugin snapshot path changed");
  }
  const { realpath } = await import("node:fs/promises");
  const [canonicalRoot, canonical] = await Promise.all([realpath(root), realpath(value)]);
  if (!contained(canonicalRoot, canonical)) throw new PluginExecutionSnapshotError("Plugin snapshot path changed");
}

async function removeTree(root: string): Promise<void> {
  try {
    const stats = await lstat(root);
    if (stats.isSymbolicLink()) {
      await unlink(root);
      return;
    }
    if (!stats.isDirectory()) {
      await chmod(root, 0o600);
      await unlink(root);
      return;
    }
    await chmod(root, 0o700);
    const directory = await opendir(root);
    for await (const entry of directory) await removeTree(path.join(root, entry.name));
    await rmdir(root);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

export async function quarantinePluginExecutionSnapshot(
  entryPath: string,
): Promise<string | undefined> {
  const parent = path.dirname(entryPath);
  const quarantined = path.join(parent, `.garbage-${process.pid}-${randomUUID()}`);
  try {
    await rename(entryPath, quarantined);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return quarantined;
}

async function quarantineAndRemove(
  entryPath: string,
  validate: () => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  await validate();
  let identity: PathIdentity;
  try {
    identity = pathIdentity(await lstat(entryPath));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const quarantined = await quarantinePluginExecutionSnapshot(entryPath);
  if (!quarantined) return;
  await validate();
  if (!samePathIdentity(identity, pathIdentity(await lstat(quarantined)))) {
    throw new PluginExecutionSnapshotError("Plugin snapshot entry changed");
  }
  await removeTree(quarantined);
  await validate();
}

const mapIntoSnapshot = (sourceRoot: string, artifactRoot: string, value: string): string => {
  if (!contained(sourceRoot, value)) throw new PluginExecutionSnapshotError("Plugin executable path escapes its bundle");
  return path.join(artifactRoot, path.relative(sourceRoot, value));
};

async function snapshotConnector(bundle: PluginBundle, connector: ConnectorConfig): Promise<ConnectorConfig> {
  if (connector.transport !== "stdio" || !connector.command) return connector;
  const storage = await acquireSnapshotStorage(true);
  const destination = path.join(storage.root, bundle.artifactDigest.replace("sha256:", ""));
  const artifactRoot = path.join(destination, "artifact");
  const sourceRoot = await import("node:fs/promises").then(({ realpath }) => realpath(bundle.rootDir));
  const runtimeCommand = connector.command === process.execPath;
  const temp = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await storage.assertRoot();
    await quarantineAndRemove(temp, storage.assertRoot);
    await mkdir(temp, { mode: 0o700 });
    await cp(sourceRoot, path.join(temp, "artifact"), { recursive: true, dereference: false, verbatimSymlinks: true });
    await storage.assertRoot();
    const copiedDigest = await Effect.runPromise(pluginArtifactDigest(path.join(temp, "artifact")));
    if (copiedDigest !== bundle.artifactDigest) throw new PluginExecutionSnapshotError("Plugin artifact changed while snapshotting");
    let runtimeDigest: string | undefined;
    if (runtimeCommand) {
      runtimeDigest = await fileDigest(process.execPath);
    }
    await hardenTree(temp);
    await storage.assertRoot();
    await quarantineAndRemove(destination, storage.assertRoot);
    await rename(temp, destination);
    await storage.assertRoot();
    const snapshotDigest = await Effect.runPromise(pluginArtifactDigest(artifactRoot));
    const prepared: ConnectorConfig = {
      ...connector,
      command: runtimeCommand ? process.execPath : mapIntoSnapshot(sourceRoot, artifactRoot, connector.command),
      args: connector.args?.map((value) => contained(sourceRoot, value) ? mapIntoSnapshot(sourceRoot, artifactRoot, value) : value),
      cwd: connector.cwd ? mapIntoSnapshot(sourceRoot, artifactRoot, connector.cwd) : artifactRoot,
      origin: connector.origin ? { ...connector.origin, snapshotDigest, ...(runtimeDigest ? { runtimeDigest } : {}) } : connector.origin,
    };
    return prepared.origin
      ? { ...prepared, origin: { ...prepared.origin, configurationDigest: pluginConnectorConfigurationDigest(prepared) } }
      : prepared;
  } finally {
    try {
      await quarantineAndRemove(temp, storage.assertRoot);
    } finally {
      await storage.close().catch(() => undefined);
    }
  }
}

export function preparePluginExecutionSnapshot(
  bundle: PluginBundle,
  connector: ConnectorConfig,
  lifecycle: PluginExecutionSnapshotLease,
): Effect.Effect<ConnectorConfig, PluginExecutionSnapshotError> {
  return Effect.uninterruptible(
    Effect.tryPromise({
      try: () => {
        assertActiveLifecycle(lifecycle);
        return snapshotConnector(bundle, connector);
      },
      catch: (error) =>
        error instanceof PluginExecutionSnapshotError
          ? error
          : new PluginExecutionSnapshotError("Plugin execution snapshot failed"),
    }),
  );
}

const referencedSnapshotNames = (connectors: ConnectorConfig[]): Set<string> =>
  new Set(
    connectors.flatMap((connector) => {
      const origin = connector.origin;
      const approved = connector.enabled || Boolean(connector.allowTools?.length);
      return connector.transport === "stdio" &&
        origin?.kind === "plugin" &&
        origin.artifactDigest &&
        origin.configurationDigest &&
        origin.snapshotDigest &&
        origin.sourceDigest &&
        approved
        ? [origin.artifactDigest.replace("sha256:", "")]
        : [];
    }),
  );

async function collectSnapshots(connectors: ConnectorConfig[]): Promise<void> {
  await closeSnapshotConnections();
  await closePendingPooledConnections();
  if (hasPendingPooledConnections()) return;
  let storage: SnapshotStorageGuard | undefined;
  try {
    storage = await acquireSnapshotStorage(false);
    await storage.assertRoot();
    const directory = await opendir(storage.root);
    const retained = referencedSnapshotNames(connectors);
    for await (const entry of directory) {
      if (retained.has(entry.name)) continue;
      await quarantineAndRemove(
        path.join(storage.root, entry.name),
        storage.assertRoot,
      );
    }
    await storage.assertRoot();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}

export function garbageCollectPluginExecutionSnapshots(
  connectors: ConnectorConfig[],
  lifecycle: PluginExecutionSnapshotLease,
): Effect.Effect<void, PluginExecutionSnapshotError> {
  return Effect.tryPromise({
    try: () => {
      assertActiveLifecycle(lifecycle);
      return collectSnapshots(connectors);
    },
    catch: () => new PluginExecutionSnapshotError("Plugin execution snapshot cleanup failed"),
  });
}

export function expectedPluginExecutionSnapshot(
  bundle: PluginBundle,
  connector: ConnectorConfig,
  existing: ConnectorConfig,
): Effect.Effect<ConnectorConfig, PluginExecutionSnapshotError> {
  return Effect.tryPromise({
    try: async () => {
      if (!connector.origin || !existing.origin?.snapshotDigest || connector.transport !== "stdio" || !connector.command) {
        throw new PluginExecutionSnapshotError("Plugin execution snapshot identity is missing");
      }
      const storage = await acquireSnapshotStorage(false);
      try {
        await storage.assertRoot();
        const connectorOrigin = connector.origin;
        const sourceRoot = await import("node:fs/promises").then(({ realpath }) => realpath(bundle.rootDir));
        const artifactRoot = path.join(
          storage.root,
          bundle.artifactDigest.replace("sha256:", ""),
          "artifact",
        );
        const mapped: ConnectorConfig = {
          ...connector,
          command: connector.command === process.execPath
            ? process.execPath
            : mapIntoSnapshot(sourceRoot, artifactRoot, connector.command),
          args: connector.args?.map((value) =>
            contained(sourceRoot, value) ? mapIntoSnapshot(sourceRoot, artifactRoot, value) : value,
          ),
          cwd: connector.cwd
            ? mapIntoSnapshot(sourceRoot, artifactRoot, connector.cwd)
            : artifactRoot,
          origin: {
            ...connectorOrigin,
            snapshotDigest: existing.origin.snapshotDigest,
            ...(existing.origin.runtimeDigest ? { runtimeDigest: existing.origin.runtimeDigest } : {}),
          },
        };
        await storage.assertRoot();
        return {
          ...mapped,
          origin: {
            ...connectorOrigin,
            snapshotDigest: existing.origin.snapshotDigest,
            ...(existing.origin.runtimeDigest ? { runtimeDigest: existing.origin.runtimeDigest } : {}),
            configurationDigest: pluginConnectorConfigurationDigest(mapped),
          },
        };
      } finally {
        await storage.close().catch(() => undefined);
      }
    },
    catch: (error) =>
      error instanceof PluginExecutionSnapshotError
        ? error
        : new PluginExecutionSnapshotError("Plugin execution snapshot identity failed"),
  });
}

export function verifyPluginExecutionSnapshot(connector: ConnectorConfig): Effect.Effect<void, PluginExecutionSnapshotError> {
  return Effect.tryPromise({
    try: async () => {
      if (connector.transport !== "stdio" || connector.origin?.kind !== "plugin" || !connector.origin.artifactDigest || !connector.origin.snapshotDigest) throw new PluginExecutionSnapshotError("Plugin execution snapshot is missing");
      const storage = await acquireSnapshotStorage(false);
      try {
        await storage.assertRoot();
        const root = path.join(
          storage.root,
          connector.origin.artifactDigest.replace("sha256:", ""),
        );
        const artifactRoot = path.join(root, "artifact");
        await assertHardened(root);
        if ((await Effect.runPromise(pluginArtifactDigest(artifactRoot))) !== connector.origin.snapshotDigest) throw new PluginExecutionSnapshotError("Plugin execution snapshot changed");
        if (connector.command === process.execPath && !connector.origin.runtimeDigest) throw new PluginExecutionSnapshotError("Plugin runtime identity is missing");
        if (connector.origin.runtimeDigest && connector.command !== process.execPath) throw new PluginExecutionSnapshotError("Plugin runtime path changed");
        if (connector.origin.runtimeDigest && (await fileDigest(process.execPath)) !== connector.origin.runtimeDigest) throw new PluginExecutionSnapshotError("Plugin runtime changed");
        if (!connector.origin.runtimeDigest) await assertSnapshotPath(artifactRoot, connector.command ?? "");
        await assertSnapshotPath(artifactRoot, connector.cwd ?? "");
        for (const value of connector.args ?? []) {
          if (path.isAbsolute(value)) await assertSnapshotPath(artifactRoot, value);
          else if (value.includes(path.sep)) throw new PluginExecutionSnapshotError("Plugin argument path changed");
        }
        await storage.assertRoot();
      } finally {
        await storage.close().catch(() => undefined);
      }
    },
    catch: (error) => error instanceof PluginExecutionSnapshotError ? error : new PluginExecutionSnapshotError("Plugin execution snapshot could not be verified"),
  });
}
