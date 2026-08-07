import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Effect } from "effect";
import type { ConnectorConfig } from "../src/connector-contract";
import {
  GITHUB_MCP_ARGS,
  GITHUB_MCP_ARTIFACTS,
  GITHUB_MCP_TOOLS,
  GITHUB_MCP_VERSION,
  assertGitHubConnectorReady,
  getGitHubConnectorArtifactStatus,
  githubMcpConnectorConfiguration,
  githubMcpExecutablePath,
  installGitHubConnectorArtifact,
  migrateLegacyGitHubConnector,
  resolvedGitHubMcpDataDir,
  verifyGitHubMcpExecutable,
  type GitHubMcpArtifact,
} from "../src/connector-artifacts";
import { probeConnector } from "../src/connector-pool";
import { listConnectors } from "../src/connectors-service";

type FixtureEntry = { name: string; bytes: Buffer; type?: number };
type ArtifactFixture = { artifact: GitHubMcpArtifact; archive: Buffer; executable: Buffer };

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function tarOctal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function tarHeader(entry: FixtureEntry): Buffer {
  const header = Buffer.alloc(512);
  header.write(entry.name, 0, 100, "utf8");
  header.write(tarOctal(0o500, 8), 100, 8, "ascii");
  header.write(tarOctal(0, 8), 108, 8, "ascii");
  header.write(tarOctal(0, 8), 116, 8, "ascii");
  header.write(tarOctal(entry.bytes.length, 12), 124, 12, "ascii");
  header.write(tarOctal(0, 12), 136, 12, "ascii");
  header.fill(32, 148, 156);
  header.writeUInt8(entry.type ?? 48, 156);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((total, value) => total + value, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function tarArchive(entries: readonly FixtureEntry[]): Buffer {
  const blocks = entries.flatMap((entry) => [
    tarHeader(entry),
    entry.bytes,
    Buffer.alloc((512 - (entry.bytes.length % 512)) % 512),
  ]);
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1_024)]));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipArchive(entries: readonly FixtureEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(crc32(entry.bytes), 14);
    localHeader.writeUInt32LE(entry.bytes.length, 18);
    localHeader.writeUInt32LE(entry.bytes.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    const localEntry = Buffer.concat([localHeader, name, entry.bytes]);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc32(entry.bytes), 16);
    centralHeader.writeUInt32LE(entry.bytes.length, 20);
    centralHeader.writeUInt32LE(entry.bytes.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE((0o100600 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    local.push(localEntry);
    central.push(Buffer.concat([centralHeader, name]));
    offset += localEntry.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function fixture(
  format: "tar.gz" | "zip",
  mutate?: (entries: readonly FixtureEntry[]) => readonly FixtureEntry[],
): ArtifactFixture {
  const executableName = format === "zip" ? "github-mcp-server.exe" : "github-mcp-server";
  const executable = Buffer.from("verified-github-mcp-fixture");
  const expected = [
    { name: "LICENSE", bytes: Buffer.from("license") },
    { name: "README.md", bytes: Buffer.from("readme") },
    { name: executableName, bytes: executable },
  ];
  const archive =
    format === "zip"
      ? zipArchive(mutate?.(expected) ?? expected)
      : tarArchive(mutate?.(expected) ?? expected);
  return {
    archive,
    executable,
    artifact: {
      target: `fixture-${format}`,
      platform: format === "zip" ? "win32" : "darwin",
      arch: "x64",
      version: GITHUB_MCP_VERSION,
      url: "https://fixtures.invalid/github-mcp-server",
      archiveName: format === "zip" ? "fixture.zip" : "fixture.tar.gz",
      archiveFormat: format,
      archiveSize: archive.length,
      archiveSha256: sha256(archive),
      executableName,
      executableSize: executable.length,
      executableSha256: sha256(executable),
      entries: expected.map((entry) => ({ name: entry.name, size: entry.bytes.length })),
    },
  };
}

const privateWindowsSecurity = {
  protect: async () => undefined,
  verify: async () => undefined,
};

async function temporaryDataDir(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "local-studio-github-mcp-"));
  await chmod(directory, 0o700);
  return realpath(directory);
}

async function installFixture(root: string, selected: ArtifactFixture) {
  return Effect.runPromise(
    installGitHubConnectorArtifact({
      artifact: selected.artifact,
      platform: selected.artifact.platform,
      arch: selected.artifact.arch,
      dataDir: root,
      fetch: async () =>
        new Response(selected.archive, {
          headers: { "Content-Length": String(selected.archive.length) },
        }),
      verifyExecutable: async () => undefined,
      ...(selected.artifact.platform === "win32"
        ? { windowsSecurity: privateWindowsSecurity }
        : {}),
    }),
  );
}

describe("GitHub MCP manifest and configuration", () => {
  test("pins every official Local Studio target to GitHub v1.6.0 release identity", () => {
    expect(
      Object.fromEntries(
        Object.entries(GITHUB_MCP_ARTIFACTS).map(([target, entry]) => [
          target,
          [
            entry.archiveName,
            entry.archiveSize,
            entry.archiveSha256,
            entry.executableSize,
            entry.executableSha256,
          ],
        ]),
      ),
    ).toEqual({
      "darwin-arm64": [
        "github-mcp-server_Darwin_arm64.tar.gz",
        7_644_753,
        "cdce71ef6f893d463910678ec298bba76610ca4591bf35263f0ff0ec35928f9e",
        23_627_042,
        "60e178495ae2bcb898eaffc2c21d299d553a259914430c9eaa8b3f5f76f5d129",
      ],
      "darwin-x64": [
        "github-mcp-server_Darwin_x86_64.tar.gz",
        8_122_888,
        "75bf4fb2c855a3af5381056b88afdf2e2b67e330906aadfbae9682e8dcacbd3f",
        24_877_744,
        "6a052a0a75b69fe777543039fbdeaab50e2a5262d55e43917661c558bad790d3",
      ],
      "linux-arm64": [
        "github-mcp-server_Linux_arm64.tar.gz",
        7_302_795,
        "25f8028304202674ec2e9977fec3ca0897cac33866dabb51aefd418bc0ce7ef2",
        22_937_784,
        "5d47f9e36850769db8a46c97a7ad1e7a1bd51502c57765a81e697f5740455227",
      ],
      "linux-x64": [
        "github-mcp-server_Linux_x86_64.tar.gz",
        7_957_825,
        "27443d173f209e60d4af9777e624bfea3de1af24897d46cc7324f01cf279a41d",
        24_309_944,
        "955fff9cf50ae99ee021871a4782c36360252d82fd03c8307fd7394c44ba3886",
      ],
      "win32-x64": [
        "github-mcp-server_Windows_x86_64.zip",
        8_147_960,
        "699d91a1f49897d9c51cef5794cb423401a1ab27e263c76168c133dff0d004e0",
        24_920_576,
        "66702e31cd5577e4c1437337599759256bbc23bed1bb5a76aa5f5525abc0ee1a",
      ],
    });
  });

  test("rejects filesystem roots and builds the deterministic executable path", () => {
    expect(resolvedGitHubMcpDataDir("/", "darwin")).toBeNull();
    expect(resolvedGitHubMcpDataDir("D:\\", "win32")).toBeNull();
    expect(githubMcpExecutablePath("linux", "x64", "/data")).toBe(
      "/data/runtime/connectors/github-mcp-server/1.6.0/github-mcp-server",
    );
  });

  test("generates only the exact read-only execution and allowlist", () => {
    const selected = fixture("tar.gz");
    const connector = githubMcpConnectorConfiguration(
      { env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" }, enabled: true },
      { artifact: selected.artifact, platform: "darwin", arch: "x64", dataDir: "/data" },
    );
    expect(connector).toMatchObject({
      id: "github",
      name: "GitHub",
      transport: "stdio",
      args: GITHUB_MCP_ARGS,
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" },
      allowTools: GITHUB_MCP_TOOLS,
      origin: { kind: "catalog", id: "github", version: GITHUB_MCP_VERSION },
      enabled: true,
    });
    expect(() =>
      githubMcpConnectorConfiguration(
        { env: { PATH: "/tmp" } },
        { artifact: selected.artifact, platform: "darwin", arch: "x64", dataDir: "/data" },
      ),
    ).toThrow("environment");
  });

  test("migrates only the exact generated legacy connector and disables it for review", () => {
    const selected = fixture("tar.gz");
    const legacy: ConnectorConfig = {
      id: "github",
      name: "GitHub",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      enabled: true,
    };
    const migrated = migrateLegacyGitHubConnector(legacy, {
      artifact: selected.artifact,
      platform: "darwin",
      arch: "x64",
      dataDir: "/data",
    });
    expect(migrated.migrated).toBe(true);
    expect(migrated.connector).toMatchObject({
      command: "/data/runtime/connectors/github-mcp-server/1.6.0/github-mcp-server",
      args: GITHUB_MCP_ARGS,
      env: legacy.env,
      allowTools: GITHUB_MCP_TOOLS,
      enabled: false,
    });
    for (const custom of [
      { ...legacy, name: "My GitHub" },
      { ...legacy, command: "/opt/custom/npx" },
      { ...legacy, args: [...(legacy.args ?? []), "--custom"] },
      { ...legacy, env: { ...legacy.env, GITHUB_HOST: "github.example" } },
      { ...legacy, cwd: "/tmp" },
    ]) {
      expect(migrateLegacyGitHubConnector(custom, { dataDir: "/data" })).toEqual({
        connector: custom,
        migrated: false,
      });
    }
  });

  test("persists the exact legacy migration without rewriting a custom wrapper", async () => {
    const root = await temporaryDataDir();
    const previous = process.env.LOCAL_STUDIO_DATA_DIR;
    const file = path.join(root, "connectors.json");
    const legacy: ConnectorConfig = {
      id: "github",
      name: "GitHub",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      enabled: true,
    };
    const custom = { ...legacy, command: "/opt/custom/npx" };
    process.env.LOCAL_STUDIO_DATA_DIR = root;
    try {
      await writeFile(file, JSON.stringify({ connectors: [legacy] }), { mode: 0o600 });
      expect((await listConnectors())[0]).toMatchObject({
        command: githubMcpExecutablePath(process.platform, process.arch, root),
        args: GITHUB_MCP_ARGS,
        allowTools: GITHUB_MCP_TOOLS,
        enabled: false,
      });
      const persisted = JSON.parse(await readFile(file, "utf8")) as {
        connectors: ConnectorConfig[];
      };
      expect(persisted.connectors[0]?.command).not.toBe("npx");
      await writeFile(file, JSON.stringify({ connectors: [custom] }), { mode: 0o600 });
      expect(await listConnectors()).toEqual([custom]);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ connectors: [custom] });
    } finally {
      if (previous === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
      else process.env.LOCAL_STUDIO_DATA_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  });
});
