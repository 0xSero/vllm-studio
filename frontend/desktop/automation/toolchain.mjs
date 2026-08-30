// Machine and repository setup: tool version gates, dependency install, the
// services/node_modules link, and git hook registration.

import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { frontendDir, git, platformInvocation, repoRoot, run } from "./lib.mjs";

function parsedVersion(value) {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

function versionMeetsMinimum(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

function probeTool(command, args) {
  const [resolvedCommand, resolvedArgs] = platformInvocation(command, args);
  const result = spawnSync(resolvedCommand, resolvedArgs, { cwd: repoRoot, encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function requireTool(label, command, args, minimum) {
  const output = probeTool(command, args);
  if (output === null) throw Error(`${label} is required but unavailable`);
  const actual = parsedVersion(output);
  if (!actual || !versionMeetsMinimum(actual, minimum)) {
    throw Error(`${label} ${minimum.join(".")} or newer is required; found ${output || "unknown"}`);
  }
  console.log(`${label}: ${actual.join(".")}`);
}

/**
 * Python is the one tool whose name is not settled on Windows: the python.org installer
 * ships `python` and the `py` launcher, and the `python3` that is on PATH is usually the
 * Microsoft Store stub, which exits non-zero without a version. Try the spellings in
 * turn and require one of them to satisfy the minimum, reporting what was actually
 * found when none does. Only Windows takes this path.
 */
function requireToolCandidate(label, candidates, minimum) {
  const found = [];
  for (const [command, args] of candidates) {
    const output = probeTool(command, args);
    if (output === null) continue;
    const actual = parsedVersion(output);
    if (actual && versionMeetsMinimum(actual, minimum)) {
      console.log(`${label}: ${actual.join(".")}`);
      return;
    }
    if (output) found.push(output);
  }
  throw Error(
    `${label} ${minimum.join(".")} or newer is required${found.length > 0 ? `; found ${found.join(", ")}` : " but unavailable"}`,
  );
}

export function doctor() {
  requireTool("Node.js", process.execPath, ["--version"], [22, 19, 0]);
  requireTool("npm", "npm", ["--version"], [10, 0, 0]);
  requireTool("Bun", "bun", ["--version"], [1, 3, 14]);
  if (process.platform === "win32") {
    requireToolCandidate(
      "Python",
      [
        ["python", ["--version"]],
        ["py", ["-3", "--version"]],
        ["python3", ["--version"]],
      ],
      [3, 10, 0],
    );
  } else {
    requireTool("Python", "python3", ["--version"], [3, 10, 0]);
  }
  requireTool("Git", "git", ["--version"], [2, 0, 0]);
  console.log("Toolchain check passed");
}

export function setupRepository() {
  doctor();
  for (const directory of ["controller", "shared", "services/agent-runtime"]) {
    run("bun", ["install", "--frozen-lockfile"], path.join(repoRoot, directory));
  }
  run("npm", ["ci", "--legacy-peer-deps"], frontendDir);
  console.log("Repository setup complete");
}

/**
 * services/ has no install of its own: its node_modules is a symlink into
 * frontend's, so the agent-runtime resolves the same dependency tree the app
 * ships. A real directory there is left alone — someone made it on purpose.
 */
export function linkServices() {
  const servicesDir = path.join(repoRoot, "services");
  const linkPath = path.join(servicesDir, "node_modules");
  mkdirSync(servicesDir, { recursive: true });

  let kind = "missing";
  try {
    const stat = lstatSync(linkPath);
    kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : "file";
  } catch {
    // missing
  }
  if (kind === "directory") {
    console.error(`[link-services] ${linkPath} is a real directory; leaving it alone.`);
    process.exit(0);
  }
  if (kind !== "missing") rmSync(linkPath, { recursive: true, force: true });

  if (process.platform === "win32") {
    symlinkSync(path.join(frontendDir, "node_modules"), linkPath, "junction");
  } else {
    symlinkSync(path.join("..", "frontend", "node_modules"), linkPath, "dir");
  }
}

export function setupHooks() {
  const worktree = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (worktree.status !== 0 || worktree.stdout.trim() !== "true") {
    console.log("Skipping Git hook setup outside a worktree");
    return;
  }
  git(["rev-parse", "--git-dir"]);
  git(["config", "core.hooksPath", ".githooks"]);
  // NTFS has no executable bit and chmod is a no-op there at best; git records the
  // committed 100755 mode either way, which is what the hooks actually need.
  if (process.platform === "win32") return;
  for (const name of readdirSync(path.join(repoRoot, ".githooks"))) {
    chmodSync(path.join(repoRoot, ".githooks", name), 0o755);
  }
}
