import { existsSync } from "node:fs";
import path from "node:path";

function resolveResourcesDir(appOutDir, productFilename, electronPlatformName) {
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  return path.join(appOutDir, "resources");
}

export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const productFilename = packager.appInfo.productFilename;

  const resourcesDir = resolveResourcesDir(appOutDir, productFilename, electronPlatformName);
  const standaloneBase = path.join(resourcesDir, "app", "frontend", ".next", "standalone");

  const candidates = [
    path.join(standaloneBase, "frontend", "server.js"),
    path.join(standaloneBase, "server.js"),
  ];

  if (!candidates.some((candidate) => existsSync(candidate))) {
    throw new Error(
      [
        "Packaged app is missing the embedded Next standalone server — refusing to sign/ship a broken bundle.",
        `Looked for: ${candidates.join(" or ")}`,
        'electron-builder failed to copy extraResources from .next/standalone (it can log "file source doesn\'t exist" yet still exit 0).',
        "Re-run the build (run `npm run build` first if .next/standalone is absent).",
      ].join("\n  "),
    );
  }

  const agentRuntime = path.join(resourcesDir, "app", "agent-runtime", "server.mjs");
  if (!existsSync(agentRuntime)) {
    throw new Error(`Packaged app is missing the agent runtime: ${agentRuntime}`);
  }

  console.log(`  afterPack: embedded frontend and agent runtime present (${electronPlatformName})`);
}
