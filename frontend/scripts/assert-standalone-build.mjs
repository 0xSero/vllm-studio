#!/usr/bin/env node
// Preflight guard for `desktop:dist` / `desktop:pack`.
//
// electron-builder copies the embedded Next server from `.next/standalone`
// (extraResources in desktop/electron-builder.yml). If `npm run build` did not
// produce a standalone server, electron-builder has been observed to log
// "file source doesn't exist from=.../.next/standalone" yet still exit 0 and
// ship a signed bundle that crashes at launch with "Missing standalone server
// build". Assert the source exists BEFORE electron-builder runs so the build
// fails here, loudly and early, instead of producing a broken artifact.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const standaloneBase = resolve(projectRoot, ".next", "standalone");

// Mirror the runtime resolution in desktop/configs.ts + app-server.ts
// (resolveStandaloneServerRoot): nested `frontend/server.js` first, then the
// flat `server.js` fallback.
const candidates = [
  resolve(standaloneBase, "frontend", "server.js"),
  resolve(standaloneBase, "server.js"),
];

if (!candidates.some((candidate) => existsSync(candidate))) {
  console.error("\n  standalone build check FAILED\n");
  console.error("  Missing the embedded Next standalone server.");
  console.error(`  Looked for:\n    ${candidates.join("\n    ")}`);
  console.error('  Run "npm run build" first (it produces .next/standalone).\n');
  process.exit(1);
}

console.log("  standalone server build present");
