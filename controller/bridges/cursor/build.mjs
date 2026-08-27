#!/usr/bin/env bun
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bridgeRoot = dirname(fileURLToPath(import.meta.url));
const controllerRoot = resolve(bridgeRoot, "../..");
const outputDirectory = resolve(controllerRoot, "src", "assets");
const aliases = new Map([
  ["effect", resolve(bridgeRoot, "node_modules/effect/dist/index.js")],
  [
    "@rahularya01/pi-cursor",
    resolve(bridgeRoot, "node_modules/@rahularya01/pi-cursor/dist/index.js"),
  ],
  ["@earendil-works/pi-ai", resolve(bridgeRoot, "shims/pi-ai.ts")],
  [
    "@earendil-works/pi-ai/compat",
    resolve(bridgeRoot, "shims/pi-ai-compat.ts"),
  ],
  [
    "@earendil-works/pi-coding-agent",
    resolve(bridgeRoot, "shims/pi-coding-agent.ts"),
  ],
]);

await mkdir(outputDirectory, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(bridgeRoot, "main.ts")],
  outdir: outputDirectory,
  naming: "cursor-provider.mjs",
  target: "node",
  format: "esm",
  minify: true,
  plugins: [
    {
      name: "cursor-provider-shims",
      setup(build) {
        build.onResolve({ filter: /^(?:effect|@rahularya01\/pi-cursor)$/ }, ({ path }) => ({
          path: aliases.get(path),
        }));
        build.onResolve({ filter: /^@earendil-works\/pi-ai(?:\/compat)?$/ }, ({ path }) => ({
          path: aliases.get(path),
        }));
        build.onResolve({ filter: /^@earendil-works\/pi-coding-agent$/ }, ({ path }) => ({
          path: aliases.get(path),
        }));
      },
    },
  ],
});
if (!result.success) throw new Error("Cursor provider bundle failed");
await copyFile(
  resolve(bridgeRoot, "node_modules/@rahularya01/pi-cursor/dist/h2-bridge.mjs"),
  resolve(outputDirectory, "h2-bridge.mjs"),
);
