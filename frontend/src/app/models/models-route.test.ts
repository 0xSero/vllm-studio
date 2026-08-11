import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const route = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../../../next.config.ts", import.meta.url), "utf8");

describe("models route", () => {
  test("renders the model library as a first-class page", () => {
    assert.match(route, /<RecipesContent \/>/);
    assert.doesNotMatch(nextConfig, /source:\s*["']\/models["']/);
  });
});
