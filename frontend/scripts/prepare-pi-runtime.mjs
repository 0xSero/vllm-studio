import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceNodeModules = path.join(root, "node_modules");
const targetNodeModules = path.join(root, ".desktop-pi-runtime", "node_modules");
const copied = new Set();

function packageDir(name) {
  return path.join(sourceNodeModules, ...name.split("/"));
}

function copyPackage(name) {
  if (copied.has(name)) return;
  copied.add(name);
  const source = packageDir(name);
  const manifest = path.join(source, "package.json");
  if (!existsSync(manifest)) return;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) copyPackage(dep);
  const target = path.join(targetNodeModules, ...name.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true, dereference: true });
}

function removeBinDirs(directory) {
  for (const dirent of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, dirent.name);
    if (dirent.isDirectory() && dirent.name === ".bin") {
      rmSync(child, { recursive: true, force: true });
    } else if (dirent.isDirectory()) {
      removeBinDirs(child);
    }
  }
}

rmSync(targetNodeModules, { recursive: true, force: true });
copyPackage("@mariozechner/pi-coding-agent");
removeBinDirs(targetNodeModules);
console.log(`Prepared desktop Pi runtime (${copied.size} packages).`);
