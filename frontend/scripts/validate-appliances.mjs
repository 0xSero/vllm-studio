import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPLIANCE_PROFILES } from "../../shared/agent/appliance-profile.mjs";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFields = [
  "applianceId",
  "appName",
  "shortName",
  "description",
  "themeColor",
  "iconSvgPath",
  "logoLightPath",
  "logoDarkPath",
  "logoHighContrastPath",
  "logoForcedColorsPath",
  "icon192Path",
  "icon512Path",
  "appleTouchIconPath",
  "desktopAppId",
  "desktopDevAppId",
  "desktopDevAppName",
  "desktopIconPath",
  "defaultThemeId",
  "fontFamily",
  "fontMonoFamily",
  "handlingLevel",
  "classificationCode",
  "classificationLabel",
];

for (const [id, profile] of Object.entries(APPLIANCE_PROFILES)) {
  if (profile.applianceId !== id) throw new Error(`${id} applianceId does not match its key`);
  for (const field of requiredFields) {
    if (typeof profile[field] !== "string" || profile[field].trim().length === 0) {
      throw new Error(`${id}.${field} must be a non-empty string`);
    }
  }
  for (const assetPath of [
    profile.iconSvgPath,
    profile.logoLightPath,
    profile.logoDarkPath,
    profile.logoHighContrastPath,
    profile.logoForcedColorsPath,
    profile.icon192Path,
    profile.icon512Path,
    profile.appleTouchIconPath,
  ]) {
    const file = path.join(frontend, "public", assetPath.replace(/^\/+/, ""));
    if (!existsSync(file)) throw new Error(`${id} web asset is missing: ${file}`);
  }
  const desktopIcon = path.join(frontend, profile.desktopIconPath);
  if (!existsSync(desktopIcon)) throw new Error(`${id} desktop icon is missing: ${desktopIcon}`);
}

const cortaix = APPLIANCE_PROFILES["cortaix-factory"];
if (cortaix.defaultThemeId !== "cortaix-dark") {
  throw new Error("cortAIx Factory must default to cortaix-dark");
}
if (
  cortaix.allowedThemeIds.length !== 2 ||
  !cortaix.allowedThemeIds.includes("cortaix-light") ||
  !cortaix.allowedThemeIds.includes("cortaix-dark")
) {
  throw new Error("cortAIx Factory must expose exactly its light and dark themes");
}

const tokens = readFileSync(path.join(frontend, "src/app/styles/globals/tokens.css"), "utf8");
for (const token of ["--proof", "--emergency", "--signal", "--signal-bright", "--signal-deep"]) {
  if (!tokens.includes(token)) throw new Error(`cortAIx semantic token is missing: ${token}`);
}

const shell = [
  "left-sidebar.tsx",
  "authority-footer.tsx",
  "appliance-brand-mark.tsx",
]
  .map((file) => readFileSync(path.join(frontend, "src/features/shell", file), "utf8"))
  .join("\n");
for (const requirement of [
  "Skip to content",
  'role="contentinfo"',
  'data-handling-origin="derived"',
  "mode changes deployment, not governance semantics",
  'id="main-content"',
]) {
  if (!shell.includes(requirement))
    throw new Error(`cortAIx shell requirement is missing: ${requirement}`);
}

console.log(`Validated ${Object.keys(APPLIANCE_PROFILES).length} appliance profiles`);
