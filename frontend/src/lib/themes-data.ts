// ZCode-clone theme catalogue.
//
// Six themes total: two canonical (ZAI Light / ZAI Dark) plus four dark accent
// variants (Sky, Violet, Emerald, Rose). The full surface system lives in
// `src/app/styles/globals/tokens.css` keyed on `data-theme`/`.theme-zai-*`
// selectors; the `ThemeTokens` here are the minimal set the runtime bootstrap
// (`theme-runtime.ts`) writes inline so the picker previews correctly. They
// resolve to the same ZCode values, so picking a theme never fights the token
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

// Canonical ZCode surfaces, expressed as concrete values (the bootstrap script
// writes them inline before paint). These mirror the `.theme-zai-*` blocks in
// tokens.css exactly.
const ZAI_LIGHT: ThemeTokens = {
  bg: "#f8f8f8",
  fg: "#262626",
  dim: "#26262699",
  border: "#0d0d0d1a",
  surface: "#ffffff",
  accent: "#000000",
  hl1: "#0b7fff",
  hl2: "#1e8a3e",
  hl3: "#e07b00",
  err: "#e03131",
};

const ZAI_DARK: ThemeTokens = {
  bg: "#161616",
  fg: "#d4d4d4",
  dim: "#d4d4d499",
  border: "#ffffff1a",
  surface: "#2b2b2b",
  accent: "#ffffff",
  hl1: "#4099ff",
  hl2: "#46bf72",
  hl3: "#ff8a30",
  err: "#ff5c5c",
};

// Accent variants keep the canonical ZCode dark surfaces; only the brand
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
    "ZAI Dark",
    "ZCode default — neutral canvas, white brand, sky data accents",
    "ZCode",
    ZAI_DARK,
  ),
  createTheme(
    "zai-light",
    "ZAI Light",
    "ZCode light — paper canvas, black brand, sky data accents",
    "ZCode",
    ZAI_LIGHT,
  ),
  createTheme(
    "zai-sky",
    "Sky",
    "ZCode dark with a sky-blue brand accent",
    "Accents",
    skyAccent(ZAI_DARK),
  ),
  createTheme(
    "zai-violet",
    "Violet",
    "ZCode dark with a violet brand accent",
    "Accents",
    violetAccent(ZAI_DARK),
  ),
  createTheme(
    "zai-emerald",
    "Emerald",
    "ZCode dark with an emerald brand accent",
    "Accents",
    emeraldAccent(ZAI_DARK),
  ),
  createTheme(
    "zai-rose",
    "Rose",
    "ZCode dark with a rose brand accent",
    "Accents",
    roseAccent(ZAI_DARK),
  ),
];
