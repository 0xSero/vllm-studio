import { spawnSync } from "node:child_process";
import process from "node:process";
import { resolveApplianceProfile } from "../../shared/agent/appliance-profile.mjs";

function readValue(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

const mode = process.argv[2] ?? "dist";
const appliance = resolveApplianceProfile();
const applianceId = appliance.applianceId;
const brandAppId = appliance.desktopAppId;
const brandAppName = appliance.appName;
const brandDevAppId = appliance.desktopDevAppId;
const brandDevAppName = appliance.desktopDevAppName;

const baseArgs = [
  "--config",
  "desktop/electron-builder.yml",
  `--config.mac.icon=${appliance.desktopIconPath}`,
];

const macCategory = readValue("LOCAL_STUDIO_MAC_CATEGORY", "");
const macIdentity = readValue("LOCAL_STUDIO_MAC_IDENTITY", "");
if (macCategory) {
  baseArgs.push(`--config.mac.category=${macCategory}`);
}
if (macIdentity) {
  baseArgs.push(`--config.mac.identity=${macIdentity}`);
}

const stableBrandArgs = [
  `--config.appId=${brandAppId}`,
  `--config.productName=${brandAppName}`,
  "--config.extraMetadata.localStudioChannel=stable",
  `--config.extraMetadata.localStudioAppliance=${applianceId}`,
  `--config.extraMetadata.localStudioBrandAppName=${brandAppName}`,
  `--config.extraMetadata.localStudioBrandDevAppName=${brandDevAppName}`,
];

const modeArgsByName = {
  dist: [...stableBrandArgs],
  "dist-dev": [
    `--config.appId=${brandDevAppId}`,
    `--config.productName=${brandDevAppName}`,
    "--config.extraMetadata.localStudioChannel=dev",
    `--config.extraMetadata.localStudioAppliance=${applianceId}`,
    `--config.extraMetadata.localStudioBrandAppName=${brandAppName}`,
    `--config.extraMetadata.localStudioBrandDevAppName=${brandDevAppName}`,
    "--config.directories.output=dist-desktop-dev",
  ],
  "dist-notarized": [...stableBrandArgs, "--config.mac.notarize=true"],
  pack: ["--dir", ...stableBrandArgs],
};

const modeArgs = modeArgsByName[mode];
if (!modeArgs) {
  console.error(`Unknown electron-builder mode: ${mode}`);
  process.exit(1);
}

const result = spawnSync("electron-builder", [...baseArgs, ...modeArgs, ...process.argv.slice(3)], {
  env: {
    ...process.env,
    LOCAL_STUDIO_BRAND_APP_ID: brandAppId,
    LOCAL_STUDIO_BRAND_APP_NAME: brandAppName,
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
