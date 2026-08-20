import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  chmodSync,
  constants,
  cpSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { lstat, open, opendir, rename } from "node:fs/promises";
import path from "node:path";
import { Effect, Semaphore } from "effect";
import type { ConnectorConfig } from "./connector-contract";
import { resolveDataDir } from "./data-dir";
import { closeSnapshotConnections, hasPendingPooledConnections } from "./connector-pool-state";
import { pluginArtifactDigest } from "./plugin-artifact-digest";
import { pluginConnectorConfigurationDigest } from "./plugin-connector-identity";
import type { PluginBundle } from "./plugin-discovery";

export class PluginExecutionSnapshotError extends Error {}

declare const pluginExecutionSnapshotLease: unique symbol;

export type PluginExecutionSnapshotLease = {
  readonly [pluginExecutionSnapshotLease]: true;
};

const snapshotLifecycle = Semaphore.makeUnsafe(1);
const snapshotPublicationCwd = Semaphore.makeUnsafe(1);
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
  uid: number;
  mode: number;
};

type SnapshotStorageGuard = {
  root: string;
  rootIdentity: PathIdentity;
  runtimeIdentity: PathIdentity;
  stagingRoot?: string;
  stagingIdentity?: PathIdentity;
  assertRoot: (currentRoot?: string) => Promise<void>;
  close: () => Promise<void>;
};

type SnapshotPublicationClaim = {
  assertCurrent: () => Promise<void>;
  identity: PathIdentity;
  close: () => Promise<void>;
};

const pathIdentity = (stats: { dev: number; ino: number; uid: number; mode: number }): PathIdentity => ({
  dev: stats.dev,
  ino: stats.ino,
  uid: stats.uid,
  mode: stats.mode & 0o7777,
});

const samePathIdentity = (left: PathIdentity, right: PathIdentity): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.uid === right.uid &&
  left.mode === right.mode;

function assertPrivateDirectoryStats(stats: {
  isSymbolicLink: () => boolean;
  isDirectory: () => boolean;
  dev: number;
  ino: number;
  uid: number;
  mode: number;
}): PathIdentity {
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

async function privateDirectoryIdentity(entryPath: string): Promise<PathIdentity> {
  return assertPrivateDirectoryStats(await lstat(entryPath));
}

function ensurePrivateDirectoryEntrySync(
  parent: string,
  parentIdentity: PathIdentity,
  name: string,
): PathIdentity {
  return withVerifiedStorageWorkingDirectory(parent, parentIdentity, () => {
    try {
      mkdirSync(name, { mode: 0o700 });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }
    }
    const created = assertPrivateDirectoryStats(lstatSync(name));
    const handle = openSync(name, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const opened = pathIdentity(fstatSync(handle));
      if (!samePathIdentity(created, opened)) {
        throw new PluginExecutionSnapshotError("Plugin snapshot storage changed");
      }
      return opened;
    } finally {
      closeSync(handle);
    }
  });
}

async function ensurePrivateDirectory(
  parent: string,
  parentIdentity: PathIdentity,
  name: string,
): Promise<PathIdentity> {
  return Effect.runPromise(
    snapshotPublicationCwd.withPermit(
      Effect.sync(() => ensurePrivateDirectoryEntrySync(parent, parentIdentity, name)),
    ),
  );
}

async function acquireSnapshotStorage(create: boolean): Promise<SnapshotStorageGuard> {
  const dataRoot = resolveDataDir();
  const runtimeRoot = path.join(dataRoot, "runtime");
  const root = path.join(runtimeRoot, "plugin-executables");
  const stagingRoot = create ? path.join(runtimeRoot, ".plugin-staging") : undefined;
  const dataIdentity = await privateDirectoryIdentity(dataRoot);
  const runtimeIdentity = create
    ? await ensurePrivateDirectory(dataRoot, dataIdentity, "runtime")
    : await privateDirectoryIdentity(runtimeRoot);
  const rootIdentity = create
    ? await ensurePrivateDirectory(runtimeRoot, runtimeIdentity, "plugin-executables")
    : await privateDirectoryIdentity(root);
  const stagingIdentity = stagingRoot
    ? await ensurePrivateDirectory(runtimeRoot, runtimeIdentity, ".plugin-staging")
    : undefined;
  if (typeof constants.O_DIRECTORY !== "number" || typeof constants.O_NOFOLLOW !== "number") {
    throw new PluginExecutionSnapshotError("Plugin snapshot storage cannot be verified");
  }
  const handle = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const assertRoot = async (currentRoot = root): Promise<void> => {
    const [currentData, currentRuntime, currentPath, currentHandle, currentStaging] =
      await Promise.all([
        privateDirectoryIdentity(dataRoot),
        privateDirectoryIdentity(runtimeRoot),
        privateDirectoryIdentity(currentRoot),
        handle.stat().then(pathIdentity),
        stagingRoot ? privateDirectoryIdentity(stagingRoot) : Promise.resolve(undefined),
      ]);
    if (
      !samePathIdentity(dataIdentity, currentData) ||
      !samePathIdentity(runtimeIdentity, currentRuntime) ||
      !samePathIdentity(rootIdentity, currentPath) ||
      !samePathIdentity(rootIdentity, currentHandle) ||
      (stagingIdentity !== undefined &&
        (currentStaging === undefined || !samePathIdentity(stagingIdentity, currentStaging)))
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
    rootIdentity,
    runtimeIdentity,
    ...(stagingRoot ? { stagingRoot } : {}),
    ...(stagingIdentity ? { stagingIdentity } : {}),
    assertRoot,
    close: () => handle.close(),
  };
}

const contained = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const CANONICAL_SHA256 = /^sha256:[0-9a-f]{64}$/;

function canonicalDigestSuffix(value: string): string {
  if (!CANONICAL_SHA256.test(value)) {
    throw new PluginExecutionSnapshotError("Plugin snapshot identity is invalid");
  }
  return value.slice("sha256:".length);
}

function snapshotDirectory(root: string, artifactDigest: string): string {
  const candidate = path.join(root, canonicalDigestSuffix(artifactDigest));
  if (!contained(root, candidate)) {
    throw new PluginExecutionSnapshotError("Plugin snapshot path changed");
  }
  return candidate;
}

async function fileDigest(file: string): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    const before = await handle.stat();
    if (!before.isFile()) throw new PluginExecutionSnapshotError("Plugin runtime is invalid");
    while (position < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position,
      );
      if (bytesRead === 0)
        throw new PluginExecutionSnapshotError("Plugin runtime changed while copying");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new PluginExecutionSnapshotError("Plugin runtime changed while copying");
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function hardenTreeSync(root: string): void {
  const visit = (entryPath: string): void => {
    const stats = lstatSync(entryPath);
    if (stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      for (const name of readdirSync(entryPath)) visit(path.join(entryPath, name));
      chmodSync(entryPath, 0o500);
      return;
    }
    if (!stats.isFile())
      throw new PluginExecutionSnapshotError("Plugin snapshot contains an unsupported entry");
    chmodSync(entryPath, stats.mode & 0o111 ? 0o500 : 0o400);
  };
  visit(root);
}

async function assertHardened(root: string): Promise<void> {
  const visit = async (entryPath: string): Promise<void> => {
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) return;
    if ((stats.mode & 0o0222) !== 0)
      throw new PluginExecutionSnapshotError("Plugin snapshot is writable");
    if (stats.isDirectory()) {
      const directory = await opendir(entryPath);
      for await (const entry of directory) await visit(path.join(entryPath, entry.name));
      return;
    }
    if (!stats.isFile())
      throw new PluginExecutionSnapshotError("Plugin snapshot contains an unsupported entry");
  };
  await visit(root);
}

async function hardenedSnapshotDigest(
  root: string,
  validate: () => Promise<void>,
): Promise<string | undefined> {
  await validate();
  let before;
  try {
    before = await lstat(root);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  const getuid = process.getuid;
  if (
    before.isSymbolicLink() ||
    !before.isDirectory() ||
    (typeof getuid === "function" && before.uid !== getuid.call(process))
  ) {
    throw new PluginExecutionSnapshotError("Plugin snapshot is invalid");
  }
  const handle = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (!samePathIdentity(pathIdentity(before), pathIdentity(opened))) {
      throw new PluginExecutionSnapshotError("Plugin snapshot changed");
    }
    await assertHardened(root);
    const digest = await Effect.runPromise(pluginArtifactDigest(path.join(root, "artifact")));
    const [after, current] = await Promise.all([handle.stat(), lstat(root)]);
    if (
      !samePathIdentity(pathIdentity(opened), pathIdentity(after)) ||
      !samePathIdentity(pathIdentity(opened), pathIdentity(current))
    ) {
      throw new PluginExecutionSnapshotError("Plugin snapshot changed");
    }
    await validate();
    return digest;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function claimSnapshotDestination(
  root: string,
  parentIdentity: PathIdentity,
  validate: () => Promise<void>,
): Promise<SnapshotPublicationClaim> {
  await validate();
  await Effect.runPromise(
    snapshotPublicationCwd.withPermit(
      Effect.sync(() => {
        withVerifiedStorageWorkingDirectory(path.dirname(root), parentIdentity, () => {
          mkdirSync(path.basename(root), { mode: 0o700 });
        });
      }),
    ),
  );
  await validate();
  let directory: Awaited<ReturnType<typeof open>> | undefined;
  try {
    directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const rootStats = await directory.stat();
    const rootIdentity = pathIdentity(rootStats);
    const assertCurrent = async (): Promise<void> => {
      await validate();
      const [currentRoot, openedRoot] = await Promise.all([lstat(root), directory?.stat()]);
      if (
        !openedRoot ||
        currentRoot.isSymbolicLink() ||
        !currentRoot.isDirectory() ||
        !samePathIdentity(rootIdentity, pathIdentity(currentRoot)) ||
        !samePathIdentity(rootIdentity, pathIdentity(openedRoot))
      ) {
        throw new PluginExecutionSnapshotError("Plugin snapshot claim changed");
      }
    };
    await assertCurrent();
    return {
      assertCurrent,
      identity: rootIdentity,
      close: async () => {
        await directory?.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await directory?.close().catch(() => undefined);
    throw error;
  }
}

function withVerifiedStorageWorkingDirectory<A>(
  root: string,
  expected: PathIdentity,
  use: () => A,
): A {
  const previous = process.cwd();
  const before = lstatSync(root);
  if (
    before.isSymbolicLink() ||
    !before.isDirectory() ||
    !samePathIdentity(expected, pathIdentity(before))
  ) {
    throw new PluginExecutionSnapshotError("Plugin snapshot storage is invalid");
  }
  const handle = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!samePathIdentity(expected, pathIdentity(fstatSync(handle)))) {
      throw new PluginExecutionSnapshotError("Plugin snapshot storage changed");
    }
    process.chdir(root);
    try {
      const current = statSync(".");
      if (!samePathIdentity(expected, pathIdentity(current))) {
        throw new PluginExecutionSnapshotError("Plugin snapshot storage changed");
      }
      return use();
    } finally {
      process.chdir(previous);
    }
  } finally {
    closeSync(handle);
  }
}

function withVerifiedDirectoryEntryWorkingDirectory<A>(
  parent: string,
  parentIdentity: PathIdentity,
  name: string,
  identity: PathIdentity,
  use: () => A,
): A {
  return withVerifiedStorageWorkingDirectory(parent, parentIdentity, () => {
    const entry = lstatSync(name);
    if (
      entry.isSymbolicLink() ||
      !entry.isDirectory() ||
      !samePathIdentity(identity, pathIdentity(entry))
    ) {
      throw new PluginExecutionSnapshotError("Plugin snapshot storage changed");
    }
    process.chdir(name);
    const handle = openSync(".", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (!samePathIdentity(identity, pathIdentity(fstatSync(handle)))) {
        throw new PluginExecutionSnapshotError("Plugin snapshot storage changed");
      }
      return use();
    } finally {
      closeSync(handle);
    }
  });
}

function publishSnapshotDirectory(
  storage: SnapshotStorageGuard,
  destination: string,
  sourceRoot: string,
  artifactDigest: string,
  snapshotDigest: string,
  claim: SnapshotPublicationClaim,
): Effect.Effect<void, PluginExecutionSnapshotError> {
  return snapshotPublicationCwd.withPermit(
    Effect.tryPromise({
      try: async () => {
        await claim.assertCurrent();
        const destinationName = path.basename(destination);
        const candidateName = `.candidate-${process.pid}-${randomUUID()}`;
        const candidatePath = path.join(destination, candidateName);
        let candidateCreated = false;
        let committed = false;
        try {
          withVerifiedStorageWorkingDirectory(storage.root, storage.rootIdentity, () => {
            const destinationEntry = lstatSync(destinationName);
            if (!samePathIdentity(claim.identity, pathIdentity(destinationEntry))) {
              throw new PluginExecutionSnapshotError("Plugin snapshot claim changed");
            }
            process.chdir(destinationName);
            const destinationHandle = openSync(
              ".",
              constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            );
            try {
              if (!samePathIdentity(claim.identity, pathIdentity(fstatSync(destinationHandle)))) {
                throw new PluginExecutionSnapshotError("Plugin snapshot claim changed");
              }
              mkdirSync(candidateName, { mode: 0o700 });
              candidateCreated = true;
              chmodSync(candidateName, lstatSync(sourceRoot).mode & 0o7777);
              cpSync(sourceRoot, candidateName, {
                recursive: true,
                dereference: false,
                verbatimSymlinks: true,
              });
            } finally {
              closeSync(destinationHandle);
            }
          });
          await storage.assertRoot();
          const copiedDigest = await Effect.runPromise(pluginArtifactDigest(candidatePath));
          if (copiedDigest !== artifactDigest) {
            throw new PluginExecutionSnapshotError("Plugin artifact changed while snapshotting");
          }
          withVerifiedStorageWorkingDirectory(storage.root, storage.rootIdentity, () => {
            const destinationEntry = lstatSync(destinationName);
            if (!samePathIdentity(claim.identity, pathIdentity(destinationEntry))) {
              throw new PluginExecutionSnapshotError("Plugin snapshot claim changed");
            }
            process.chdir(destinationName);
            hardenTreeSync(candidateName);
          });
          await storage.assertRoot();
          const copiedSnapshotDigest = await Effect.runPromise(
            pluginArtifactDigest(candidatePath),
          );
          if (copiedSnapshotDigest !== snapshotDigest) {
            throw new PluginExecutionSnapshotError("Plugin snapshot identity changed");
          }
          await claim.assertCurrent();
          withVerifiedStorageWorkingDirectory(storage.root, storage.rootIdentity, () => {
            const destinationEntry = lstatSync(destinationName);
            if (!samePathIdentity(claim.identity, pathIdentity(destinationEntry))) {
              throw new PluginExecutionSnapshotError("Plugin snapshot claim changed");
            }
            process.chdir(destinationName);
            const destinationHandle = openSync(
              ".",
              constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
            );
            try {
              if (!samePathIdentity(claim.identity, pathIdentity(fstatSync(destinationHandle)))) {
                throw new PluginExecutionSnapshotError("Plugin snapshot claim changed");
              }
              const candidateHandle = openSync(
                candidateName,
                constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
              );
              try {
                fchmodSync(candidateHandle, 0o700);
                renameSync(candidateName, "artifact");
                committed = true;
                fchmodSync(candidateHandle, 0o500);
                fchmodSync(destinationHandle, 0o500);
              } finally {
                closeSync(candidateHandle);
              }
            } finally {
              closeSync(destinationHandle);
            }
          });
        } finally {
          if (candidateCreated && !committed) {
            withVerifiedStorageWorkingDirectory(storage.root, storage.rootIdentity, () => {
              const destinationEntry = lstatSync(destinationName);
              if (!samePathIdentity(claim.identity, pathIdentity(destinationEntry))) {
                throw new PluginExecutionSnapshotError("Plugin snapshot claim changed");
              }
              process.chdir(destinationName);
              removeTreeSync(candidateName);
            });
          }
        }
      },
      catch: (error) =>
        error instanceof PluginExecutionSnapshotError
          ? error
          : new PluginExecutionSnapshotError("Plugin snapshot publication failed"),
    }),
  );
}

async function assertSnapshotPath(root: string, value: string): Promise<void> {
  if (!path.isAbsolute(value) || !contained(root, value)) {
    throw new PluginExecutionSnapshotError("Plugin snapshot path changed");
  }
  const { realpath } = await import("node:fs/promises");
  const [canonicalRoot, canonical] = await Promise.all([realpath(root), realpath(value)]);
  if (!contained(canonicalRoot, canonical))
    throw new PluginExecutionSnapshotError("Plugin snapshot path changed");
}

function removeTreeSync(root: string): void {
  try {
    const stats = lstatSync(root);
    if (stats.isSymbolicLink()) {
      unlinkSync(root);
      return;
    }
    if (!stats.isDirectory()) {
      chmodSync(root, 0o600);
      unlinkSync(root);
      return;
    }
    chmodSync(root, 0o700);
    for (const name of readdirSync(root)) removeTreeSync(path.join(root, name));
    rmdirSync(root);
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

function quarantineAndRemoveRelativeSync(entryName: string): void {
  const quarantinedName = `.garbage-${process.pid}-${randomUUID()}`;
  let identity: PathIdentity;
  try {
    identity = pathIdentity(lstatSync(entryName));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  try {
    renameSync(entryName, quarantinedName);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!samePathIdentity(identity, pathIdentity(lstatSync(quarantinedName)))) {
    throw new PluginExecutionSnapshotError("Plugin snapshot entry changed");
  }
  removeTreeSync(quarantinedName);
}

async function withStagingDirectorySync<A>(
  storage: SnapshotStorageGuard,
  use: () => A,
): Promise<A> {
  if (!storage.stagingRoot || !storage.stagingIdentity) {
    throw new PluginExecutionSnapshotError("Plugin snapshot staging is unavailable");
  }
  const stagingRoot = storage.stagingRoot;
  const stagingParent = path.dirname(stagingRoot);
  const stagingName = path.basename(stagingRoot);
  return Effect.runPromise(
    snapshotPublicationCwd.withPermit(
      Effect.sync(() =>
        withVerifiedDirectoryEntryWorkingDirectory(
          stagingParent,
          storage.runtimeIdentity,
          stagingName,
          storage.stagingIdentity!,
          use,
        ),
      ),
    ),
  );
}

async function quarantineAndRemoveStaging(
  storage: SnapshotStorageGuard,
  tempName: string,
): Promise<void> {
  await storage.assertRoot();
  await withStagingDirectorySync(storage, () => quarantineAndRemoveRelativeSync(tempName));
  await storage.assertRoot();
}

async function quarantineAndRemoveSnapshot(
  storage: SnapshotStorageGuard,
  entryName: string,
): Promise<void> {
  await storage.assertRoot();
  if (path.basename(entryName) !== entryName) {
    throw new PluginExecutionSnapshotError("Plugin snapshot path changed");
  }
  await Effect.runPromise(
    snapshotPublicationCwd.withPermit(
      Effect.sync(() =>
        withVerifiedStorageWorkingDirectory(storage.root, storage.rootIdentity, () =>
          quarantineAndRemoveRelativeSync(entryName),
        ),
      ),
    ),
  );
  await storage.assertRoot();
}

const mapIntoSnapshot = (sourceRoot: string, artifactRoot: string, value: string): string => {
  if (!contained(sourceRoot, value))
    throw new PluginExecutionSnapshotError("Plugin executable path escapes its bundle");
  return path.join(artifactRoot, path.relative(sourceRoot, value));
};

async function snapshotConnector(
  bundle: PluginBundle,
  connector: ConnectorConfig,
): Promise<ConnectorConfig> {
  if (connector.transport !== "stdio" || !connector.command) return connector;
  const storage = await acquireSnapshotStorage(true);
  const destination = snapshotDirectory(storage.root, bundle.artifactDigest);
  const artifactRoot = path.join(destination, "artifact");
  const sourceRoot = await import("node:fs/promises").then(({ realpath }) =>
    realpath(bundle.rootDir),
  );
  const runtimeCommand = connector.command === process.execPath;
  const stagingRoot = storage.stagingRoot;
  if (!stagingRoot) {
    await storage.close().catch(() => undefined);
    throw new PluginExecutionSnapshotError("Plugin snapshot staging is unavailable");
  }
  const tempName = `${bundle.artifactDigest.slice("sha256:".length)}-${process.pid}-${randomUUID()}`;
  const stagingArtifact = path.join(stagingRoot, tempName, "artifact");
  let candidateDigest: string;
  let runtimeDigest: string | undefined;
  let retainedDigest: string | undefined;
  try {
    try {
      await storage.assertRoot();
      await quarantineAndRemoveStaging(storage, tempName);
      await withStagingDirectorySync(storage, () => {
        mkdirSync(tempName, { mode: 0o700 });
        cpSync(sourceRoot, path.join(tempName, "artifact"), {
          recursive: true,
          dereference: false,
          verbatimSymlinks: true,
        });
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      await storage.assertRoot();
      const copiedDigest = await Effect.runPromise(pluginArtifactDigest(stagingArtifact));
      if (copiedDigest !== bundle.artifactDigest)
        throw new PluginExecutionSnapshotError("Plugin artifact changed while snapshotting");
      if (runtimeCommand) {
        runtimeDigest = await fileDigest(process.execPath);
      }
      await storage.assertRoot();
      await withStagingDirectorySync(storage, () => {
        hardenTreeSync(path.join(tempName, "artifact"));
      });
      await storage.assertRoot();
      candidateDigest = await Effect.runPromise(pluginArtifactDigest(stagingArtifact));
      retainedDigest = await hardenedSnapshotDigest(destination, storage.assertRoot);
      if (retainedDigest && retainedDigest !== candidateDigest) {
        throw new PluginExecutionSnapshotError("Plugin snapshot identity changed");
      }
    } finally {
      await quarantineAndRemoveStaging(storage, tempName);
    }
    if (retainedDigest) {
      if (retainedDigest !== candidateDigest) {
        throw new PluginExecutionSnapshotError("Plugin snapshot identity changed");
      }
    } else {
      let claim: SnapshotPublicationClaim | undefined;
      try {
        claim = await claimSnapshotDestination(destination, storage.rootIdentity, storage.assertRoot);
        await claim.assertCurrent();
        await Effect.runPromise(
          publishSnapshotDirectory(
            storage,
            destination,
            sourceRoot,
            bundle.artifactDigest,
            candidateDigest,
            claim,
          ),
        );
        await storage.assertRoot();
      } catch (error) {
        if (claim) throw error;
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST")
          throw error;
        const winnerDigest = await hardenedSnapshotDigest(destination, storage.assertRoot);
        if (winnerDigest !== candidateDigest) {
          throw new PluginExecutionSnapshotError("Plugin snapshot identity changed");
        }
      } finally {
        await claim?.close();
      }
    }
    await storage.assertRoot();
    const snapshotDigest = await hardenedSnapshotDigest(destination, storage.assertRoot);
    if (!snapshotDigest || snapshotDigest !== candidateDigest) {
      throw new PluginExecutionSnapshotError("Plugin snapshot publication failed");
    }
    const prepared: ConnectorConfig = {
      ...connector,
      command: runtimeCommand
        ? process.execPath
        : mapIntoSnapshot(sourceRoot, artifactRoot, connector.command),
      args: connector.args?.map((value) =>
        contained(sourceRoot, value) ? mapIntoSnapshot(sourceRoot, artifactRoot, value) : value,
      ),
      cwd: connector.cwd ? mapIntoSnapshot(sourceRoot, artifactRoot, connector.cwd) : artifactRoot,
      origin: connector.origin
        ? { ...connector.origin, snapshotDigest, ...(runtimeDigest ? { runtimeDigest } : {}) }
        : connector.origin,
    };
    return prepared.origin
      ? {
          ...prepared,
          origin: {
            ...prepared.origin,
            configurationDigest: pluginConnectorConfigurationDigest(prepared),
          },
        }
      : prepared;
  } finally {
    await storage.close().catch(() => undefined);
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

const referencedSnapshots = (
  connectors: ConnectorConfig[],
): { names: Set<string>; digests: Set<string> } => {
  const retained = connectors.flatMap((connector) => {
    const origin = connector.origin;
    const approved = connector.enabled || Boolean(connector.allowTools?.length);
    return connector.transport === "stdio" &&
      origin?.kind === "plugin" &&
      origin.artifactDigest &&
      origin.configurationDigest &&
      origin.snapshotDigest &&
      origin.sourceDigest &&
      approved
      ? (() => {
          try {
            const snapshotDigest = origin.snapshotDigest;
            canonicalDigestSuffix(snapshotDigest);
            return [
              {
                name: canonicalDigestSuffix(origin.artifactDigest),
                digest: snapshotDigest,
              },
            ];
          } catch {
            return [];
          }
        })()
      : [];
  });
  return {
    names: new Set(retained.map(({ name }) => name)),
    digests: new Set(retained.map(({ digest }) => digest)),
  };
};

async function collectSnapshots(connectors: ConnectorConfig[]): Promise<void> {
  await closeSnapshotConnections();
  if (hasPendingPooledConnections()) return;
  let storage: SnapshotStorageGuard | undefined;
  try {
    storage = await acquireSnapshotStorage(false);
    await storage.assertRoot();
    const directory = await opendir(storage.root);
    const retained = referencedSnapshots(connectors);
    for await (const entry of directory) {
      if (retained.names.has(entry.name)) continue;
      const entryPath = path.join(storage.root, entry.name);
      const digest = await hardenedSnapshotDigest(entryPath, storage.assertRoot).catch(
        () => undefined,
      );
      if (digest && retained.digests.has(digest)) continue;
      await quarantineAndRemoveSnapshot(storage, entry.name);
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
      if (
        !connector.origin ||
        !existing.origin?.snapshotDigest ||
        connector.transport !== "stdio" ||
        !connector.command
      ) {
        throw new PluginExecutionSnapshotError("Plugin execution snapshot identity is missing");
      }
      const artifactDigest = canonicalDigestSuffix(bundle.artifactDigest);
      const snapshotDigest = existing.origin.snapshotDigest;
      canonicalDigestSuffix(snapshotDigest);
      const storage = await acquireSnapshotStorage(false);
      try {
        await storage.assertRoot();
        const connectorOrigin = connector.origin;
        const sourceRoot = await import("node:fs/promises").then(({ realpath }) =>
          realpath(bundle.rootDir),
        );
        const snapshotRoot = snapshotDirectory(storage.root, `sha256:${artifactDigest}`);
        const artifactRoot = path.join(snapshotRoot, "artifact");
        const mapped: ConnectorConfig = {
          ...connector,
          command:
            connector.command === process.execPath
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
            snapshotDigest,
            ...(existing.origin.runtimeDigest
              ? { runtimeDigest: existing.origin.runtimeDigest }
              : {}),
          },
        };
        await storage.assertRoot();
        return {
          ...mapped,
          origin: {
            ...connectorOrigin,
            snapshotDigest,
            ...(existing.origin.runtimeDigest
              ? { runtimeDigest: existing.origin.runtimeDigest }
              : {}),
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

export function verifyPluginExecutionSnapshot(
  connector: ConnectorConfig,
): Effect.Effect<void, PluginExecutionSnapshotError> {
  return Effect.tryPromise({
    try: async () => {
      if (
        connector.transport !== "stdio" ||
        connector.origin?.kind !== "plugin" ||
        !connector.origin.artifactDigest ||
        !connector.origin.snapshotDigest
      )
        throw new PluginExecutionSnapshotError("Plugin execution snapshot is missing");
      const artifactDigest = canonicalDigestSuffix(connector.origin.artifactDigest);
      const snapshotDigest = connector.origin.snapshotDigest;
      canonicalDigestSuffix(snapshotDigest);
      const storage = await acquireSnapshotStorage(false);
      try {
        await storage.assertRoot();
        const root = snapshotDirectory(storage.root, `sha256:${artifactDigest}`);
        const artifactRoot = path.join(root, "artifact");
        await assertSnapshotPath(storage.root, root);
        await assertHardened(root);
        if ((await Effect.runPromise(pluginArtifactDigest(artifactRoot))) !== snapshotDigest)
          throw new PluginExecutionSnapshotError("Plugin execution snapshot changed");
        if (connector.command === process.execPath && !connector.origin.runtimeDigest)
          throw new PluginExecutionSnapshotError("Plugin runtime identity is missing");
        if (connector.origin.runtimeDigest && connector.command !== process.execPath)
          throw new PluginExecutionSnapshotError("Plugin runtime path changed");
        if (
          connector.origin.runtimeDigest &&
          (await fileDigest(process.execPath)) !== connector.origin.runtimeDigest
        )
          throw new PluginExecutionSnapshotError("Plugin runtime changed");
        if (!connector.origin.runtimeDigest)
          await assertSnapshotPath(artifactRoot, connector.command ?? "");
        await assertSnapshotPath(artifactRoot, connector.cwd ?? "");
        for (const value of connector.args ?? []) {
          if (path.isAbsolute(value)) await assertSnapshotPath(artifactRoot, value);
          else if (value.includes(path.sep))
            throw new PluginExecutionSnapshotError("Plugin argument path changed");
        }
        await storage.assertRoot();
      } finally {
        await storage.close().catch(() => undefined);
      }
    },
    catch: (error) =>
      error instanceof PluginExecutionSnapshotError
        ? error
        : new PluginExecutionSnapshotError("Plugin execution snapshot could not be verified"),
  });
}
