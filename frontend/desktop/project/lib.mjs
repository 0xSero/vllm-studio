import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";

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

const DependencyRecordSchema = Type.Record(Type.String({ minLength: 1 }), Type.String());
const PackageManifestSchema = Type.Object({
  dependencies: Type.Optional(DependencyRecordSchema),
  optionalDependencies: Type.Optional(DependencyRecordSchema),
  peerDependencies: Type.Optional(DependencyRecordSchema),
});

export function readPackageManifest(manifestPath) {
  const value = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Value.Check(PackageManifestSchema, value)) {
    throw Error(`Invalid package manifest: ${manifestPath}`);
  }
  return {
    dependencies: value.dependencies ?? {},
    optionalDependencies: value.optionalDependencies ?? {},
    peerDependencies: value.peerDependencies ?? {},
  };
}

export function packageDirectoryFor(resolver, packageName) {
  const segments = packageName.split("/");
  for (const searchPath of resolver.resolve.paths(packageName) ?? []) {
    const directory = path.join(searchPath, ...segments);
    if (existsSync(path.join(directory, "package.json"))) return directory;
  }
  throw Error(`Missing browser runtime package: ${packageName}`);
}

function copyResolvablePackage(resolver, packageName, destination, copies) {
  try {
    packageDirectoryFor(resolver, packageName);
  } catch {
    return;
  }
  copyPackageTree(resolver, packageName, destination, copies);
}

export function copyPackageTree(resolver, packageName, destination, copies) {
  const source = packageDirectoryFor(resolver, packageName);
  const canonicalSource = realpathSync(source);
  const existing = copies.get(canonicalSource);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  if (existing) {
    symlinkSync(path.relative(path.dirname(destination), existing), destination, "dir");
    return;
  }
  copies.set(canonicalSource, destination);
  cpSync(source, destination, { recursive: true, dereference: true });
  rmSync(path.resolve(destination, "node_modules"), { recursive: true, force: true });
  const manifestPath = path.resolve(source, "package.json");
  const manifest = readPackageManifest(manifestPath);
  const childResolver = createRequire(manifestPath);
  for (const dependency of Object.keys(manifest.dependencies)) {
    copyPackageTree(
      childResolver,
      dependency,
      path.resolve(destination, "node_modules", dependency),
      copies,
    );
  }
  const optional = { ...manifest.optionalDependencies, ...manifest.peerDependencies };
  for (const dependency of Object.keys(optional)) {
    copyResolvablePackage(
      childResolver,
      dependency,
      path.resolve(destination, "node_modules", dependency),
      copies,
    );
  }
}
