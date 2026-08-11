export type ThemeId =
  | "zai-light"
  | "zai-dark"
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
  | "paper";

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

const studioLight: ThemeTokens = {
  bg: "#ffffff",
  fg: "#1a1c1f",
  dim: "#5f6165",
  border: "#1a1c1f14",
  surface: "#ffffff",
  accent: "#0d0d0d",
  hl1: "#5f6165",
  hl2: "#8c8e91",
  hl3: "#8f8f8f",
  err: "#e02e2a",
};

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

type ThemeDefinition = readonly [ThemeId, string, string, string, ThemeTokens];

const studioDark = palette("dark", "#181818", "#ffffff", "#212121", "#ffffff");
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
    "paper",
    "Paper",
    "Warm paper white with a burnt-sienna accent",
    "Studio",
    palette("light", "#faf8f2", "#2a2723", "#ffffff", "#b05f2d"),
  ],
] satisfies ThemeDefinition[];

export const THEMES: ThemeMeta[] = definitions.map(([id, name, description, group, tokens]) => ({
  id,
  name,
  description,
  group,
  swatches: [tokens.bg, tokens.surface, tokens.accent, tokens.fg],
  tokens,
}));
