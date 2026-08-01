import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(repository, "scripts", "install-desktop-app.sh");

function writeExecutable(file, content) {
  writeFileSync(file, content, { mode: 0o755 });
  chmodSync(file, 0o755);
}

function createHarness(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "local-studio-installer-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const applications = path.join(root, "Applications");
  const rollbacks = path.join(root, "Rollbacks");
  const commands = path.join(root, "bin");
  mkdirSync(applications, { recursive: true });
  mkdirSync(commands, { recursive: true });

  writeExecutable(
    path.join(commands, "ditto"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] !== "-c") {
  fs.cpSync(args[0], args[1], { recursive: true });
  process.exit(0);
}
const source = args.at(-2);
const destination = args.at(-1);
const base = path.basename(source);
const members = [];
function walk(directory, relative) {
  members.push(relative + "/");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const next = path.join(directory, entry.name);
    const member = relative + "/" + entry.name;
    if (entry.isDirectory()) walk(next, member);
    else members.push(member);
  }
}
walk(source, base);
fs.writeFileSync(destination, members.join("\\n") + "\\n");
`,
  );

  writeExecutable(
    path.join(commands, "unzip"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const archive = args.at(-1);
if (!fs.existsSync(archive)) process.exit(1);
if (args[0] === "-Z1") process.stdout.write(fs.readFileSync(archive));
`,
  );

  writeExecutable(
    path.join(commands, "codesign"),
    `#!/usr/bin/env node
const target = process.argv.at(-1);
if (process.env.LOCAL_STUDIO_TEST_FAIL_CODESIGN === target) process.exit(1);
`,
  );

  writeExecutable(
    path.join(commands, "plist-buddy"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const text = fs.readFileSync(process.argv.at(-1), "utf8");
const match = text.match(/<key>CFBundleIdentifier<\\/key>\\s*<string>([^<]+)<\\/string>/);
if (!match) process.exit(1);
process.stdout.write(match[1] + "\\n");
`,
  );

  const launchServicesLog = path.join(root, "launch-services.log");
  writeExecutable(
    path.join(commands, "lsregister"),
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.LOCAL_STUDIO_TEST_LS_LOG, process.argv.slice(2).join(" ") + "\\n");
`,
  );

  const env = {
    ...process.env,
    PATH: `${commands}:${process.env.PATH}`,
    LOCAL_STUDIO_INSTALL_ROOT: applications,
    LOCAL_STUDIO_ROLLBACK_ROOT: rollbacks,
    LOCAL_STUDIO_LSREGISTER: path.join(commands, "lsregister"),
    LOCAL_STUDIO_PLIST_BUDDY: path.join(commands, "plist-buddy"),
    LOCAL_STUDIO_SKIP_RUNTIME_CLEANUP: "1",
    LOCAL_STUDIO_TEST_LS_LOG: launchServicesLog,
  };

  return { applications, env, launchServicesLog, rollbacks, root };
}

function createBundle(directory, name, id, marker) {
  const executable = path.join(directory, "Contents", "MacOS", name);
  mkdirSync(path.dirname(executable), { recursive: true });
  writeFileSync(executable, marker, { mode: 0o755 });
  chmodSync(executable, 0o755);
  writeFileSync(
    path.join(directory, "Contents", "Info.plist"),
    `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${id}</string></dict></plist>`,
  );
}

function runInstaller(harness, args, extraEnv = {}) {
  return spawnSync("bash", [installer, ...args], {
    cwd: repository,
    encoding: "utf8",
    env: { ...harness.env, ...extraEnv },
  });
}

function installedMarker(applications, name) {
  return readFileSync(path.join(applications, `${name}.app`, "Contents", "MacOS", name), "utf8");
}

test("migrates every legacy Local Studio bundle into non-app rollback archives", (t) => {
  const harness = createHarness(t);
  createBundle(path.join(harness.applications, "Local Studio.app"), "Local Studio", "org.local.studio.desktop", "stable-current");
  createBundle(path.join(harness.applications, "Local Studio Dev.app"), "Local Studio Dev", "org.local.studio.desktop.dev", "dev-current");
  createBundle(path.join(harness.applications, "Local Studio.app.previous"), "Local Studio", "org.local.studio.desktop", "stable-old");
  createBundle(path.join(harness.applications, "Local Studio.app.previous", "Contents", "Frameworks", "Local Studio Helper.app"), "Local Studio Helper", "org.local.studio.desktop.helper", "helper");
  createBundle(path.join(harness.applications, "Local Studio Dev previous.app"), "Local Studio Dev", "org.local.studio.desktop.dev", "dev-old");
  mkdirSync(harness.rollbacks, { recursive: true });
  writeFileSync(path.join(harness.rollbacks, "Local Studio.zip"), "corrupt");

  const result = runInstaller(harness, ["--migrate-rollbacks"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(harness.applications).sort(), ["Local Studio Dev.app", "Local Studio.app"]);
  assert.equal(statSync(path.join(harness.rollbacks, "Local Studio.zip")).isFile(), true);
  assert.equal(statSync(path.join(harness.rollbacks, "Local Studio Dev.zip")).isFile(), true);
  assert.match(readFileSync(path.join(harness.rollbacks, "Local Studio.zip"), "utf8"), /^Contents\/Info\.plist$/m);
  assert.match(readFileSync(path.join(harness.rollbacks, "Local Studio Dev.zip"), "utf8"), /^Contents\/Info\.plist$/m);
  assert.equal(readdirSync(harness.rollbacks).some((entry) => entry.endsWith(".app")), false);
  const launchServices = readFileSync(harness.launchServicesLog, "utf8");
  assert.match(launchServices, /-u .*Local Studio\.app\.previous/);
  assert.match(launchServices, /-u .*Local Studio Helper\.app/);
});

test("installs through a hidden staging path and archives the outgoing app", (t) => {
  const harness = createHarness(t);
  const built = path.join(harness.root, "built", "Local Studio.app");
  createBundle(built, "Local Studio", "org.local.studio.desktop", "new");
  createBundle(path.join(harness.applications, "Local Studio.app"), "Local Studio", "org.local.studio.desktop", "old");
  createBundle(path.join(harness.applications, "Local Studio backup.app"), "Local Studio", "org.local.studio.desktop", "older");

  const result = runInstaller(harness, ["stable"], { LOCAL_STUDIO_BUILT_APP: built });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(installedMarker(harness.applications, "Local Studio"), "new");
  assert.deepEqual(readdirSync(harness.applications), ["Local Studio.app"]);
  assert.equal(existsSync(path.join(harness.rollbacks, "Local Studio.zip")), true);
  assert.equal(readdirSync(harness.applications).some((entry) => entry.includes("installing") || entry.includes("replaced")), false);
});

test("restores the original app when final signature verification fails", (t) => {
  const harness = createHarness(t);
  const built = path.join(harness.root, "built", "Local Studio.app");
  const target = path.join(harness.applications, "Local Studio.app");
  createBundle(built, "Local Studio", "org.local.studio.desktop", "new");
  createBundle(target, "Local Studio", "org.local.studio.desktop", "old");

  const result = runInstaller(harness, ["stable"], {
    LOCAL_STUDIO_BUILT_APP: built,
    LOCAL_STUDIO_TEST_FAIL_CODESIGN: target,
  });
  assert.notEqual(result.status, 0);
  assert.equal(installedMarker(harness.applications, "Local Studio"), "old");
  assert.deepEqual(readdirSync(harness.applications), ["Local Studio.app"]);
});

test("no-backup install removes stale archives and discoverable legacy bundles", (t) => {
  const harness = createHarness(t);
  const built = path.join(harness.root, "built", "Local Studio Dev.app");
  createBundle(built, "Local Studio Dev", "org.local.studio.desktop.dev", "new");
  createBundle(path.join(harness.applications, "Local Studio Dev.app"), "Local Studio Dev", "org.local.studio.desktop.dev", "old");
  createBundle(path.join(harness.applications, "Local Studio Dev.app.previous"), "Local Studio Dev", "org.local.studio.desktop.dev", "older");
  mkdirSync(harness.rollbacks, { recursive: true });
  writeFileSync(path.join(harness.rollbacks, "Local Studio Dev.zip"), "stale");

  const result = runInstaller(harness, ["dev", "--no-backup"], { LOCAL_STUDIO_BUILT_APP: built });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(installedMarker(harness.applications, "Local Studio Dev"), "new");
  assert.deepEqual(readdirSync(harness.applications), ["Local Studio Dev.app"]);
  assert.equal(existsSync(path.join(harness.rollbacks, "Local Studio Dev.zip")), false);
});

test("tracked operational scripts cannot create discoverable app backups", () => {
  const files = execFileSync("git", ["ls-files", "scripts", "frontend/scripts", ".github/workflows"], {
    cwd: repository,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter((file) => file && file !== "scripts/install-desktop-app.test.mjs");
  const violations = [];
  for (const file of files) {
    const text = readFileSync(path.join(repository, file), "utf8");
    if (/\.app\.(?:previous|prev|pre|backup)|(?:previous|backup)\.app/i.test(text)) violations.push(file);
    if (/ROLLBACK=.*\/Applications/i.test(text)) violations.push(file);
  }
  assert.deepEqual([...new Set(violations)], []);
});
