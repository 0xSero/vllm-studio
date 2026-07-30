import { app } from "electron";
import path from "node:path";
import { readFileSync } from "node:fs";
import { migrateLegacyUserData } from "./logic/user-data-migration";
import { mirrorStableUserData } from "./logic/dev-channel-mirror";

const LEGACY_BRANDED_APP_NAME = ["v", "LLM Studio"].join("");
const LEGACY_USER_DATA_NAMES = [LEGACY_BRANDED_APP_NAME, "frontend"];
const devAppName = process.env.LOCAL_STUDIO_DESKTOP_APP_NAME?.trim();
const configuredDevAppName = process.env.LOCAL_STUDIO_DESKTOP_DEV_APP_NAME?.trim();
const devUserDataDir = process.env.LOCAL_STUDIO_DESKTOP_USER_DATA_DIR?.trim();
// A packaged build must know its own channel without depending on the
// environment it happens to be launched from: electron-builder stamps
// `localStudioChannel` into the bundled package.json via extraMetadata.
function packagedIdentity(): {
  channel?: string;
  appName?: string;
  devAppName?: string;
} {
  if (!app.isPackaged) return {};
  try {
    const metaPath = path.join(app.getAppPath(), "package.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    return {
      channel: typeof meta.localStudioChannel === "string" ? meta.localStudioChannel : undefined,
      appName:
        typeof meta.localStudioBrandAppName === "string" ? meta.localStudioBrandAppName : undefined,
      devAppName:
        typeof meta.localStudioBrandDevAppName === "string"
          ? meta.localStudioBrandDevAppName
          : undefined,
    };
  } catch {
    return {};
  }
}

const packaged = packagedIdentity();
const canonicalAppName =
  process.env.LOCAL_STUDIO_BRAND_APP_NAME?.trim() || packaged.appName || "Local Studio";
const CANONICAL_APP_NAME = canonicalAppName;
const releaseChannel = (process.env.LOCAL_STUDIO_DESKTOP_CHANNEL ?? packaged.channel)
  ?.trim()
  .toLowerCase();

// Exactly two shipped channels: `dev` (built from the dev branch) and stable
// (built from main). The dev channel is packaged under its own app id, product
// name and user-data dir, so the two installs never collide and Launch Services
// can never resolve one when you asked for the other.
const DEV_APP_NAME =
  configuredDevAppName && configuredDevAppName.length > 0
    ? configuredDevAppName
    : packaged.devAppName
      ? packaged.devAppName
      : `${CANONICAL_APP_NAME} Dev`;
const isDevChannel = releaseChannel === "dev";
const nonStablePackagedChannel =
  app.isPackaged && releaseChannel !== undefined && releaseChannel !== "" && !isDevChannel;

if (nonStablePackagedChannel) {
  throw new Error(
    `Unknown packaged desktop channel "${releaseChannel}". Only "dev" and stable (unset) are supported.`,
  );
}

const channelAppName = isDevChannel ? DEV_APP_NAME : undefined;
const appName =
  devAppName || channelAppName || (app.isPackaged ? CANONICAL_APP_NAME : app.getName());
if (devAppName || channelAppName || app.isPackaged) {
  app.setName(appName);
  process.title = appName;
}

const appDataDir = app.getPath("appData");
const userDataDir = devUserDataDir
  ? path.resolve(devUserDataDir)
  : app.isPackaged
    ? path.join(appDataDir, appName)
    : app.getPath("userData");

app.setPath("userData", userDataDir);

// Dev channel: refresh a one-way snapshot of the stable app's state on every
// launch, so the dev build shows your real projects and sessions while writing
// only to its own directory.
if (isDevChannel && !devUserDataDir) {
  const stableDir = path.join(appDataDir, CANONICAL_APP_NAME);
  try {
    const result = mirrorStableUserData({ stableDir, devDir: userDataDir });
    console.info(
      `[desktop] dev channel mirrored ${result.copied.length} entries from ${CANONICAL_APP_NAME}`,
    );
  } catch (error) {
    console.warn("[desktop] dev channel mirror failed:", error);
  }
}

if (app.isPackaged && appName === CANONICAL_APP_NAME && !devAppName && !devUserDataDir) {
  for (const legacyName of LEGACY_USER_DATA_NAMES) {
    const migrated = migrateLegacyUserData({
      legacyDir: path.join(appDataDir, legacyName),
      targetDir: userDataDir,
    });
    if (migrated.length > 0) {
      console.info(
        `[desktop] Migrated ${migrated.length} legacy user-data paths from ${legacyName}`,
      );
    }
  }
}
