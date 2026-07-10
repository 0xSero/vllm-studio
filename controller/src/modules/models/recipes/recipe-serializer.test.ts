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
    expect(parseRecipe(minimalRecipe({ runtime: { kind: "venv", ref: "vllm" } })).runtime).toEqual({
      kind: "managed_venv",
      ref: "vllm",
    });
  });

  test("rejects a runtime without a reference", () => {
    expect(() => parseRecipe(minimalRecipe({ runtime: { kind: "docker", ref: "" } }))).toThrow();
  });
});

describe("parseRecipe vision capability", () => {
  test("defaults the first-class override to automatic detection", () => {
    expect(parseRecipe(minimalRecipe()).vision).toBeNull();
  });

  test("preserves explicit true and false overrides outside engine arguments", () => {
    const enabled = parseRecipe(minimalRecipe({ vision: true }));
    const disabled = parseRecipe(minimalRecipe({ vision: false }));
    expect(enabled.vision).toBe(true);
    expect(disabled.vision).toBe(false);
    expect(enabled.extra_args).not.toHaveProperty("vision");
    expect(disabled.extra_args).not.toHaveProperty("vision");
  });

  test("migrates the legacy engine argument without overriding a first-class value", () => {
    const migrated = parseRecipe(minimalRecipe({ extra_args: { vision: true } }));
    const overridden = parseRecipe(
      minimalRecipe({ vision: false, extra_args: { vision: true, seed: 7 } }),
    );
    expect(migrated.vision).toBe(true);
    expect(migrated.extra_args).toEqual({});
    expect(overridden.vision).toBe(false);
    expect(overridden.extra_args).toEqual({ seed: 7 });
  });

  test("rejects non-boolean overrides", () => {
    expect(() => parseRecipe(minimalRecipe({ vision: "true" }))).toThrow();
  });
});

describe("parseRecipe runtime state", () => {
  test("drops read-only status fields instead of converting them to engine arguments", () => {
    const recipe = parseRecipe(
      minimalRecipe({
        status: "error",
        crash_loop: { blocked: true, failure_count: 3 },
        extra_args: { status: "stopped", crash_loop: { blocked: false } },
      }),
    );

    expect(recipe.extra_args).not.toHaveProperty("status");
    expect(recipe.extra_args).not.toHaveProperty("crash_loop");
  });
});
