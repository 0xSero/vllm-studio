import { describe, expect, it } from "vitest";
import type { HuggingFaceModel } from "@/lib/types";
import { derivativeScore } from "./use-explore";

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

describe("derivativeScore", () => {
  it("ranks exact/base model ids ahead of quantized derivatives", () => {
    const base = model("Qwen/Qwen3.6-27B", ["text-generation"]);
    const derivative = model("some-org/Qwen3.6-27B-GGUF", ["gguf", "quantized"]);

    expect(derivativeScore(base, "Qwen3.6-27B")).toBeLessThan(
      derivativeScore(derivative, "Qwen3.6-27B"),
    );
  });
});
