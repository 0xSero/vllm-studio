// Shared plumbing for the automation modules. Everything here is deliberately
// boring: repo-root resolution, arg parsing, and child-process wrappers that
// fail loudly. The modules in this directory are plain ESM with no import-time
// side effects — each exports functions the project.mjs entry dispatches to.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Repo root: this file lives at frontend/desktop/automation/lib.mjs. */
export const repoRoot = path.resolve(import.meta.dirname, "../../..");
export const frontendDir = path.join(repoRoot, "frontend");

/** The value following a --flag in an argv slice, or undefined. */
export function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * Windows has no `npm`, `npx`, or `bun` on PATH — it has `npm.cmd`, `npx.cmd`, and a
 * `bun.exe` that a Node-managed install leaves outside PATH entirely. spawnSync does
 * not consult PATHEXT, so the bare name fails with ENOENT. Resolve npm and npx to the
 * JavaScript CLI the running Node already ships and invoke it directly, which also
 * avoids handing an argv to cmd.exe for re-parsing. POSIX is returned untouched.
 */
export function platformInvocation(command, args) {
  if (process.platform !== "win32") return [command, args];
  if (command === "bun") {
    const candidates = [
      path.join(path.dirname(process.execPath), "node_modules", "bun", "bin", "bun.exe"),
      process.env["BUN_INSTALL"] ? path.join(process.env["BUN_INSTALL"], "bin", "bun.exe") : null,
    ];
    const executable = candidates.find((candidate) => candidate && existsSync(candidate));
    return executable ? [executable, args] : [command, args];
  }
  if (command !== "npm" && command !== "npx") return [command, args];
  const npmCli = process.env["npm_execpath"]?.trim();
  const cli =
    command === "npm" ? npmCli : npmCli ? path.join(path.dirname(npmCli), "npx-cli.js") : null;
  const fallback = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    `${command}-cli.js`,
  );
  const script = cli && existsSync(cli) ? cli : fallback;
  return [process.execPath, [script, ...args]];
}

/** Run a command inheriting stdio; exit the process with its status on failure. */
export function run(command, args, cwd = repoRoot) {
  const [resolvedCommand, resolvedArgs] = platformInvocation(command, args);
  const result = spawnSync(resolvedCommand, resolvedArgs, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Run a command and return its trimmed stdout; throws on failure. */
export function commandOutput(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  }).trim();
}

export function git(args, options = {}) {
  return commandOutput("git", args, options);
}

/**
 * Manual walks, NOT readdirSync({recursive:true}): recursive readdir follows
 * symlinked directories, so one self-referential symlink in node_modules
 * expands forever and the build dies OOM. Dirent.isDirectory() is false for
 * symlinks, so these never descend through one.
 */
export function walkUnder(readdirSync, directory, keep) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkUnder(readdirSync, target, keep));
    else if (keep(entry)) found.push(target);
  }
  return found;
}
