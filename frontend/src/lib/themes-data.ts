export type ThemeId =
  | "zai-light"
  | "zai-dark"
  | "chatgpt-dark"
  | "zai-sky"
  | "zai-violet"
  | "zai-emerald"
  | "zai-rose"
  | "absolutely-dark"
  | "raycast-dark"
  | "midnight"
  | "slate"
  | "graphite"
  | "espresso"
  | "forest"
  | "nordic-light"
  | "solarized-dark"
  | "paper";

export type FontFamilyId = "openai" | "geist" | "system" | "avenir" | "serif" | "mono" | "rounded";

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

export interface ThemeUiTokens {
  "surface-2": string;
  "surface-3": string;
  rail: string;
  border: string;
  separator: string;
  hover: string;
  active: string;
  composer: string;
  "composer-footer": string;
  bubble: string;
}

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  group: string;
  swatches: [string, string, string, string];
  tokens: ThemeTokens;
  fontFamilyId: FontFamilyId;
  ui?: Partial<ThemeUiTokens>;
}

const palette = (
  mode: "dark" | "light",
  bg: string,
  fg: string,
  surface: string,
  accent: string,
): ThemeTokens => ({
  bg,
  fg,
  dim: `${fg}b3`,
  border: `${fg}${mode === "dark" ? "14" : "1f"}`,
  surface,
  accent,
  hl1: `${fg}b3`,
  hl2: `${fg}80`,
  hl3: "#8f8f8f",
  err: mode === "dark" ? "#ff6764" : "#e02e2a",
});

const studioLight: ThemeTokens = {
  ...palette("light", "#ffffff", "#1a1c1f", "#ffffff", "#0d0d0d"),
  dim: "#5f6165",
  border: "#1a1c1f14",
  hl1: "#5f6165",
  hl2: "#8c8e91",
};
const studioDark = palette("dark", "#181818", "#ffffff", "#212121", "#ffffff");
const chatGptDark: ThemeTokens = {
  bg: "#191919",
  fg: "#d9d9d8",
  dim: "#a0a09f",
  border: "#ffffff0d",
  surface: "#202020",
  accent: "#d9d9d8",
  hl1: "#a0a09f",
  hl2: "#7b7b7b",
  hl3: "#626262",
  err: "#ff6764",
};
const chatGptDarkUi: Partial<ThemeUiTokens> = {
  "surface-2": "#202020",
  "surface-3": "#282828",
  rail: "#212121",
  border: "#ffffff0d",
  separator: "#ffffff08",
  hover: "#282828",
  active: "#2e2e2e",
  composer: "#282828",
  "composer-footer": "#282828",
  bubble: "#232323",
};

type ThemeDefinition = readonly [
  ThemeId,
  string,
  string,
  string,
  ThemeTokens,
  Partial<ThemeUiTokens>?,
];

const accentTheme = (
  id: ThemeId,
  name: string,
  adjective: string,
  accent: string,
): ThemeDefinition => [
  id,
  name,
  `Dark with ${adjective} brand accent`,
  "Accents",
  { ...studioDark, accent },
];

const definitions = [
  [
    "zai-dark",
    "Studio Dark",
    "Unified charcoal canvas, hairline borders, one blue accent",
    "Studio",
    studioDark,
  ],
  [
    "zai-light",
    "Studio Light",
    "Pure white canvas, near-black brand, one blue accent",
    "Studio",
    studioLight,
  ],
  [
    "chatgpt-dark",
    "ChatGPT Dark",
    "ChatGPT app charcoal surfaces paired with OpenAI Sans",
    "Reference",
    chatGptDark,
    chatGptDarkUi,
  ],
  accentTheme("zai-sky", "Sky", "a sky-blue", "#339cff"),
  accentTheme("zai-violet", "Violet", "a violet", "#ad7bf9"),
  accentTheme("zai-emerald", "Emerald", "an emerald", "#40c977"),
  accentTheme("zai-rose", "Rose", "a rose", "#ff6764"),
  [
    "absolutely-dark",
    "Absolutely Dark",
    "Warm charcoal with a terracotta accent, ported from Codex",
    "Ported",
    palette("dark", "#2d2d2b", "#f9f9f7", "#373735", "#cc7d5e"),
  ],
  [
    "raycast-dark",
    "Raycast Dark",
    "Near-black launcher tones with an electric blue accent",
    "Ported",
    palette("dark", "#141414", "#ffffff", "#1e1e1e", "#4fa3f8"),
  ],
  [
    "midnight",
    "Midnight",
    "Blue-black canvas with a soft azure accent",
    "Atmosphere",
    palette("dark", "#0d1117", "#e6edf3", "#161b22", "#58a6ff"),
  ],
  [
    "slate",
    "Slate",
    "Cool graphite blues with a periwinkle accent",
    "Atmosphere",
    palette("dark", "#12151a", "#e2e8f0", "#1a1f27", "#7aa2f7"),
  ],
  [
    "graphite",
    "Graphite",
    "Ultra-dark neutral with a pure white accent",
    "Atmosphere",
    palette("dark", "#0d0d0d", "#ededed", "#171717", "#ffffff"),
  ],
  [
    "espresso",
    "Espresso",
    "Roasted browns with a caramel accent",
    "Atmosphere",
    palette("dark", "#1a1512", "#f2e9df", "#241d18", "#d9954a"),
  ],
  [
    "forest",
    "Forest",
    "Deep evergreen with a spring-green accent",
    "Atmosphere",
    palette("dark", "#0f1512", "#e8f2ec", "#18211b", "#4fd08a"),
  ],
  [
    "nordic-light",
    "Nordic Light",
    "Cool daylight neutrals with crisp indigo controls",
    "Studio",
    palette("light", "#f4f6f8", "#20242a", "#ffffff", "#5e6ad2"),
  ],
  [
    "solarized-dark",
    "Solarized Dark",
    "Low-contrast blue-green surfaces with a cyan accent",
    "Reference",
    palette("dark", "#002b36", "#eee8d5", "#073642", "#2aa198"),
  ],
  [
    "paper",
    "Paper",
    "Warm paper white with a burnt-sienna accent",
    "Studio",
    palette("light", "#faf8f2", "#2a2723", "#ffffff", "#b05f2d"),
  ],
] satisfies ThemeDefinition[];

const fontFamilyByTheme: Partial<Record<ThemeId, FontFamilyId>> = {
  "chatgpt-dark": "openai",
  "absolutely-dark": "system",
  "raycast-dark": "system",
  midnight: "avenir",
  slate: "system",
  espresso: "serif",
  forest: "rounded",
  "nordic-light": "avenir",
  "solarized-dark": "system",
  paper: "serif",
};

export const THEMES: ThemeMeta[] = definitions.map(
  ([id, name, description, group, tokens, ui]) => ({
    id,
    name,
    description,
    group,
    swatches: [tokens.bg, tokens.surface, tokens.accent, tokens.fg],
    tokens,
    fontFamilyId: fontFamilyByTheme[id] ?? "geist",
    ...(ui ? { ui } : {}),
  }),
);
