import { describe, expect, test } from "bun:test";
import { inferModelVision, resolveModelVision } from "@local-studio/contracts/model-capabilities";

describe("resolveModelVision", () => {
  test("gives the recipe override priority over metadata and identifiers", () => {
    expect(
      resolveModelVision({
        identifiers: ["owner/qwen3-vl"],
        recipeOverride: false,
        metadata: { vision: true, modalities: ["image"] },
      }),
    ).toBe(false);
  });

  test("uses legacy explicit metadata before modalities and identifiers", () => {
    expect(
      resolveModelVision({
        identifiers: ["owner/qwen3-vl"],
        metadata: { supports_vision: "false", modalities: ["image"] },
      }),
    ).toBe(false);
  });

  test("recognizes legacy image modalities", () => {
    expect(
      resolveModelVision({
        identifiers: ["owner/text-model"],
        modalities: ["text", "image"],
      }),
    ).toBe(true);
  });

  test("falls back to identifiers when explicit signals are absent", () => {
    expect(inferModelVision(["owner/llava-next"])).toBe(true);
    expect(resolveModelVision({ identifiers: ["owner/text-model"] })).toBe(false);
  });
});
