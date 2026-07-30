import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isLightThemeId, resolveThemeModeIds } from "@/lib/theme-runtime";
import {
  appearanceThemeSelection,
  availableAppearanceThemes,
  availableThemeModes,
  selectedThemeMode,
} from "./appearance-settings";
import { settingsSectionFromHash } from "./settings-view";
import { THEMES, THEME_BY_ID } from "@/lib/themes";

describe("theme runtime", () => {
  test("uses the Studio light and dark pair when themes are unrestricted", () => {
    assert.deepEqual(resolveThemeModeIds([]), {
      light: "zai-light",
      dark: "zai-dark",
    });
  });

  test("uses the cortAIx light and dark pair for the cortAIx appliance", () => {
    assert.deepEqual(resolveThemeModeIds(["cortaix-light", "cortaix-dark"]), {
      light: "cortaix-light",
      dark: "cortaix-dark",
    });
  });

  test("classifies both appliance light themes by their actual tokens", () => {
    assert.equal(isLightThemeId("zai-light"), true);
    assert.equal(isLightThemeId("cortaix-light"), true);
    assert.equal(isLightThemeId("zai-dark"), false);
    assert.equal(isLightThemeId("cortaix-dark"), false);
  });

  test("presents an explicit light and dark pair for the cortAIx appliance", () => {
    assert.deepEqual(availableThemeModes(["cortaix-light", "cortaix-dark"]), ["light", "dark"]);
    assert.deepEqual(availableThemeModes([]), ["light", "dark", "system"]);
    assert.equal(selectedThemeMode("cortaix-light"), "light");
    assert.equal(selectedThemeMode("cortaix-dark"), "dark");
  });

  test("restricts the appliance gallery to its admitted theme pair", () => {
    assert.deepEqual(
      availableAppearanceThemes(THEMES, ["cortaix-light", "cortaix-dark"]).map((theme) => theme.id),
      ["cortaix-dark", "cortaix-light"],
    );
    assert.equal(availableAppearanceThemes(THEMES, []).length, THEMES.length);
  });

  test("resets custom state even when the selected theme id does not change", () => {
    const selection = appearanceThemeSelection("cortaix-light");
    assert.equal(selection?.themeId, "cortaix-light");
    assert.equal(selection?.isCustomActive, false);
    assert.equal(selection?.tokens, THEME_BY_ID.get("cortaix-light")?.tokens);
    assert.equal(appearanceThemeSelection("missing-theme" as never), null);
  });

  test("routes appearance and legacy settings hashes deterministically", () => {
    assert.equal(settingsSectionFromHash("#appearance"), "appearance");
    assert.equal(settingsSectionFromHash("desktop"), "terminal");
    assert.equal(settingsSectionFromHash("#services"), "system");
    assert.equal(settingsSectionFromHash("#unknown"), null);
  });
});
