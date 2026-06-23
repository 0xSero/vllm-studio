// Postflight guard wired into desktop/electron-builder.yml as `afterPack`.
//
// electron-builder has been observed to log
//   "file source doesn't exist from=.../frontend/.next/standalone"
// while copying the extraResources standalone server, yet still exit 0 and
// produce a signed .dmg whose
//   Contents/Resources/app/frontend/.next/standalone/frontend/server.js
// was never copied. That bundle then crashes at launch with
//   "Missing standalone server build: ... Run npm run build first."
//
// afterPack runs after the app directory is fully packed but BEFORE code
// signing and distributable (dmg/zip) creation, so throwing here aborts the
// build loudly instead of shipping a broken signed bundle.
import { existsSync } from "node:fs";
import path from "node:path";

/** Resolve the packed app's resources root for the given platform. */
function resolveResourcesDir(appOutDir, productFilename, electronPlatformName) {
  if (electronPlatformName === "darwin" || electronPlatformName === "mas") {
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  }
  // win32 + linux unpacked layout both nest resources directly under appOutDir.
  return path.join(appOutDir, "resources");
}

export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const productFilename = packager.appInfo.productFilename;

  const resourcesDir = resolveResourcesDir(appOutDir, productFilename, electronPlatformName);
  const standaloneBase = path.join(resourcesDir, "app", "frontend", ".next", "standalone");

  // Mirror the runtime resolution in desktop/configs.ts + app-server.ts
  // (resolveStandaloneServerRoot): nested `frontend/server.js` first, then the
  // flat `server.js` fallback.
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

  console.log(`  afterPack: embedded standalone server present (${electronPlatformName})`);
}
