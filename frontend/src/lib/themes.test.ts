import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FONT_FAMILY_BY_ID, THEMES, THEME_BY_ID } from "./themes";

describe("theme catalogue", () => {
  test("keeps theme identifiers unique", () => {
    assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length);
  });

  test("matches the ChatGPT app dark palette and typography", () => {
    const theme = THEME_BY_ID.get("chatgpt-dark");
    assert.ok(theme);
    assert.equal(theme.fontFamilyId, "openai");
    assert.equal(theme.tokens.bg, "#212121");
    assert.equal(theme.tokens.fg, "#ececec");
    assert.equal(theme.tokens.surface, "#2f2f2f");
    assert.equal(theme.ui?.rail, "#171717");
    assert.equal(theme.ui?.["surface-3"], "#303030");
    assert.equal(theme.ui?.composer, "#303030");
  });

  test("provides every theme font in the typography picker", () => {
    for (const theme of THEMES) assert.ok(FONT_FAMILY_BY_ID.has(theme.fontFamilyId));
  });
});
