#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const version = "0.16.0";
const artifacts = {
  "arm64-darwin": {
    url: "https://ziglang.org/download/0.16.0/zig-aarch64-macos-0.16.0.tar.xz",
    sha256: "b23d70deaa879b5c2d486ed3316f7eaa53e84acf6fc9cc747de152450d401489",
  },
  "x64-darwin": {
    url: "https://ziglang.org/download/0.16.0/zig-x86_64-macos-0.16.0.tar.xz",
    sha256: "0387557ed1877bc6a2e1802c8391953baddba76081876301c522f52977b52ba7",
  },
  "arm64-linux": {
    url: "https://ziglang.org/download/0.16.0/zig-aarch64-linux-0.16.0.tar.xz",
    sha256: "ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17",
  },
  "x64-linux": {
    url: "https://ziglang.org/download/0.16.0/zig-x86_64-linux-0.16.0.tar.xz",
    sha256: "70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00",
  },
  "x64-win32": {
    url: "https://ziglang.org/download/0.16.0/zig-x86_64-windows-0.16.0.zip",
    sha256: "68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e",
  },
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const platformKey = `${process.arch}-${process.platform}`;
const artifact = artifacts[platformKey];
if (!artifact) throw new Error(`Zig ${version} is not configured for ${platformKey}`);

const cacheRoot = process.env.LOCAL_STUDIO_ZIG_CACHE?.trim() || join(homedir(), ".cache", "local-studio", "zig");
const versionRoot = join(cacheRoot, version);
const installationRoot = join(versionRoot, "toolchain");
const executable = join(installationRoot, process.platform === "win32" ? "zig.exe" : "zig");
const archive = join(versionRoot, basename(artifact.url));
const verificationMarker = join(versionRoot, `.verified-${artifact.sha256}`);
const secretspecVersion = "0.19.1";
const secretspecArtifacts = {
  "arm64-darwin": {
    name: "secretspec-aarch64-apple-darwin",
    sha256: "076536200199540515ebdf929f7cb3f413d82be3524771a2a5975b80ca85d727",
  },
  "x64-darwin": {
    name: "secretspec-x86_64-apple-darwin",
    sha256: "c622690f2c7037e113e94411311fe7f7158692f8e048d75fddec6e2933968228",
  },
  "arm64-linux": {
    name: "secretspec-aarch64-unknown-linux-gnu",
    sha256: "9b0804932f011ee13709d06a342cd7d30222a764bb62d343771964471b2a7e25",
  },
  "x64-linux": {
    name: "secretspec-x86_64-unknown-linux-gnu",
    sha256: "9a0b5882532f5ffbb1c687d9284fa8041949962b05f14fc131050f86c70e1efc",
  },
};
const secretspecArtifact = secretspecArtifacts[platformKey];
const secretspecRoot = join(cacheRoot, "secretspec", secretspecVersion, platformKey);
const secretspecArchive = secretspecArtifact
  ? join(secretspecRoot, `${secretspecArtifact.name}.tar.xz`)
  : null;
const secretspecExecutable = secretspecArtifact
  ? join(secretspecRoot, secretspecArtifact.name, "secretspec")
  : null;

const digestFile = async (path) => {
  const digest = createHash("sha256");
  await pipeline(createReadStream(path), new Transform({
    transform(chunk, _encoding, callback) {
      digest.update(chunk);
      callback();
    },
  }));
  return digest.digest("hex");
};

const download = async () => {
  const response = await fetch(artifact.url);
  if (!response.ok || !response.body) throw new Error(`Failed to download Zig: HTTP ${response.status}`);
  const temporary = `${archive}.tmp-${process.pid}`;
  const digest = createHash("sha256");
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, callback) {
          digest.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(temporary, { mode: 0o600 }),
    );
    const actual = digest.digest("hex");
    if (actual !== artifact.sha256) throw new Error(`Zig checksum mismatch: expected ${artifact.sha256}, received ${actual}`);
    await rename(temporary, archive);
  } finally {
    await rm(temporary, { force: true });
  }
};

const extract = async () => {
  const temporary = join(versionRoot, `toolchain.tmp-${process.pid}`);
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  const result = spawnSync("tar", ["-xf", archive, "-C", temporary, "--strip-components=1"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Failed to extract Zig archive: tar exited ${result.status}`);
  await rm(installationRoot, { recursive: true, force: true });
  await rename(temporary, installationRoot);
};

const downloadVerified = async (url, destination, expectedSha256) => {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  const temporary = `${destination}.tmp-${process.pid}`;
  const digest = createHash("sha256");
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, callback) {
          digest.update(chunk);
          callback(null, chunk);
        },
      }),
      createWriteStream(temporary, { mode: 0o600 }),
    );
    const actual = digest.digest("hex");
    if (actual !== expectedSha256) throw new Error(`Checksum mismatch for ${url}: expected ${expectedSha256}, received ${actual}`);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
};

const ensureSecretSpec = async () => {
  if (!secretspecArtifact || !secretspecArchive || !secretspecExecutable) return null;
  await mkdir(secretspecRoot, { recursive: true });
  if (
    !existsSync(secretspecArchive) ||
    (await digestFile(secretspecArchive)) !== secretspecArtifact.sha256
  ) {
    await rm(secretspecArchive, { force: true });
    await downloadVerified(
      `https://github.com/cachix/secretspec/releases/download/v${secretspecVersion}/${secretspecArtifact.name}.tar.xz`,
      secretspecArchive,
      secretspecArtifact.sha256,
    );
  }
  if (!existsSync(secretspecExecutable)) {
    const extracted = spawnSync("tar", ["-xf", secretspecArchive, "-C", secretspecRoot], {
      stdio: "inherit",
    });
    if (extracted.error) throw extracted.error;
    if (extracted.status !== 0)
      throw new Error(`Failed to extract SecretSpec: tar exited ${extracted.status}`);
  }
  await chmod(secretspecExecutable, 0o755);
  return secretspecExecutable;
};

const ensureToolchain = async () => {
  await mkdir(versionRoot, { recursive: true });
  let verified = existsSync(verificationMarker);
  if (!verified && existsSync(archive)) {
    verified = (await digestFile(archive)) === artifact.sha256;
    if (!verified) await rm(archive, { force: true });
  }
  if (!verified) {
    console.log(`Downloading Zig ${version} for ${platformKey}`);
    await download();
    verified = true;
  }
  if (!existsSync(executable)) await extract();
  if (verified) await writeFile(verificationMarker, `${artifact.sha256}\n`, { mode: 0o600 });
  const actualVersion = spawnSync(executable, ["version"], { encoding: "utf8" });
  if (actualVersion.error) throw actualVersion.error;
  if (actualVersion.status !== 0 || actualVersion.stdout.trim() !== version) {
    throw new Error(`Expected Zig ${version}, received ${actualVersion.stdout.trim() || "unknown"}`);
  }
};

const arguments_ = process.argv.slice(2);
if (arguments_[0] === "build-desktop") {
  if (process.platform === "win32") {
    console.log("Zig desktop controller packaging is not available on Windows yet");
    process.exit(0);
  }
  arguments_[0] = "build";
  arguments_.push("-Doptimize=ReleaseSafe");
}
await ensureToolchain();
if (arguments_.length === 0) arguments_.push("version");
const building = arguments_[0] === "build";
let resolvedSecretSpec = null;
if (building) {
  resolvedSecretSpec = await ensureSecretSpec();
}
const result = spawnSync(executable, arguments_, {
  cwd: join(projectRoot, "controller"),
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
if (result.status === 0 && building && resolvedSecretSpec) {
  const destination = join(projectRoot, "controller", "zig-out", "bin", "secretspec");
  await copyFile(resolvedSecretSpec, destination);
  await chmod(destination, 0o755);
}
process.exit(result.status ?? 1);
