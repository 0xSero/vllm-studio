import { QUANTIZATION_TAGS } from "./config";
import { quantizationLabels } from "@/lib/huggingface";

export function extractQuantizations(tags: string[]): string[] {
  const labels = quantizationLabels({ modelId: "", tags });
  if (labels.length) return labels;
  const tagLower = tags.map((t) => t.toLowerCase());
  return QUANTIZATION_TAGS.filter((quant) => tagLower.includes(quant.toLowerCase())).map((quant) =>
    quant.toUpperCase(),
  );
}
