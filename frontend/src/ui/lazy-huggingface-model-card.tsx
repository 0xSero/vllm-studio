"use client";

import dynamic from "next/dynamic";
import type { HuggingFaceModelCardPanelProps } from "./huggingface-model-card";

const ModelCardPanel = dynamic(
  () => import("./huggingface-model-card").then((module) => module.HuggingFaceModelCardPanel),
  { ssr: false },
);

export function LazyHuggingFaceModelCardPanel(props: HuggingFaceModelCardPanelProps) {
  if (!props.open) return null;
  return <ModelCardPanel {...props} />;
}
