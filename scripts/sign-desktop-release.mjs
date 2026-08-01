import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNotarytoolCredentials } from "./release-notary-credentials.mjs";
import { releasePackageArguments } from "./release-package-arguments.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const require = createRequire(import.meta.url);

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

function commandOutput(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  }).trim();
}

function keychainList() {
  return [
    ...commandOutput("security", ["list-keychains", "-d", "user"]).matchAll(/"([^"]+)"/g),
  ].map((match) => match[1]);
}

function writeCertificate(link, destination) {
  const value = link.trim();
  if (value.startsWith("file://")) {
    writeFileSync(destination, readFileSync(fileURLToPath(value)), { mode: 0o600, flag: "wx" });
    return;
  }
  if (existsSync(value)) {
    writeFileSync(destination, readFileSync(value), { mode: 0o600, flag: "wx" });
    return;
  }
  const encoded = value.replace(/^data:[^;]+;base64,/, "");
  writeFileSync(destination, Buffer.from(encoded, "base64"), { mode: 0o600, flag: "wx" });
}

async function refreshUpdateMetadata(output, version) {
  const { buildBlockMap } = require(
    path.join(
      frontend,
      "node_modules",
      "app-builder-lib",
      "out",
      "targets",
      "blockmap",
      "blockmap.js",
    ),
  );
  const YAML = require(path.join(frontend, "node_modules", "yaml"));
  const zipName = `Local Studio-${version}-arm64-mac.zip`;
  const dmgName = `Local Studio-${version}-arm64.dmg`;
  const zipInfo = await buildBlockMap(
    path.join(output, zipName),
    "gzip",
    path.join(output, `${zipName}.blockmap`),
  );
  const dmgInfo = await buildBlockMap(
    path.join(output, dmgName),
    "gzip",
    path.join(output, `${dmgName}.blockmap`),
  );
  const updatePath = path.join(output, "latest-mac.yml");
  const current = YAML.parse(readFileSync(updatePath, "utf8"));
  writeFileSync(
    updatePath,
    YAML.stringify({
      version,
      files: [
        {
          url: zipName.replaceAll(" ", "-"),
          sha512: zipInfo.sha512,
          size: zipInfo.size,
        },
        {
          url: dmgName.replaceAll(" ", "-"),
          sha512: dmgInfo.sha512,
          size: dmgInfo.size,
        },
      ],
      path: zipName.replaceAll(" ", "-"),
      sha512: zipInfo.sha512,
      releaseDate: current.releaseDate,
    }),
  );
}

export async function signDesktopRelease(args = process.argv.slice(2)) {
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

  const certificate = requireValue("CSC_LINK");
  const certificatePassword = requireValue("CSC_KEY_PASSWORD");

  const temporary = path.join(os.tmpdir(), `local-studio-release-${process.pid}`);
  const apiKeyPath = path.join(temporary, "AuthKey_notary.p8");
  const notaryCredentials = resolveNotarytoolCredentials(process.env, apiKeyPath);
  const certificatePath = path.join(temporary, "developer-id.p12");
  const keychainPath = path.join(temporary, "release-signing.keychain-db");
  const keychainPassword = randomBytes(32).toString("hex");
  const originalKeychains = keychainList();
  const output = path.join(frontend, "dist-desktop");
  const dmg = path.join(output, `Local Studio-${version}-arm64.dmg`);
  const resolvedApp = path.resolve(prepackaged);
  const entitlements = path.join(frontend, "desktop", "resources", "entitlements.mac.plist");

  try {
    rmSync(temporary, { recursive: true, force: true });
    mkdirSync(temporary, { recursive: true, mode: 0o700 });
    if (notaryCredentials.kind === "api-key") {
      writeFileSync(apiKeyPath, Buffer.from(notaryCredentials.apiKey, "base64"), {
        mode: 0o600,
        flag: "wx",
      });
    }
    writeCertificate(certificate, certificatePath);
    run("security", ["create-keychain", "-p", keychainPassword, keychainPath]);
    run("security", ["set-keychain-settings", "-lut", "21600", keychainPath]);
    run("security", ["unlock-keychain", "-p", keychainPassword, keychainPath]);
    run("security", [
      "import",
      certificatePath,
      "-k",
      keychainPath,
      "-P",
      certificatePassword,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    run("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychainPath,
    ]);
    run("security", ["list-keychains", "-d", "user", "-s", keychainPath, ...originalKeychains]);
    const identityOutput = commandOutput("security", [
      "find-identity",
      "-v",
      "-p",
      "codesigning",
      keychainPath,
    ]);
    const identity = identityOutput.match(/"([^"]*Developer ID Application:[^"]*)"/)?.[1];
    if (!identity)
      throw new Error("Imported certificate does not contain a Developer ID Application identity");

    const { signAsync } = require(path.join(frontend, "node_modules", "@electron", "osx-sign"));
    await signAsync({
      app: resolvedApp,
      platform: "darwin",
      type: "distribution",
      identity,
      keychain: keychainPath,
      hardenedRuntime: true,
      preAutoEntitlements: false,
    });
    run("codesign", [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      entitlements,
      "--sign",
      identity,
      "--keychain",
      keychainPath,
      resolvedApp,
    ]);
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", resolvedApp]);

    process.env.LOCAL_STUDIO_RELEASE_VERSION = version;
    process.env.LOCAL_STUDIO_RELEASE_COMMIT = commit;
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

    run(
      path.join(frontend, "node_modules", ".bin", "electron-builder"),
      releasePackageArguments({ app: resolvedApp, version, commit }),
      { cwd: frontend },
    );
    run("codesign", [
      "--force",
      "--timestamp",
      "--sign",
      identity,
      "--keychain",
      keychainPath,
      dmg,
    ]);
    run("xcrun", [
      "notarytool",
      "submit",
      dmg,
      ...notaryCredentials.args,
      "--wait",
      "--output-format",
      "json",
    ]);
    run("xcrun", ["stapler", "staple", dmg]);
    await refreshUpdateMetadata(output, version);
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
    const packagedApp = path.join(output, "mac-arm64", "Local Studio.app");
    mkdirSync(path.dirname(packagedApp), { recursive: true });
    rmSync(packagedApp, { recursive: true, force: true });
    symlinkSync(resolvedApp, packagedApp, "dir");
    console.log(`Signed and notarized Local Studio ${version} from ${commit}`);
  } finally {
    if (originalKeychains.length > 0) {
      run("security", ["list-keychains", "-d", "user", "-s", ...originalKeychains]);
    }
    if (existsSync(keychainPath)) {
      run("security", ["delete-keychain", keychainPath]);
    }
    rmSync(temporary, { recursive: true, force: true });
  }
}

await signDesktopRelease();
