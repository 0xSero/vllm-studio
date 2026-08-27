import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "../../..");
export const frontendDir = path.join(repoRoot, "frontend");

export function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

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

export function walkUnder(readdirSync, directory, keep) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkUnder(readdirSync, target, keep));
    else if (keep(entry)) found.push(target);
  }
  return found;
}
