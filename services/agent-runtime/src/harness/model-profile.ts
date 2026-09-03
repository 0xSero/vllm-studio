import type { ThinkingLevel } from "@earendil-works/pi-ai";

export type ReasoningEffort = "low" | "medium" | "xhigh";

export type ModelProfile = {
  id: string;
  match: (servedModelId: string) => boolean;
  sampling: { temperature: number; top_p: number; top_k: number; presence_penalty: number };
  reasoning: {
    levels: readonly ReasoningEffort[];
    default: "medium";
    fromThinkingLevel: (level: ThinkingLevel) => ReasoningEffort;
  };
  contextWindow: number;
  maxOutputTokens: number;
  vision: boolean;
  toolLoopGuard: { maxIdenticalCalls: number };
  toolSchemaStyle: "flat";
};

const REASONING_LEVELS: readonly ReasoningEffort[] = ["low", "medium", "xhigh"];

const effortFromThinkingLevel = (level: ThinkingLevel): ReasoningEffort => {
  switch (level) {
    case "xhigh":
    case "max":
      return "xhigh";
    case "medium":
    case "high":
      return "medium";
    default:
      return "low";
  }
};

const reasoning: ModelProfile["reasoning"] = {
  levels: REASONING_LEVELS,
  default: "medium",
  fromThinkingLevel: effortFromThinkingLevel,
};

export const QWEN38_RVN_PROFILE: ModelProfile = {
  id: "qwen3.8-rvn",
  match: (servedModelId) => /qwen3\.?8/i.test(servedModelId),
  sampling: { temperature: 0.6, top_p: 0.95, top_k: 20, presence_penalty: 0 },
  reasoning,
  contextWindow: 262144,
  maxOutputTokens: 32768,
  vision: true,
  toolLoopGuard: { maxIdenticalCalls: 3 },
  toolSchemaStyle: "flat",
};

export const GENERIC_PROFILE: ModelProfile = {
  id: "generic",
  match: () => true,
  sampling: { temperature: 0.7, top_p: 0.95, top_k: 40, presence_penalty: 0 },
  reasoning,
  contextWindow: 32768,
  maxOutputTokens: 8192,
  vision: false,
  toolLoopGuard: { maxIdenticalCalls: 3 },
  toolSchemaStyle: "flat",
};

export const MODEL_PROFILES: readonly ModelProfile[] = [QWEN38_RVN_PROFILE, GENERIC_PROFILE];

export const resolveModelProfile = (servedModelId: string): ModelProfile =>
  MODEL_PROFILES.find((profile) => profile.match(servedModelId)) ?? GENERIC_PROFILE;
