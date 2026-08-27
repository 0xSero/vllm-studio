#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contractDirectory = dirname(fileURLToPath(import.meta.url));
const manifests = await Promise.all(
  ["http-routes.json", "agent-http-routes.json"].map(async (name) => ({
    name,
    document: JSON.parse(await readFile(resolve(contractDirectory, name), "utf8")),
  })),
);
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const ownership = new Set(["head", "worker", "shared", "proxied"]);
const streaming = new Set(["always", "conditional", "never"]);
const keys = new Set();

for (const manifest of manifests) {
  if (manifest.document.version !== 1 || !Array.isArray(manifest.document.routes)) {
    throw new Error(`Invalid HTTP route manifest: ${manifest.name}`);
  }
  for (const route of manifest.document.routes) {
    const key = `${route.method} ${route.path}`;
    if (!methods.has(route.method)) throw new Error(`Invalid method for ${key}`);
    if (typeof route.path !== "string" || !route.path.startsWith("/")) {
      throw new Error(`Invalid path in ${manifest.name}`);
    }
    if (!ownership.has(route.ownership)) throw new Error(`Invalid ownership for ${key}`);
    if (!streaming.has(route.streaming)) throw new Error(`Invalid streaming value for ${key}`);
    if (keys.has(key)) throw new Error(`Duplicate HTTP route: ${key}`);
    keys.add(key);
  }
}

console.log(`Canonical HTTP route manifests contain ${keys.size} unique routes`);
