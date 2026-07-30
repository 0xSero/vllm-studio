import { readFileSync } from "node:fs";

export const APPLIANCE_PROFILES = JSON.parse(
  readFileSync(new URL("./appliances.json", import.meta.url), "utf8"),
);

export function readEnvironmentValue(environment, name, fallback) {
  const value = environment[name];
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function resolveApplianceProfile(environment = process.env) {
  const applianceId = readEnvironmentValue(environment, "LOCAL_STUDIO_APPLIANCE", "local-studio");
  const appliance = APPLIANCE_PROFILES[applianceId];
  if (!appliance) throw new Error(`Unknown appliance: ${applianceId}`);
  return {
    ...appliance,
    applianceId,
    appName: readEnvironmentValue(environment, "LOCAL_STUDIO_BRAND_APP_NAME", appliance.appName),
    desktopAppId: readEnvironmentValue(
      environment,
      "LOCAL_STUDIO_BRAND_APP_ID",
      appliance.desktopAppId,
    ),
    desktopDevAppId: readEnvironmentValue(
      environment,
      "LOCAL_STUDIO_BRAND_DEV_APP_ID",
      appliance.desktopDevAppId,
    ),
    desktopDevAppName: readEnvironmentValue(
      environment,
      "LOCAL_STUDIO_BRAND_DEV_APP_NAME",
      appliance.desktopDevAppName,
    ),
  };
}
