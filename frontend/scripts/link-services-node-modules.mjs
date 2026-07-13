import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const servicesDir = path.join(path.dirname(frontendDir), "services");
const linkPath = path.join(servicesDir, "node_modules");

const existingEntryKind = () => {
  try {
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink()) return "link";
    return stat.isDirectory() ? "directory" : "file";
  } catch {
    return "missing";
  }
};

const removeExistingEntry = () => {
  rmSync(linkPath, { recursive: true, force: true });
};

const createLink = () => {
  if (process.platform === "win32") {
    symlinkSync(path.join(frontendDir, "node_modules"), linkPath, "junction");
    return;
  }
  symlinkSync(path.join("..", "frontend", "node_modules"), linkPath, "dir");
};

mkdirSync(servicesDir, { recursive: true });
const kind = existingEntryKind();
if (kind === "directory") {
  console.error(
    `[link-services-node-modules] ${linkPath} is a real directory; leaving it alone.`,
  );
  process.exit(0);
}
if (kind !== "missing") removeExistingEntry();
createLink();
