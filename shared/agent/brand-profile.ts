import appliances from "./appliances.json";

export type ApplianceId = keyof typeof appliances;

export type BrandProfile = {
  applianceId: ApplianceId;
  appName: string;
  shortName: string;
  description: string;
  themeColor: string;
  iconSvgPath: string;
  logoLightPath: string;
  logoDarkPath: string;
  logoHighContrastPath: string;
  logoForcedColorsPath: string;
  icon192Path: string;
  icon512Path: string;
  appleTouchIconPath: string;
  manifestPath: string;
  desktopAppId: string;
  desktopDevAppId: string;
  desktopDevAppName: string;
  desktopIconPath: string;
  defaultThemeId: string;
  allowedThemeIds: readonly string[];
  fontFamily: string;
  fontMonoFamily: string;
  handlingLevel: "open" | "internal" | "restricted" | "sealed" | "contained";
  classificationCode: string;
  classificationLabel: string;
};

type Environment = Readonly<Record<string, string | undefined>>;

const APPLIANCE_PROFILES = appliances as Record<ApplianceId, BrandProfile>;
const DEFAULT_APPLIANCE_ID: ApplianceId = "local-studio";

const readEnv = (environment: Environment, name: string): string | undefined => {
  const value = environment[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const isApplianceId = (value: string): value is ApplianceId => value in APPLIANCE_PROFILES;

export const resolveApplianceId = (environment: Environment = process.env): ApplianceId => {
  const configured = readEnv(environment, "LOCAL_STUDIO_APPLIANCE");
  return configured && isApplianceId(configured) ? configured : DEFAULT_APPLIANCE_ID;
};

export const resolveBrandProfile = (environment: Environment = process.env): BrandProfile => {
  const base = APPLIANCE_PROFILES[resolveApplianceId(environment)];
  return {
    ...base,
    appName: readEnv(environment, "LOCAL_STUDIO_BRAND_APP_NAME") ?? base.appName,
    shortName: readEnv(environment, "LOCAL_STUDIO_BRAND_SHORT_NAME") ?? base.shortName,
    description: readEnv(environment, "LOCAL_STUDIO_BRAND_DESCRIPTION") ?? base.description,
    themeColor: readEnv(environment, "LOCAL_STUDIO_BRAND_THEME_COLOR") ?? base.themeColor,
    iconSvgPath: readEnv(environment, "LOCAL_STUDIO_BRAND_ICON_SVG") ?? base.iconSvgPath,
    logoLightPath:
      readEnv(environment, "LOCAL_STUDIO_BRAND_LOGO_LIGHT") ?? base.logoLightPath,
    logoDarkPath: readEnv(environment, "LOCAL_STUDIO_BRAND_LOGO_DARK") ?? base.logoDarkPath,
    logoHighContrastPath:
      readEnv(environment, "LOCAL_STUDIO_BRAND_LOGO_HIGH_CONTRAST") ??
      base.logoHighContrastPath,
    logoForcedColorsPath:
      readEnv(environment, "LOCAL_STUDIO_BRAND_LOGO_FORCED_COLORS") ??
      base.logoForcedColorsPath,
    icon192Path: readEnv(environment, "LOCAL_STUDIO_BRAND_ICON_192") ?? base.icon192Path,
    icon512Path: readEnv(environment, "LOCAL_STUDIO_BRAND_ICON_512") ?? base.icon512Path,
    appleTouchIconPath:
      readEnv(environment, "LOCAL_STUDIO_BRAND_APPLE_TOUCH_ICON") ?? base.appleTouchIconPath,
    manifestPath: readEnv(environment, "LOCAL_STUDIO_BRAND_MANIFEST_PATH") ?? base.manifestPath,
    desktopAppId: readEnv(environment, "LOCAL_STUDIO_BRAND_APP_ID") ?? base.desktopAppId,
    desktopDevAppId: readEnv(environment, "LOCAL_STUDIO_BRAND_DEV_APP_ID") ?? base.desktopDevAppId,
    desktopDevAppName:
      readEnv(environment, "LOCAL_STUDIO_BRAND_DEV_APP_NAME") ?? base.desktopDevAppName,
    classificationCode:
      readEnv(environment, "LOCAL_STUDIO_BRAND_CLASSIFICATION_CODE") ??
      base.classificationCode,
    classificationLabel:
      readEnv(environment, "LOCAL_STUDIO_BRAND_CLASSIFICATION_LABEL") ??
      base.classificationLabel,
  };
};

export const DEFAULT_BRAND_PROFILE = APPLIANCE_PROFILES[DEFAULT_APPLIANCE_ID];
export { APPLIANCE_PROFILES, DEFAULT_APPLIANCE_ID };
