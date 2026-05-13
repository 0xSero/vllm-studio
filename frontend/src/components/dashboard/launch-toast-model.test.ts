import { describe, expect, it } from "vitest";
import { resolveLaunchToastView } from "./launch-toast-model";

describe("launch toast model", () => {
  it("hides when launch progress is absent or stale in-flight progress is no longer launching", () => {
    expect(resolveLaunchToastView(false, null).visible).toBe(false);
    expect(resolveLaunchToastView(false, { stage: "waiting", message: "waiting" }).visible).toBe(
      false,
    );
  });

  it("shows active launches with default copy and progress", () => {
    expect(resolveLaunchToastView(true, { stage: "launching", progress: 0.421 })).toEqual({
      message: "Preparing model launch...",
      progressPercent: 42,
      stageTone: "default",
      stageText: "launching",
      visible: true,
    });
  });

  it("renders terminal tones and suppresses progress for final states", () => {
    expect(
      resolveLaunchToastView(false, { stage: "ready", message: "ready", progress: 1 }),
    ).toMatchObject({
      progressPercent: null,
      stageTone: "ready",
      visible: true,
    });
    expect(
      resolveLaunchToastView(false, { stage: "error", message: "failed", progress: 0.5 }),
    ).toMatchObject({
      progressPercent: null,
      stageTone: "error",
      visible: true,
    });
  });
});
