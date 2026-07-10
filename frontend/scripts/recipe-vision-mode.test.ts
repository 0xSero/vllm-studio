import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRecipeForEditor } from "../src/features/recipes/normalize-recipe";
import { prepareRecipeForSave } from "../src/features/recipes/prepare-recipe";
import {
  visionForMode,
  visionModeForRecipe,
  visionModeLabel,
  visionModeOverrideLabel,
} from "../src/features/recipes/recipe-vision";
import type { RecipeEditor } from "../src/features/recipes/recipe-editor";
import { DEFAULT_RECIPE } from "../src/features/recipes/recipes-content/default-recipe";

test("vision modes map to the recipe tri-state", () => {
  assert.equal(visionForMode("auto"), null);
  assert.equal(visionForMode("enabled"), true);
  assert.equal(visionForMode("text"), false);
  assert.equal(visionModeForRecipe({ vision: null }), "auto");
  assert.equal(visionModeForRecipe({ vision: true }), "enabled");
  assert.equal(visionModeForRecipe({ vision: false }), "text");
});

test("vision labels distinguish automatic and explicit modes", () => {
  assert.equal(visionModeLabel({ vision: null }), "image auto");
  assert.equal(visionModeLabel({ vision: true }), "images enabled");
  assert.equal(visionModeLabel({ vision: false }), "text only");
  assert.equal(visionModeOverrideLabel({ vision: null }), null);
  assert.equal(visionModeOverrideLabel({ vision: true }), "images enabled");
});

test("new and saved recipes preserve automatic vision detection", () => {
  const normalized = normalizeRecipeForEditor({ ...DEFAULT_RECIPE });
  assert.equal(normalized.vision, null);
  const saved = prepareRecipeForSave(normalized);
  assert.ok("vision" in saved);
  assert.equal(saved.vision, null);
});

test("saved recipes preserve explicit vision overrides", () => {
  for (const vision of [true, false] as const) {
    const source: RecipeEditor = { ...DEFAULT_RECIPE, vision };
    const normalized = normalizeRecipeForEditor(source);
    assert.equal(normalized.vision, vision);
    const saved = prepareRecipeForSave(normalized);
    assert.ok("vision" in saved);
    assert.equal(saved.vision, vision);
  }
});
