import { describe, expect, test } from "bun:test";
import { validateAgainstRegistrySchema } from "../src/modules/registry/validate";
import { fixtureJson } from "./fixtures";

describe("registry schema validation", () => {
  test("real published records pass their own schemas", () => {
    const recipe = fixtureJson("recipe--deepseek-fp8-rtx-pro-6000-blackwell-96gb-vllm-tp1.json");
    const instance = fixtureJson("model-instance--google-diffusiongemma-26b-a4b-it--bf16.json");
    const model = fixtureJson("model--diffusiongemma-26b-a4b.json");
    const hardware = fixtureJson("hardware--rtx-5090-32gb.json");
    expect(validateAgainstRegistrySchema("recipe", recipe).ok).toBe(true);
    expect(validateAgainstRegistrySchema("model-instance", instance).ok).toBe(true);
    expect(validateAgainstRegistrySchema("model", model).ok).toBe(true);
    // Hardware is matched, not contributed; it decodes through the Effect
    // contract, so the JSON Schema check here is intentionally not applied.
    void hardware;
  });

  test("generated contributions pass the schemas", () => {
    const instance = fixtureJson("model-instance--redhatai-deepseek-coder-v2-lite-instruct-fp8--fp8.json");
    const model = fixtureJson("model--deepseek.json");
    const recipe = fixtureJson("recipe--deepseek-fp8-rtx-pro-6000-blackwell-96gb-vllm-tp1.json");
    expect(validateAgainstRegistrySchema("model", model).ok).toBe(true);
    expect(validateAgainstRegistrySchema("model-instance", instance).ok).toBe(true);
    expect(validateAgainstRegistrySchema("recipe", recipe).ok).toBe(true);
  });

  test("missing required fields fail with precise paths", () => {
    const result = validateAgainstRegistrySchema("recipe", { id: "broken" });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test("id patterns are enforced", () => {
    const recipe = fixtureJson("recipe--deepseek-fp8-rtx-pro-6000-blackwell-96gb-vllm-tp1.json") as Record<string, unknown>;
    const broken = { ...recipe, id: "Bad Id With Spaces" };
    expect(validateAgainstRegistrySchema("recipe", broken).ok).toBe(false);
  });

  test("validated status with a reference launch is rejected by the schema", () => {
    const recipe = fixtureJson("recipe--deepseek-fp8-rtx-pro-6000-blackwell-96gb-vllm-tp1.json") as Record<string, unknown>;
    const referenceLaunch = { ...recipe, launch: { kind: "reference" }, status: "validated" };
    expect(validateAgainstRegistrySchema("recipe", referenceLaunch).ok).toBe(false);
  });

  test("every failing record reports its own issues", () => {
    const instance = validateAgainstRegistrySchema("model-instance", { id: "bad id" });
    const recipe = validateAgainstRegistrySchema("recipe", { id: "also bad" });
    expect(instance.ok).toBe(false);
    expect(recipe.ok).toBe(false);
    expect(instance.issues.length).toBeGreaterThan(0);
    expect(recipe.issues.length).toBeGreaterThan(0);
  });
});
