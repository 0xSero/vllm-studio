// The @local-studio/agent-runtime package (services/agent-runtime) ships raw
// .ts and is consumed via a file: symlink, so its sources resolve external
// deps (effect, ws, the pi SDK) from their REAL path under services/ — where
// no node_modules exists on the walk-up. Bridge services/node_modules to
// frontend/node_modules so every resolver (tsc, bun, webpack, turbopack,
// Node) finds the exact same dependency instances the frontend uses.
//
// Ran from frontend/ as part of postinstall.

import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const servicesDir = path.join(path.dirname(frontendDir), "services");
const linkPath = path.join(servicesDir, "node_modules");
const target = path.join("..", "frontend", "node_modules");

mkdirSync(servicesDir, { recursive: true });
try {
  const stat = lstatSync(linkPath);
  if (!stat.isSymbolicLink()) {
    console.error(`[link-services-node-modules] ${linkPath} exists and is not a symlink; leaving it alone.`);
    process.exit(0);
  }
  rmSync(linkPath);
} catch {
  // does not exist yet
}
symlinkSync(target, linkPath, "dir");
