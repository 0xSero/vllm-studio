import { describe, expect, test } from "bun:test";
import { STUDIO_STARTER_PRESETS } from "./configs";
import { parseRecipe } from "../models/recipes/recipe-serializer";

describe("starter presets", () => {
  test("exactly three presets with unique ids", () => {
    expect(STUDIO_STARTER_PRESETS.length).toBe(3);
    const ids = new Set(STUDIO_STARTER_PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(3);
  });

  test("download presets carry a model_id and a supported backend", () => {
    for (const preset of STUDIO_STARTER_PRESETS.filter((p) => p.kind === "download")) {
      expect(preset.model_id).toBeTruthy();
      expect(["vllm", "llamacpp"]).toContain(preset.backend ?? "");
    }
  });

  test("llamacpp presets pin a gguf file consistent with allow_patterns", () => {
    for (const preset of STUDIO_STARTER_PRESETS.filter((p) => p.backend === "llamacpp")) {
      expect(preset.gguf_file).toBeTruthy();
      expect(preset.allow_patterns?.length).toBeGreaterThan(0);
      const suffix = (preset.allow_patterns ?? [])[0]?.replace(/^\*/, "") ?? "";
      expect(preset.gguf_file?.endsWith(suffix)).toBe(true);
    }
  });

  test("remote presets carry a base_url and model", () => {
    for (const preset of STUDIO_STARTER_PRESETS.filter((p) => p.kind === "remote")) {
      expect(preset.remote?.base_url).toMatch(/^https:\/\//);
      expect(preset.remote?.model).toBeTruthy();
    }
  });

  test("download preset recipe_overrides survive parseRecipe", () => {
    for (const preset of STUDIO_STARTER_PRESETS.filter((p) => p.kind === "download")) {
      const recipe = parseRecipe({
        id: preset.id,
        name: preset.name,
        model_path: "/models/example",
        backend: preset.backend,
        ...(preset.recipe_overrides ?? {}),
      });
      expect(String(recipe.id)).toBe(preset.id);
      expect(recipe.backend).toBe(preset.backend ?? "vllm");
    }
  });
});
