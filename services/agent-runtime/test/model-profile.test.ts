import { describe, expect, test } from "bun:test";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import {
  GENERIC_PROFILE,
  MODEL_PROFILES,
  QWEN38_RVN_PROFILE,
  resolveModelProfile,
} from "../src/harness/model-profile";

const THINKING_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

describe("model profiles", () => {
  test("the effort map never yields high", () => {
    for (const profile of MODEL_PROFILES) {
      expect(profile.reasoning.levels).not.toContain("high");
      for (const level of THINKING_LEVELS) {
        expect(profile.reasoning.fromThinkingLevel(level)).not.toBe("high");
      }
    }
    expect(QWEN38_RVN_PROFILE.reasoning.fromThinkingLevel("high")).toBe("medium");
    expect(QWEN38_RVN_PROFILE.reasoning.fromThinkingLevel("max")).toBe("xhigh");
  });

  test("the served Qwen3.8 RVN id resolves to its profile, anything else to the fallback", () => {
    expect(resolveModelProfile("spark-qwen38-27b-rvn-q8")).toBe(QWEN38_RVN_PROFILE);
    expect(resolveModelProfile("llama-3.3-70b")).toBe(GENERIC_PROFILE);
  });
});
