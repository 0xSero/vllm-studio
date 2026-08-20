import { afterEach, describe, expect, mock, test } from "bun:test";
import * as realFs from "node:fs";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
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
const originalRenameSync = realFs.renameSync;

type LateSwap = {
  destination: string;
  victim: string;
  swapped: boolean;
};

let lateSwap: LateSwap | undefined;

function swapBeforePublicationMutation(): void {
  if (!lateSwap || lateSwap.swapped) return;
  originalRenameSync(lateSwap.destination, `${lateSwap.destination}.swapped`);
  realFs.symlinkSync(lateSwap.victim, lateSwap.destination);
  lateSwap.swapped = true;
}

mock.module("node:fs/promises", () => ({
  ...realFsPromises,
  rename: async (...args: Parameters<typeof realFsPromises.rename>) => {
    swapBeforePublicationMutation();
    return originalRename(...args);
  },
}));

mock.module("node:fs", () => ({
  ...realFs,
  renameSync: (...args: Parameters<typeof realFs.renameSync>) => {
    swapBeforePublicationMutation();
    return originalRenameSync(...args);
  },
}));

const { Effect } = await import("effect");
const { discoverPluginBundles } = await import("../src/plugin-discovery");
const { preparePluginExecutionSnapshot, withPluginExecutionSnapshotLifecycle } =
  await import("../src/plugin-execution-snapshot");
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
});
