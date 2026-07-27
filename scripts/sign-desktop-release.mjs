import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function requireValue(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Repo secret ${name} is missing`);
  return value;
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
}

export function signDesktopRelease(args = process.argv.slice(2)) {
  const version = valueAfter(args, "--version")?.trim();
  const commit = valueAfter(args, "--commit")?.trim().toLowerCase();
  const prepackaged = valueAfter(args, "--prepackaged")?.trim();
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("--version must be a semantic version");
  }
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("--commit must be a full Git commit SHA");
  }
  if (!prepackaged || !existsSync(prepackaged)) {
    throw new Error("--prepackaged must point to an unsigned app bundle");
  }

  const apiKey = requireValue("APPLE_API_KEY_BASE64");
  const apiKeyId = requireValue("APPLE_API_KEY_ID");
  const apiIssuer = requireValue("APPLE_API_ISSUER");
  requireValue("CSC_LINK");
  requireValue("CSC_KEY_PASSWORD");

  const temporary = path.join(os.tmpdir(), `local-studio-release-${process.pid}`);
  const apiKeyPath = path.join(temporary, `AuthKey_${apiKeyId}.p8`);
  const output = path.join(frontend, "dist-desktop");
  const dmg = path.join(output, `Local Studio-${version}-arm64.dmg`);

  try {
    rmSync(temporary, { recursive: true, force: true });
    mkdirSync(temporary, { recursive: true, mode: 0o700 });
    writeFileSync(apiKeyPath, Buffer.from(apiKey, "base64"), { mode: 0o600, flag: "wx" });
    process.env.APPLE_API_KEY = apiKeyPath;
    process.env.APPLE_API_KEY_ID = apiKeyId;
    process.env.APPLE_API_ISSUER = apiIssuer;
    process.env.LOCAL_STUDIO_RELEASE_VERSION = version;
    process.env.LOCAL_STUDIO_RELEASE_COMMIT = commit;

    run(path.join(frontend, "node_modules", ".bin", "electron-builder"), [
      "--prepackaged",
      path.resolve(prepackaged),
      "--config",
      "desktop/electron-builder.yml",
      "--config.mac.notarize=true",
      `--config.extraMetadata.version=${version}`,
      `--config.extraMetadata.localStudioCommit=${commit}`,
    ], { cwd: frontend });
    run("xcrun", [
      "notarytool",
      "submit",
      dmg,
      "--key",
      apiKeyPath,
      "--key-id",
      apiKeyId,
      "--issuer",
      apiIssuer,
      "--wait",
      "--output-format",
      "json",
    ]);
    run("xcrun", ["stapler", "staple", dmg]);
    run("xcrun", ["stapler", "validate", dmg]);
    run("codesign", ["--verify", "--verbose=4", dmg]);
    run("spctl", [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose=4",
      dmg,
    ]);
    console.log(`Signed and notarized Local Studio ${version} from ${commit}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

signDesktopRelease();
