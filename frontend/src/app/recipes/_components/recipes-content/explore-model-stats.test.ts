import { describe, expect, it } from "vitest";
import type { HuggingFaceModel, ModelRecommendation } from "@/lib/types";
import {
  estimateRoughWeightsGb,
  modelRecencyMs,
  parseParamsBillions,
  quantFromTags,
  recommendedNeedGb,
  resolveGroupNeedGb,
} from "./explore-model-stats";

function model(modelId: string, tags: string[] = []): HuggingFaceModel {
  return {
    _id: modelId,
    modelId,
    downloads: 0,
    likes: 0,
    tags,
    author: modelId.split("/")[0] ?? "",
    private: false,
    pipeline_tag: "text-generation",
    library_name: "transformers",
    lastModified: "",
    createdAt: "",
  };
}

describe("explore model stats", () => {
  it("normalizes known quantization tags through a table", () => {
    expect(quantFromTags(["GGUF", "q4-k-m"])).toBe("q4_k_m");
    expect(quantFromTags(["gptq", "w4a16"])).toBe("int4");
    expect(quantFromTags(["fp8"])).toBe("fp8");
    expect(quantFromTags(["unknown"])).toBe("bf16");
  });

  it("parses parameter counts from model ids", () => {
    expect(parseParamsBillions("Qwen/Qwen3.6-27B")).toBe(27);
    expect(parseParamsBillions("openai-community/gpt2")).toBe(0.137);
    expect(parseParamsBillions("tiny/42M-model")).toBeNull();
  });

  it("uses explicit recommendation sizes before rough estimates", () => {
    const rec: ModelRecommendation = {
      id: "rec-1",
      name: "Recommended",
      min_vram_gb: 24,
      size_gb: 12,
      description: "Fits the current GPU",
      tags: [],
    };
    expect(recommendedNeedGb(rec)).toBe(24);

    const recByKey = new Map([["qwen", rec]]);
    expect(resolveGroupNeedGb("qwen", recByKey, model("Qwen/Qwen3.6-27B", ["bf16"]))).toBe(24);
  });

  it("falls back to model metadata for recency and rough weights", () => {
    expect(
      modelRecencyMs({
        ...model("x/y"),
        lastModified: undefined,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ).toBeGreaterThan(0);
    expect(estimateRoughWeightsGb(model("Qwen/Qwen3.6-27B-GGUF", ["q4_k_m"]))).toBeGreaterThan(0);
  });
});
