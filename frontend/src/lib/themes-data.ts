// Codex-like theme catalogue.
//
// Six themes total: two canonical (Light / Dark) plus four dark accent
// variants (Sky, Violet, Emerald, Rose). The full surface system lives in
// `src/app/styles/globals/tokens.css` keyed on `data-theme`/`.theme-zai-*`
// selectors; the `ThemeTokens` here are the minimal set the runtime bootstrap
// (`theme-runtime.ts`) writes inline so the picker previews correctly. They
// resolve to the same Codex workbench values, so picking a theme never fights the token
// system.

export type ThemeId =
  | "zai-light"
  | "zai-dark"
  | "zai-sky"
  | "zai-violet"
  | "zai-emerald"
  | "zai-rose";

export interface ThemeTokens {
  bg: string;
  fg: string;
  dim: string;
  border: string;
  surface: string;
  accent: string;
  hl1: string;
  hl2: string;
  hl3: string;
  err: string;
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  group: string;
  swatches: [string, string, string, string];
  tokens: ThemeTokens;
}

const createTheme = (
  id: ThemeId,
  name: string,
  description: string,
  group: string,
  tokens: ThemeTokens,
): ThemeMeta => ({
  id,
  name,
  description,
  group,
  swatches: [tokens.bg, tokens.surface, tokens.accent, tokens.fg],
  tokens,
});

// Canonical Codex-like surfaces, expressed as concrete values (the bootstrap script
// writes them inline before paint). These mirror the `.theme-zai-*` blocks in
// tokens.css exactly.
const ZAI_LIGHT: ThemeTokens = {
  bg: "#f4f5f5",
  fg: "#202123",
  dim: "#20212399",
  border: "#0d0d0d1a",
  surface: "#fbfbfb",
  accent: "#000000",
  hl1: "#6b8db5",
  hl2: "#2f8f5f",
  hl3: "#c8792f",
  err: "#e03131",
};

const ZAI_DARK: ThemeTokens = {
  bg: "#0f0f0f",
  fg: "#e7e7e7",
  dim: "#e7e7e799",
  border: "#ffffff14",
  surface: "#202020",
  accent: "#ffffff",
  hl1: "#7ea1c8",
  hl2: "#4aa06f",
  hl3: "#d48a4c",
  err: "#ff5c5c",
};

// Accent variants keep the canonical dark surfaces; only the brand
// accent + hl1 (the data/links color) shift.
const skyAccent = (base: ThemeTokens): ThemeTokens => ({
  ...base,
  accent: "#4099ff",
  hl1: "#4099ff",
});

const violetAccent = (base: ThemeTokens): ThemeTokens => ({
  ...base,
  accent: "#7b5ce5",
  hl1: "#7b5ce5",
});

const emeraldAccent = (base: ThemeTokens): ThemeTokens => ({
  ...base,
  accent: "#46bf72",
  hl1: "#46bf72",
});

const roseAccent = (base: ThemeTokens): ThemeTokens => ({
  ...base,
  accent: "#ff5c5c",
  hl1: "#ff5c5c",
});

export const THEMES: ThemeMeta[] = [
  createTheme(
    "zai-dark",
    "Codex Dark",
    "Codex workbench — charcoal layers, quiet borders, muted data accents",
    "Codex",
    ZAI_DARK,
  ),
  createTheme(
    "zai-light",
    "Codex Light",
    "Codex light — paper canvas, black brand, muted data accents",
    "Codex",
    ZAI_LIGHT,
  ),
  createTheme(
    "zai-sky",
    "Sky",
    "Codex dark with a sky-blue brand accent",
    "Accents",
    skyAccent(ZAI_DARK),
  ),
  createTheme(
    "zai-violet",
    "Violet",
    "Codex dark with a violet brand accent",
    "Accents",
    violetAccent(ZAI_DARK),
  ),
  createTheme(
    "zai-emerald",
    "Emerald",
    "Codex dark with an emerald brand accent",
    "Accents",
    emeraldAccent(ZAI_DARK),
  ),
  createTheme(
    "zai-rose",
    "Rose",
    "Codex dark with a rose brand accent",
    "Accents",
    roseAccent(ZAI_DARK),
  ),
];
