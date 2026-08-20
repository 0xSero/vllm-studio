import { afterEach, describe, expect, mock, test } from "bun:test";
import * as realFs from "node:fs";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import * as realFsPromises from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ConnectorConfig } from "../src/connector-contract";
import type { PluginBundle, PluginSource } from "../src/plugin-discovery";

const originalRename = realFsPromises.rename;
const originalMkdir = realFsPromises.mkdir;
const originalCp = realFsPromises.cp;
const originalMkdirSync = realFs.mkdirSync;
const originalRenameSync = realFs.renameSync;
const originalCpSync = realFs.cpSync;
const originalOpenSync = realFs.openSync;

type LateSwap = {
  destination: string;
  victim: string;
  swapped: boolean;
};

let lateSwap: LateSwap | undefined;

type AncestorSwap = {
  victim: string;
  destination?: string;
  attempted: boolean;
  swapped: boolean;
};

let sourceAncestorSwap: AncestorSwap | undefined;
let cleanupAncestorSwap: AncestorSwap | undefined;

type StagingPreparationSwap = {
  victim: string;
  attempted: boolean;
  swapped: boolean;
  stagingRoot?: string;
};

let stagingPreparationSwap: StagingPreparationSwap | undefined;

type RetirementSwap = {
  root: string;
  victim: string;
  attempted: boolean;
  swapped: boolean;
};

let retirementSwap: RetirementSwap | undefined;

type CwdProbe = {
  original: string;
  observed?: string;
};

let cwdProbe: CwdProbe | undefined;
let candidateFailure: { triggered: boolean; mutate?: boolean } | undefined;

function swapStagingPreparationAncestor(targetPath: string): void {
  if (!stagingPreparationSwap || stagingPreparationSwap.attempted) return;
  const resolvedTarget = path.resolve(process.cwd(), targetPath);
  const stagingRoot = path.dirname(resolvedTarget);
  if (path.basename(stagingRoot) !== ".plugin-staging") return;
  stagingPreparationSwap.attempted = true;
  stagingPreparationSwap.stagingRoot = stagingRoot;
  originalRenameSync(stagingRoot, `${stagingRoot}.swapped`);
  realFs.symlinkSync(stagingPreparationSwap.victim, stagingRoot);
  stagingPreparationSwap.swapped = true;
}

function swapRetirementAncestor(sourcePath: string, destinationPath: string): void {
  if (!retirementSwap || retirementSwap.attempted) return;
  const source = path.resolve(process.cwd(), sourcePath);
  const destination = path.resolve(process.cwd(), destinationPath);
  const root = realpathSync(retirementSwap.root);
  if (
    !source.startsWith(`${root}${path.sep}`) ||
    !path.basename(destination).startsWith(".garbage-")
  ) {
    return;
  }
  retirementSwap.attempted = true;
  originalRenameSync(retirementSwap.root, `${retirementSwap.root}.swapped`);
  realFs.symlinkSync(retirementSwap.victim, retirementSwap.root);
  retirementSwap.swapped = true;
}

function restoreAncestorSwap(
  state: { swapped: boolean; root?: string },
  root: string | undefined = state.root,
): void {
  if (!state.swapped || !root) return;
  realFs.unlinkSync(root);
  originalRenameSync(`${root}.swapped`, root);
  state.swapped = false;
}

function swapBeforePublicationMutation(): void {
  if (!lateSwap || lateSwap.swapped) return;
  originalRenameSync(lateSwap.destination, `${lateSwap.destination}.swapped`);
  realFs.symlinkSync(lateSwap.victim, lateSwap.destination);
  lateSwap.swapped = true;
}

function swapSourceAncestorBeforeOpen(sourcePath: string): void {
  if (
    !sourceAncestorSwap ||
    sourceAncestorSwap.attempted ||
    !sourcePath.includes(".plugin-staging")
  ) {
    return;
  }
  sourceAncestorSwap.attempted = true;
  const temporaryRoot = path.dirname(sourcePath);
  const stagingRoot = path.dirname(temporaryRoot);
  const temporaryName = path.basename(temporaryRoot);
  const attackerArtifact = path.join(sourceAncestorSwap.victim, temporaryName, "artifact");
  mkdirSync(attackerArtifact, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(attackerArtifact, "attacker.txt"), "attacker");
  originalRenameSync(stagingRoot, `${stagingRoot}.swapped`);
  realFs.symlinkSync(sourceAncestorSwap.victim, stagingRoot);
  sourceAncestorSwap.swapped = true;
}

function swapCleanupAncestorBeforeRename(sourcePath: string, destinationPath: string): void {
  if (
    !cleanupAncestorSwap ||
    cleanupAncestorSwap.attempted ||
    !sourcePath.includes(".plugin-staging") ||
    !destinationPath.includes(".garbage-") ||
    !cleanupAncestorSwap.destination ||
    !existsSync(cleanupAncestorSwap.destination)
  ) {
    return;
  }
  cleanupAncestorSwap.attempted = true;
  const temporaryRoot = path.dirname(sourcePath);
  const stagingRoot = path.dirname(temporaryRoot);
  const temporaryName = path.basename(temporaryRoot);
  const victimTemporaryRoot = path.join(cleanupAncestorSwap.victim, temporaryName);
  mkdirSync(victimTemporaryRoot, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(cleanupAncestorSwap.victim, "marker"), "preserved");
  writeFileSync(path.join(victimTemporaryRoot, "marker"), "preserved");
  originalRenameSync(stagingRoot, `${stagingRoot}.swapped`);
  realFs.symlinkSync(cleanupAncestorSwap.victim, stagingRoot);
  cleanupAncestorSwap.swapped = true;
}

mock.module("node:fs/promises", () => ({
  ...realFsPromises,
  mkdir: async (...args: Parameters<typeof realFsPromises.mkdir>) => {
    swapStagingPreparationAncestor(String(args[0]));
    return originalMkdir(...args);
  },
  cp: async (...args: Parameters<typeof realFsPromises.cp>) => {
    const destination = String(args[1]);
    if (cwdProbe && destination.startsWith(".candidate-")) {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (cwdProbe) cwdProbe.observed = process.cwd();
          resolve();
        }, 0);
      });
    }
    return originalCp(...args);
  },
  rename: async (...args: Parameters<typeof realFsPromises.rename>) => {
    swapRetirementAncestor(String(args[0]), String(args[1]));
    swapCleanupAncestorBeforeRename(String(args[0]), String(args[1]));
    swapBeforePublicationMutation();
    return originalRename(...args);
  },
}));

mock.module("node:fs", () => ({
  ...realFs,
  mkdirSync: (...args: Parameters<typeof realFs.mkdirSync>) => {
    swapStagingPreparationAncestor(String(args[0]));
    return originalMkdirSync(...args);
  },
  cpSync: (...args: Parameters<typeof realFs.cpSync>) => {
    const destination = String(args[1]);
    if (candidateFailure && destination.startsWith(".candidate-")) {
      candidateFailure.triggered = true;
      if (candidateFailure.mutate) {
        const result = originalCpSync(...args);
        writeFileSync(path.join(destination, "injected.txt"), "injected");
        return result;
      }
      throw new Error("candidate copy failed");
    }
    return originalCpSync(...args);
  },
  openSync: (...args: Parameters<typeof realFs.openSync>) => {
    swapSourceAncestorBeforeOpen(String(args[0]));
    return originalOpenSync(...args);
  },
  renameSync: (...args: Parameters<typeof realFs.renameSync>) => {
    swapRetirementAncestor(String(args[0]), String(args[1]));
    swapBeforePublicationMutation();
    return originalRenameSync(...args);
  },
}));

const { Effect } = await import("effect");
const { discoverPluginBundles } = await import("../src/plugin-discovery");
const {
  garbageCollectPluginExecutionSnapshots,
  preparePluginExecutionSnapshot,
  withPluginExecutionSnapshotLifecycle,
} = await import("../src/plugin-execution-snapshot");
const { pluginConnectorConfigurationDigest } = await import("../src/plugin-connector-identity");
const roots: string[] = [];
const originalDataDirectory = process.env.LOCAL_STUDIO_DATA_DIR;

function restoreWritable(entryPath: string): void {
  if (!existsSync(entryPath)) return;
  const stats = lstatSync(entryPath);
  if (stats.isSymbolicLink()) return;
  if (stats.isDirectory()) {
    chmodSync(entryPath, 0o700);
    readdirSync(entryPath).forEach((name) => restoreWritable(path.join(entryPath, name)));
  } else {
    chmodSync(entryPath, 0o600);
  }
}

afterEach(() => {
  lateSwap = undefined;
  sourceAncestorSwap = undefined;
  cleanupAncestorSwap = undefined;
  if (stagingPreparationSwap?.swapped) {
    restoreAncestorSwap(stagingPreparationSwap, stagingPreparationSwap.stagingRoot);
  }
  if (retirementSwap?.swapped) restoreAncestorSwap(retirementSwap, retirementSwap.root);
  stagingPreparationSwap = undefined;
  retirementSwap = undefined;
  cwdProbe = undefined;
  candidateFailure = undefined;
  if (originalDataDirectory === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDirectory;
  for (const root of roots.splice(0)) {
    restoreWritable(root);
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(): { root: string; source: PluginSource[] } {
  const parent = mkdtempSync(path.join(tmpdir(), "local-studio-plugin-publication-"));
  roots.push(parent);
  process.env.LOCAL_STUDIO_DATA_DIR = path.join(parent, "data");
  mkdirSync(process.env.LOCAL_STUDIO_DATA_DIR, { recursive: true, mode: 0o700 });
  const root = path.join(parent, "fixture");
  mkdirSync(path.join(root, ".codex-plugin"), { recursive: true });
  writeFileSync(path.join(root, "server.js"), "process.exit(1)");
  writeFileSync(path.join(root, "artifact.txt"), "artifact-one");
  writeFileSync(
    path.join(root, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      mcpServers: "mcp.json",
    }),
  );
  writeFileSync(
    path.join(root, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: ["./server.js"],
          cwd: ".",
        },
      },
    }),
  );
  return { root, source: [{ label: "Fixture", dir: root, priority: 1 }] };
}

function executionRoot(): string {
  const dataDirectory = process.env.LOCAL_STUDIO_DATA_DIR;
  if (!dataDirectory) throw new Error("fixture data directory is missing");
  return path.join(dataDirectory, "runtime", "plugin-executables");
}

function connectorForBundle(root: string, bundle: PluginBundle): ConnectorConfig {
  const server = realpathSync(path.join(root, "server.js"));
  const bundleRoot = realpathSync(root);
  const connector = {
    id: "plugin-fixture-fixture",
    name: "fixture",
    transport: "stdio" as const,
    command: process.execPath,
    args: [server],
    cwd: bundleRoot,
    allowTools: ["read"],
    enabled: true,
  };
  return {
    ...connector,
    origin: {
      kind: "plugin",
      id: "fixture",
      version: "1.0.0",
      binding: "fixture",
      artifactDigest: bundle.artifactDigest,
      sourceDigest: bundle.sourceDigest,
      configurationDigest: pluginConnectorConfigurationDigest(connector),
    },
  };
}

describe("plugin snapshot publication race", () => {
  test("does not write through a destination swapped after claim validation", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const connector = connectorForBundle(root, bundle);
    const destination = path.join(executionRoot(), bundle.artifactDigest.replace("sha256:", ""));
    const victim = path.join(path.dirname(root), "publication-race-victim");
    mkdirSync(victim, { mode: 0o700 });
    lateSwap = { destination, victim, swapped: false };

    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          preparePluginExecutionSnapshot(bundle, connector, lifecycle),
        ),
      ),
    ).rejects.toThrow();
    expect(lateSwap?.swapped).toBe(true);
    expect(readdirSync(victim)).toEqual([]);
  });

  test("does not read a source through a staging ancestor swapped after claim validation", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const connector = connectorForBundle(root, bundle);
    const destination = path.join(executionRoot(), bundle.artifactDigest.replace("sha256:", ""));
    const victim = path.join(path.dirname(root), "source-ancestor-race-victim");
    mkdirSync(victim, { mode: 0o700 });
    writeFileSync(path.join(victim, "marker"), "preserved");
    sourceAncestorSwap = { victim, attempted: false, swapped: false };

    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          preparePluginExecutionSnapshot(bundle, connector, lifecycle),
        ),
      ),
    ).resolves.toBeDefined();
    expect(sourceAncestorSwap?.attempted).toBe(false);
    expect(sourceAncestorSwap?.swapped).toBe(false);
    expect(readFileSync(path.join(victim, "marker"), "utf8")).toBe("preserved");
    expect(existsSync(path.join(destination, "artifact", "attacker.txt"))).toBe(false);
  });

  test("does not clean through a staging ancestor swapped after publication", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const connector = connectorForBundle(root, bundle);
    const destination = path.join(executionRoot(), bundle.artifactDigest.replace("sha256:", ""));
    const victim = path.join(path.dirname(root), "cleanup-ancestor-race-victim");
    mkdirSync(victim, { mode: 0o700 });
    writeFileSync(path.join(victim, "marker"), "preserved");
    cleanupAncestorSwap = { victim, destination, attempted: false, swapped: false };

    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          preparePluginExecutionSnapshot(bundle, connector, lifecycle),
        ),
      ),
    ).resolves.toBeDefined();
    expect(cleanupAncestorSwap?.attempted).toBe(false);
    expect(cleanupAncestorSwap?.swapped).toBe(false);
    expect(readFileSync(path.join(victim, "marker"), "utf8")).toBe("preserved");
  });

  test("fails safely and retries when staging swaps before its first mutation", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const connector = connectorForBundle(root, bundle);
    const victim = path.join(path.dirname(root), "staging-preparation-race-victim");
    mkdirSync(victim, { mode: 0o700 });
    writeFileSync(path.join(victim, "marker"), "preserved");
    stagingPreparationSwap = { victim, attempted: false, swapped: false };

    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          preparePluginExecutionSnapshot(bundle, connector, lifecycle),
        ),
      ),
    ).rejects.toThrow();
    expect(stagingPreparationSwap?.attempted).toBe(true);
    expect(readFileSync(path.join(victim, "marker"), "utf8")).toBe("preserved");
    expect(readdirSync(victim)).toEqual(["marker"]);

    restoreAncestorSwap(stagingPreparationSwap, stagingPreparationSwap.stagingRoot);
    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          preparePluginExecutionSnapshot(bundle, connector, lifecycle),
        ),
      ),
    ).resolves.toBeDefined();
    expect(readFileSync(path.join(victim, "marker"), "utf8")).toBe("preserved");
    expect(readdirSync(victim)).toEqual(["marker"]);
  });

  test("fails safely and retries when snapshot retirement swaps its root", async () => {
    const { root, source } = fixture();
    const storageRoot = executionRoot();
    mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
    const stale = path.join(storageRoot, "stale-retirement");
    mkdirSync(stale, { mode: 0o700 });
    writeFileSync(path.join(stale, "marker"), "stale");
    const victim = path.join(path.dirname(root), "retirement-race-victim");
    mkdirSync(path.join(victim, "stale-retirement"), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(victim, "marker"), "preserved");
    writeFileSync(path.join(victim, "stale-retirement", "marker"), "outside");
    retirementSwap = { root: storageRoot, victim, attempted: false, swapped: false };

    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          garbageCollectPluginExecutionSnapshots([], lifecycle),
        ),
      ),
    ).rejects.toThrow(/snapshot cleanup failed/);
    expect(retirementSwap?.attempted).toBe(true);
    expect(readFileSync(path.join(victim, "marker"), "utf8")).toBe("preserved");
    expect(readFileSync(path.join(victim, "stale-retirement", "marker"), "utf8")).toBe(
      "outside",
    );

    restoreAncestorSwap(retirementSwap, retirementSwap.root);
    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          garbageCollectPluginExecutionSnapshots([], lifecycle),
        ),
      ),
    ).resolves.toBeUndefined();
    expect(existsSync(stale)).toBe(false);
    expect(readFileSync(path.join(victim, "marker"), "utf8")).toBe("preserved");
    expect(readFileSync(path.join(victim, "stale-retirement", "marker"), "utf8")).toBe(
      "outside",
    );
  });

  test("keeps unrelated cwd-relative work rooted during publication", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    cwdProbe = { original: process.cwd() };

    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          preparePluginExecutionSnapshot(bundle, connectorForBundle(root, bundle), lifecycle),
        ),
      ),
    ).resolves.toBeDefined();
    expect(cwdProbe?.observed ?? cwdProbe?.original).toBe(cwdProbe?.original);
    expect(process.cwd()).toBe(cwdProbe?.original);
  });

  test("removes a failed candidate without leaving a hidden publication entry", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const destination = path.join(executionRoot(), bundle.artifactDigest.replace("sha256:", ""));
    candidateFailure = { triggered: false };

    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          preparePluginExecutionSnapshot(bundle, connectorForBundle(root, bundle), lifecycle),
        ),
      ),
    ).rejects.toThrow();
    expect(candidateFailure?.triggered).toBe(true);
    expect(readdirSync(destination)).toEqual([]);
  });

  test("rejects candidate bytes that drift before the anchored commit", async () => {
    const { root, source } = fixture();
    const [bundle] = await Effect.runPromise(discoverPluginBundles(source, 0));
    if (!bundle) throw new Error("fixture plugin was not discovered");
    const destination = path.join(executionRoot(), bundle.artifactDigest.replace("sha256:", ""));
    candidateFailure = { triggered: false, mutate: true };

    await expect(
      Effect.runPromise(
        withPluginExecutionSnapshotLifecycle((lifecycle) =>
          preparePluginExecutionSnapshot(bundle, connectorForBundle(root, bundle), lifecycle),
        ),
      ),
    ).rejects.toThrow(/changed while snapshotting/);
    expect(candidateFailure?.triggered).toBe(true);
    expect(readdirSync(destination)).toEqual([]);
  });
});
