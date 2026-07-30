import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspaceDir = path.dirname(frontendDir);
const linkPaths = [
  path.join(workspaceDir, "services", "node_modules"),
  path.join(workspaceDir, "shared", "node_modules"),
];

const existingEntryKind = (linkPath) => {
  try {
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink()) return "link";
    return stat.isDirectory() ? "directory" : "file";
  } catch {
    return "missing";
  }
};

const removeExistingEntry = (linkPath) => {
  rmSync(linkPath, { recursive: true, force: true });
};

const createLink = (linkPath) => {
  if (process.platform === "win32") {
    symlinkSync(path.join(frontendDir, "node_modules"), linkPath, "junction");
    return;
  }
  const relativeTarget = path.relative(path.dirname(linkPath), path.join(frontendDir, "node_modules"));
  symlinkSync(relativeTarget, linkPath, "dir");
};

for (const linkPath of linkPaths) {
  mkdirSync(path.dirname(linkPath), { recursive: true });
  const kind = existingEntryKind(linkPath);
  if (kind === "directory") {
    console.error(`[link-services-node-modules] ${linkPath} is a real directory; leaving it alone.`);
    continue;
  }
  if (kind !== "missing") removeExistingEntry(linkPath);
  createLink(linkPath);
}
