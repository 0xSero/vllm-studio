import {
  DEFAULT_FONT_FAMILY_ID,
  DEFAULT_FONT_SIZE_ID,
  FONT_FAMILY_BY_ID,
  FONT_SIZE_BY_ID,
  THEME_BY_ID,
  type FontFamilyId,
  type FontSizeId,
  type ThemeId,
  type ThemeTokens,
} from "@/lib/themes";
import { BRAND_PROFILE } from "@/lib/brand-profile";

export const APP_STORE_KEY = "local-studio-state";
export const CUSTOM_THEME_TOKEN_KEY = "local-studio.customThemeTokens";
const configuredDefaultThemeId = BRAND_PROFILE.defaultThemeId as ThemeId;
export const DEFAULT_THEME_ID: ThemeId = THEME_BY_ID.has(configuredDefaultThemeId)
  ? configuredDefaultThemeId
  : "zai-dark";

export function resolveThemeModeIds(allowedThemeIds: readonly string[]): {
  light: ThemeId;
  dark: ThemeId;
} {
  return {
    light: allowedThemeIds.includes("cortaix-light") ? "cortaix-light" : "zai-light",
    dark: allowedThemeIds.includes("cortaix-dark") ? "cortaix-dark" : "zai-dark",
  };
}

const THEME_MODE_IDS = resolveThemeModeIds(BRAND_PROFILE.allowedThemeIds);
export const LIGHT_THEME_ID = THEME_MODE_IDS.light;
export const DARK_THEME_ID = THEME_MODE_IDS.dark;
const DEFAULT_CONTRAST_MODE = "auto";

export type ContrastMode = "auto" | "standard" | "high";

const THEME_TOKENS_BY_ID = Object.fromEntries(
  Array.from(THEME_BY_ID.entries()).map(([id, theme]) => [id, theme.tokens]),
) as Record<string, ThemeTokens>;

function lightnessFromColor(value: string): number | null {
  const hsl = value.match(/hsla?\([^,]+,\s*[^,]+,\s*([\d.]+)%/i);
  if (hsl) return Number(hsl[1]);

  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  const raw = hex[1];
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((part) => part + part)
          .join("")
      : raw;
  const r = Number.parseInt(expanded.slice(0, 2), 16) / 255;
  const g = Number.parseInt(expanded.slice(2, 4), 16) / 255;
  const b = Number.parseInt(expanded.slice(4, 6), 16) / 255;
  return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2) * 100;
}

export function isLightThemeId(themeId: ThemeId): boolean {
  const theme = THEME_BY_ID.get(themeId);
  return theme ? (lightnessFromColor(theme.tokens.bg) ?? 0) > 50 : false;
}

export function resolveThemeId(
  themeId: unknown,
  allowedThemeIds: readonly string[] = BRAND_PROFILE.allowedThemeIds,
  defaultThemeId: ThemeId = DEFAULT_THEME_ID,
): ThemeId {
  const requestedThemeId = typeof themeId === "string" ? (themeId as ThemeId) : defaultThemeId;
  const allowed =
    allowedThemeIds.length === 0 || allowedThemeIds.includes(requestedThemeId)
      ? requestedThemeId
      : defaultThemeId;
  return THEME_BY_ID.has(allowed) ? allowed : defaultThemeId;
}

function deriveThemeUiTokens(tokens: ThemeTokens): Record<string, string> {
  const isLight = (lightnessFromColor(tokens.bg) ?? 0) > 50;
  const ink = isLight ? "26, 28, 31" : "255, 255, 255";
  return {
    // White/ink overlays over a unified canvas: 8% surfaces, 5% hover,
    // 8% active, hairline 8% borders — the same ratios tokens.css encodes.
    "surface-2": `rgba(${ink}, 0.08)`,
    "surface-3": `rgba(${ink}, 0.05)`,
    // The rail sits one tone step above the canvas so the body reads darker
    // than the left navbar (mirrors tokens.css --color-sidebar).
    rail: isLight ? "#f9f9f9" : `color-mix(in srgb, ${tokens.bg} 97%, #ffffff)`,
    border: `rgba(${ink}, 0.08)`,
    separator: `rgba(${ink}, 0.05)`,
    hover: `rgba(${ink}, 0.05)`,
    active: `rgba(${ink}, 0.08)`,
    composer: "var(--sidebar-bg)",
    "composer-footer": "var(--sidebar-bg)",
  };
}

const THEME_UI_TOKENS_BY_ID = Object.fromEntries(
  Array.from(THEME_BY_ID.entries()).map(([id, theme]) => [id, deriveThemeUiTokens(theme.tokens)]),
) as Record<string, Record<string, string>>;

const FONT_FAMILY_CSS_BY_ID = Object.fromEntries(
  Array.from(FONT_FAMILY_BY_ID.entries()).map(([id, option]) => [id, option.cssValue]),
) as Record<string, string>;

const FONT_SIZE_CSS_BY_ID = Object.fromEntries(
  Array.from(FONT_SIZE_BY_ID.entries()).map(([id, option]) => [id, option.cssValue]),
) as Record<string, string>;

function setThemeTokens(tokens: ThemeTokens): void {
  if (typeof document === "undefined") return;
  for (const [key, value] of Object.entries({ ...tokens, ...deriveThemeUiTokens(tokens) })) {
    document.documentElement.style.setProperty(`--${key}`, value);
  }
}

function isThemeTokens(value: unknown): value is ThemeTokens {
  if (!value || typeof value !== "object") return false;
  return ["bg", "fg", "dim", "border", "surface", "accent", "hl1", "hl2", "hl3", "err"].every(
    (key) => typeof (value as Record<string, unknown>)[key] === "string",
  );
}

export function readCustomThemeTokens(themeId: ThemeId): ThemeTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CUSTOM_THEME_TOKEN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { themeId?: unknown; tokens?: unknown };
    return value.themeId === themeId && isThemeTokens(value.tokens) ? value.tokens : null;
  } catch {
    return null;
  }
}

export function writeCustomThemeTokens(themeId: ThemeId, tokens: ThemeTokens): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CUSTOM_THEME_TOKEN_KEY, JSON.stringify({ themeId, tokens }));
}

export function clearCustomThemeTokens(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CUSTOM_THEME_TOKEN_KEY);
}

export function applyStoredCustomThemeTokens(themeId: ThemeId): ThemeTokens | null {
  const tokens = readCustomThemeTokens(themeId);
  if (tokens) setThemeTokens(tokens);
  return tokens;
}

function systemPrefersHighContrast(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return (
    window.matchMedia("(forced-colors: active)").matches ||
    window.matchMedia("(prefers-contrast: more)").matches
  );
}

export function applyContrastModeToDocument(contrastMode: ContrastMode): ContrastMode {
  if (typeof document === "undefined") return contrastMode;
  const resolvedMode =
    contrastMode === "high" || (contrastMode === "auto" && systemPrefersHighContrast())
      ? "high"
      : "standard";
  document.documentElement.setAttribute("data-contrast-preference", contrastMode);
  document.documentElement.setAttribute("data-contrast-mode", resolvedMode);
  return contrastMode;
}

export function applyThemeToDocument(themeId: ThemeId): ThemeId {
  const resolvedThemeId = resolveThemeId(themeId);
  if (typeof document === "undefined") return resolvedThemeId;
  const previousThemeId = document.documentElement.getAttribute("data-theme");
  if (previousThemeId && previousThemeId !== resolvedThemeId) clearCustomThemeTokens();
  const nextTheme = THEME_BY_ID.get(resolvedThemeId) ?? THEME_BY_ID.get(DEFAULT_THEME_ID);
  if (!nextTheme) return themeId;

  document.documentElement.setAttribute("data-theme", nextTheme.id);
  setThemeTokens(nextTheme.tokens);
  return nextTheme.id;
}

export function applyFontFamilyToDocument(fontFamilyId: FontFamilyId): FontFamilyId {
  if (typeof document === "undefined") return fontFamilyId;

  if (BRAND_PROFILE.applianceId !== "local-studio") {
    document.documentElement.style.setProperty("--font-sans", BRAND_PROFILE.fontFamily);
    document.documentElement.style.setProperty("--font-mono", BRAND_PROFILE.fontMonoFamily);
    return fontFamilyId;
  }

  const nextFont =
    FONT_FAMILY_BY_ID.get(fontFamilyId) ?? FONT_FAMILY_BY_ID.get(DEFAULT_FONT_FAMILY_ID);
  if (!nextFont) return fontFamilyId;

  document.documentElement.style.setProperty("--font-sans", nextFont.cssValue);
  return nextFont.id;
}

export function applyFontSizeToDocument(fontSizeId: FontSizeId): FontSizeId {
  if (typeof document === "undefined") return fontSizeId;

  const nextSize = FONT_SIZE_BY_ID.get(fontSizeId) ?? FONT_SIZE_BY_ID.get(DEFAULT_FONT_SIZE_ID);
  if (!nextSize) return fontSizeId;

  document.documentElement.style.setProperty("--app-font-size", nextSize.cssValue);
  return nextSize.id;
}

export function applyTokensToDocument(tokens: ThemeTokens): void {
  if (typeof document === "undefined") return;
  setThemeTokens(tokens);
}

/* ── Master scale/shape knobs (beyond colors) the Appearance editor controls ──
   These set the canonical CSS variables that the whole UI derives from, so a
   handful of values re-theme everything uniformly. Persisted to localStorage and
   re-applied on load. */
const UI_CONTROLS_KEY = "local-studio.uiControls";

export function applyUiControl(name: string, value: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(name, value);
  try {
    const raw = window.localStorage.getItem(UI_CONTROLS_KEY);
    const next = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    next[name] = value;
    window.localStorage.setItem(UI_CONTROLS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function applyStoredUiControls(): void {
  if (typeof document === "undefined") return;
  try {
    const raw = window.localStorage.getItem(UI_CONTROLS_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Record<string, string>;
    for (const [name, value] of Object.entries(stored)) {
      if (name === "--composer" || name === "--composer-footer") continue;
      if (typeof value === "string") document.documentElement.style.setProperty(name, value);
    }
  } catch {
    /* ignore */
  }
}

type ThemeBootstrapBrand = Pick<
  typeof BRAND_PROFILE,
  "applianceId" | "allowedThemeIds" | "defaultThemeId" | "fontFamily" | "fontMonoFamily"
>;

export function getThemeBootstrapScript(brand: ThemeBootstrapBrand = BRAND_PROFILE): string {
  const configuredBootstrapThemeId = brand.defaultThemeId as ThemeId;
  const bootstrapDefaultThemeId = THEME_BY_ID.has(configuredBootstrapThemeId)
    ? configuredBootstrapThemeId
    : DEFAULT_THEME_ID;
  const bootstrapData = {
    storeKey: APP_STORE_KEY,
    customThemeTokenKey: CUSTOM_THEME_TOKEN_KEY,
    defaultThemeId: bootstrapDefaultThemeId,
    defaultFontFamilyId: DEFAULT_FONT_FAMILY_ID,
    defaultFontSizeId: DEFAULT_FONT_SIZE_ID,
    defaultContrastMode: DEFAULT_CONTRAST_MODE,
    themeTokensById: THEME_TOKENS_BY_ID,
    themeTokenKeys: Object.keys(THEME_BY_ID.get(bootstrapDefaultThemeId)?.tokens ?? {}),
    themeUiTokensById: THEME_UI_TOKENS_BY_ID,
    fontFamilyCssById: FONT_FAMILY_CSS_BY_ID,
    fontSizeCssById: FONT_SIZE_CSS_BY_ID,
    applianceId: brand.applianceId,
    allowedThemeIds: brand.allowedThemeIds,
    fontFamily: brand.fontFamily,
    fontMonoFamily: brand.fontMonoFamily,
  };

  return `
    (function () {
      try {
        var data = ${JSON.stringify(bootstrapData)};
        var raw = localStorage.getItem(data.storeKey) || "{}";
        var parsed = {};
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = {};
        }
        var state = (parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object")
          ? parsed.state
          : parsed;

        if (!state || typeof state !== "object") {
          state = {};
        }

        document.documentElement.setAttribute("data-appliance", data.applianceId);
        var storedThemeId = typeof state.themeId === "string" ? state.themeId : data.defaultThemeId;
        var themeId =
          data.allowedThemeIds.length === 0 || data.allowedThemeIds.indexOf(storedThemeId) >= 0
            ? storedThemeId
            : data.defaultThemeId;
        var themeTokens = data.themeTokensById[themeId] || data.themeTokensById[data.defaultThemeId];
        var resolvedThemeId = data.themeTokensById[themeId] ? themeId : data.defaultThemeId;

        document.documentElement.setAttribute("data-theme", resolvedThemeId);

        if (themeTokens && typeof themeTokens === "object") {
          for (var tokenKey in themeTokens) {
            if (Object.prototype.hasOwnProperty.call(themeTokens, tokenKey)) {
              document.documentElement.style.setProperty("--" + tokenKey, themeTokens[tokenKey]);
            }
          }
        }

        var themeUiTokens = data.themeUiTokensById[resolvedThemeId] || {};
        for (var uiTokenKey in themeUiTokens) {
          if (Object.prototype.hasOwnProperty.call(themeUiTokens, uiTokenKey)) {
            document.documentElement.style.setProperty("--" + uiTokenKey, themeUiTokens[uiTokenKey]);
          }
        }

        var customRaw = localStorage.getItem(data.customThemeTokenKey);
        if (customRaw) {
          try {
            var custom = JSON.parse(customRaw);
            if (custom && custom.themeId === resolvedThemeId && custom.tokens && typeof custom.tokens === "object") {
              var customTokensValid = data.themeTokenKeys.every(
                (customTokenKey) => typeof custom.tokens[customTokenKey] === "string"
              );
              if (customTokensValid) {
                for (var customTokenKey of data.themeTokenKeys) {
                  document.documentElement.style.setProperty("--" + customTokenKey, custom.tokens[customTokenKey]);
                }
              }
            }
          } catch {}
        }

        var fontFamilyId = typeof state.fontFamilyId === "string" ? state.fontFamilyId : data.defaultFontFamilyId;
        var fontFamilyCss =
          data.applianceId === "local-studio"
            ? data.fontFamilyCssById[fontFamilyId] || data.fontFamilyCssById[data.defaultFontFamilyId]
            : data.fontFamily;
        if (fontFamilyCss) {
          document.documentElement.style.setProperty("--font-sans", fontFamilyCss);
        }
        document.documentElement.style.setProperty("--font-mono", data.fontMonoFamily);

        var fontSizeId = typeof state.fontSizeId === "string" ? state.fontSizeId : data.defaultFontSizeId;
        var fontSizeCss = data.fontSizeCssById[fontSizeId] || data.fontSizeCssById[data.defaultFontSizeId];
        if (fontSizeCss) {
          document.documentElement.style.setProperty("--app-font-size", fontSizeCss);
        }

        var contrastMode = typeof state.contrastMode === "string" ? state.contrastMode : data.defaultContrastMode;
        var prefersHighContrast = false;
        if (typeof window.matchMedia === "function") {
          prefersHighContrast =
            window.matchMedia("(forced-colors: active)").matches ||
            window.matchMedia("(prefers-contrast: more)").matches;
        }
        var resolvedContrastMode =
          contrastMode === "high" || (contrastMode === "auto" && prefersHighContrast)
            ? "high"
            : "standard";
        document.documentElement.setAttribute("data-contrast-preference", contrastMode);
        document.documentElement.setAttribute("data-contrast-mode", resolvedContrastMode);
      } catch (e) {
        // no-op
      }
    })();
  `;
}
