import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RecipeWithStatus } from "@/lib/types";
import { isRecipeActive } from "./launch-reconciliation";

const recipe = (id: string, status: RecipeWithStatus["status"]): RecipeWithStatus =>
  ({ id, status }) as RecipeWithStatus;

describe("launch reconciliation", () => {
  test("accepts the requested recipe when the controller reports it active", () => {
    assert.equal(isRecipeActive([recipe("test", "starting")], "test"), true);
    assert.equal(isRecipeActive([recipe("test", "running")], "test"), true);
  });

  test("rejects stopped and unrelated recipes", () => {
    assert.equal(isRecipeActive([recipe("test", "stopped")], "test"), false);
    assert.equal(isRecipeActive([recipe("other", "running")], "test"), false);
  });
});
