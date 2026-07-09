import { describe, expect, test } from "bun:test";

import { parseRecipe } from "./recipe-serializer";
import { asRecipeId } from "../types";

const minimalRecipe = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "my-recipe",
  name: "My Recipe",
  model_path: "/models/my-model",
  ...over,
});

describe("parseRecipe id validation", () => {
  test("accepts a non-empty id", () => {
    const recipe = parseRecipe(minimalRecipe());
    expect(recipe.id).toBe(asRecipeId("my-recipe"));
  });

  test("rejects an empty id (would create an unaddressable ghost recipe)", () => {
    expect(() => parseRecipe(minimalRecipe({ id: "" }))).toThrow();
  });
});

describe("parseRecipe runtime migration", () => {
  test("defaults vLLM recipes to the managed runtime", () => {
    expect(parseRecipe(minimalRecipe()).runtime).toEqual({ kind: "managed_venv", ref: "vllm" });
  });

  test("migrates a Docker image into the first-class runtime", () => {
    const recipe = parseRecipe(
      minimalRecipe({ extra_args: { docker_image: "vllm/vllm-openai:v0.8.5", foo: "bar" } }),
    );
    expect(recipe.runtime).toEqual({ kind: "docker", ref: "vllm/vllm-openai:v0.8.5" });
    expect(recipe.extra_args).toEqual({ foo: "bar" });
  });

  test("migrates an explicit Python path into a system runtime", () => {
    expect(parseRecipe(minimalRecipe({ python_path: "/opt/vllm/bin/python" })).runtime).toEqual({
      kind: "system",
      ref: "/opt/vllm/bin/python",
    });
  });

  test("normalizes the legacy venv runtime kind", () => {
    expect(
      parseRecipe(minimalRecipe({ runtime: { kind: "venv", ref: "vllm" } })).runtime,
    ).toEqual({ kind: "managed_venv", ref: "vllm" });
  });

  test("rejects a runtime without a reference", () => {
    expect(() => parseRecipe(minimalRecipe({ runtime: { kind: "docker", ref: "" } }))).toThrow();
  });
});
