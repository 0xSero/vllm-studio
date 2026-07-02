import { describe, expect, test } from "bun:test";

import { isRecipeRunning } from "./recipe-matching";
import type { ProcessInfo, Recipe } from "../types";

const recipe = (over: Partial<Recipe>): Recipe => ({ model_path: "", ...over }) as Recipe;
const proc = (over: Partial<ProcessInfo>): ProcessInfo => ({ ...over }) as ProcessInfo;

describe("isRecipeRunning", () => {
  test("matches on served_model_name case-insensitively", () => {
    expect(
      isRecipeRunning(
        recipe({ served_model_name: "Deepseek-V4", model_path: "/models/a" }),
        proc({ served_model_name: "deepseek-v4", model_path: "/models/b" }),
      ),
    ).toBe(true);
  });

  test("matches an exact normalized path (trailing slash ignored)", () => {
    expect(
      isRecipeRunning(
        recipe({ model_path: "/models/org/Llama-3/" }),
        proc({ model_path: "/models/org/Llama-3" }),
      ),
    ).toBe(true);
  });

  test("does NOT match two full paths that only share a basename", () => {
    // The core bug: distinct models under different parents sharing a filename.
    expect(
      isRecipeRunning(
        recipe({ model_path: "/models/orgA/Llama-3" }),
        proc({ model_path: "/models/orgB/Llama-3" }),
      ),
    ).toBe(false);
    expect(
      isRecipeRunning(
        recipe({ model_path: "/a/model.gguf" }),
        proc({ model_path: "/b/model.gguf" }),
      ),
    ).toBe(false);
  });

  test("still matches when one side lacks directory context (basename only)", () => {
    expect(
      isRecipeRunning(recipe({ model_path: "/models/org/model.gguf" }), proc({ model_path: "model.gguf" })),
    ).toBe(true);
  });

  test("path-prefix containment respects segment boundaries", () => {
    // /models/llama must NOT match /models/llama-3.1-8b (different model).
    expect(
      isRecipeRunning(
        recipe({ model_path: "/models/llama" }),
        proc({ model_path: "/models/llama-3.1-8b" }),
        { allowEitherPathContains: true },
      ),
    ).toBe(false);
    // A genuine parent/child directory relationship DOES match.
    expect(
      isRecipeRunning(
        recipe({ model_path: "/models/llama" }),
        proc({ model_path: "/models/llama/snapshot" }),
        { allowEitherPathContains: true },
      ),
    ).toBe(true);
  });

  test("allowCurrentContainsRecipePath matches only a true subpath", () => {
    expect(
      isRecipeRunning(
        recipe({ model_path: "/models/x" }),
        proc({ model_path: "/models/x/weights" }),
        { allowCurrentContainsRecipePath: true },
      ),
    ).toBe(true);
    expect(
      isRecipeRunning(
        recipe({ model_path: "/models/x" }),
        proc({ model_path: "/models/x-large" }),
        { allowCurrentContainsRecipePath: true },
      ),
    ).toBe(false);
  });
});
