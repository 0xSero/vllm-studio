// CRITICAL
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

const STORE_KEY = "vllm-studio-state";
const DEFAULT_THEME_ID: ThemeId = "omlx-dark";

const THEME_TOKENS_BY_ID = Object.fromEntries(
  Array.from(THEME_BY_ID.entries()).map(([id, theme]) => [id, theme.tokens]),
) as Record<string, ThemeTokens>;

const FONT_FAMILY_CSS_BY_ID = Object.fromEntries(
  Array.from(FONT_FAMILY_BY_ID.entries()).map(([id, option]) => [id, option.cssValue]),
) as Record<string, string>;

const FONT_SIZE_CSS_BY_ID = Object.fromEntries(
  Array.from(FONT_SIZE_BY_ID.entries()).map(([id, option]) => [id, option.cssValue]),
) as Record<string, string>;

function setThemeTokens(tokens: ThemeTokens): void {
  if (typeof document === "undefined") return;
  for (const [key, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(`--${key}`, value);
  }
}

export function applyThemeToDocument(themeId: ThemeId): ThemeId {
  if (typeof document === "undefined") return themeId;

  const nextTheme = THEME_BY_ID.get(themeId) ?? THEME_BY_ID.get(DEFAULT_THEME_ID);
  if (!nextTheme) return themeId;

  document.documentElement.setAttribute("data-theme", nextTheme.id);
  setThemeTokens(nextTheme.tokens);
  return nextTheme.id;
}

export function applyFontFamilyToDocument(fontFamilyId: FontFamilyId): FontFamilyId {
  if (typeof document === "undefined") return fontFamilyId;

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

export function getThemeBootstrapScript(): string {
  const bootstrapData = {
    storeKey: STORE_KEY,
    defaultThemeId: DEFAULT_THEME_ID,
    defaultFontFamilyId: DEFAULT_FONT_FAMILY_ID,
    defaultFontSizeId: DEFAULT_FONT_SIZE_ID,
    themeTokensById: THEME_TOKENS_BY_ID,
    fontFamilyCssById: FONT_FAMILY_CSS_BY_ID,
    fontSizeCssById: FONT_SIZE_CSS_BY_ID,
  };

  return `
    (function () {
      try {
        var data = ${JSON.stringify(bootstrapData)};
        var raw = localStorage.getItem(data.storeKey) || "{}";
        var parsed = JSON.parse(raw);
        var state = (parsed && typeof parsed === "object" && parsed.state && typeof parsed.state === "object")
          ? parsed.state
          : parsed;

        if (!state || typeof state !== "object") {
          state = {};
        }

        var themeId = typeof state.themeId === "string" ? state.themeId : data.defaultThemeId;
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

        var fontFamilyId = typeof state.fontFamilyId === "string" ? state.fontFamilyId : data.defaultFontFamilyId;
        var fontFamilyCss = data.fontFamilyCssById[fontFamilyId] || data.fontFamilyCssById[data.defaultFontFamilyId];
        if (fontFamilyCss) {
          document.documentElement.style.setProperty("--font-sans", fontFamilyCss);
        }

        var fontSizeId = typeof state.fontSizeId === "string" ? state.fontSizeId : data.defaultFontSizeId;
        var fontSizeCss = data.fontSizeCssById[fontSizeId] || data.fontSizeCssById[data.defaultFontSizeId];
        if (fontSizeCss) {
          document.documentElement.style.setProperty("--app-font-size", fontSizeCss);
        }
      } catch (e) {
        // no-op
      }
    })();
  `;
}
