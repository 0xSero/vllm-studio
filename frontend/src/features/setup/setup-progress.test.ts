import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { decodeSetupProgress } from "./setup-progress";

const setupHook = readFileSync(new URL("./use-setup.ts", import.meta.url), "utf8");

describe("setup progress", () => {
  test("restores valid progress and clamps the step", () => {
    const progress = decodeSetupProgress({
      step: 99,
      hardwareConfirmed: true,
      selectedModel: "org/model",
      manualModelId: "org/manual",
      selectedPreset: null,
      createdRecipeId: "recipe-1",
    });
    assert.equal(progress.step, 5);
    assert.equal(progress.hardwareConfirmed, true);
    assert.equal(progress.selectedModel, "org/model");
  });

  test("falls back safely for malformed persisted data", () => {
    assert.deepEqual(decodeSetupProgress({ step: "three" }), {
      step: 0,
      hardwareConfirmed: false,
      selectedModel: "",
      manualModelId: "",
      selectedPreset: null,
      createdRecipeId: null,
    });
  });

  test("restores browser persistence only after hydration", () => {
    assert.doesNotMatch(setupHook, /useState\(loadSetupProgress\)/);
    assert.match(
      setupHook,
      /useMountSubscription\(\(\) => \{\s+const progress = loadSetupProgress\(\)/,
    );
    assert.match(setupHook, /const \[step, setStepState\] = useState\(0\)/);
  });
});
