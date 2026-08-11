import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveThemeCssTokens } from "@/lib/theme-runtime";
import { FONT_FAMILY_BY_ID, THEMES, THEME_BY_ID } from "@/lib/themes";

describe("theme catalogue", () => {
  test("keeps theme identifiers unique", () => {
    assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length);
  });

  test("matches the ChatGPT app dark palette and typography", () => {
    const theme = THEME_BY_ID.get("chatgpt-dark");
    assert.ok(theme);
    assert.equal(theme.fontFamilyId, "openai");
    assert.equal(theme.tokens.bg, "#191919");
    assert.equal(theme.tokens.fg, "#d9d9d8");
    assert.equal(theme.tokens.surface, "#202020");
    assert.equal(theme.ui?.rail, "#212121");
    assert.equal(theme.ui?.["surface-3"], "#282828");
    assert.equal(theme.ui?.composer, "#282828");
    assert.equal(theme.ui?.bubble, "#232323");

    const cssTokens = resolveThemeCssTokens(theme.tokens, theme.ui);
    assert.equal(cssTokens["agent-bg"], "#191919");
    assert.equal(cssTokens["sidebar-bg"], "#212121");
    assert.equal(cssTokens["color-input"], "#282828");
    assert.equal(cssTokens["color-foreground"], "#d9d9d8");
  });

  test("provides every theme font in the typography picker", () => {
    for (const theme of THEMES) assert.ok(FONT_FAMILY_BY_ID.has(theme.fontFamilyId));
  });
});
