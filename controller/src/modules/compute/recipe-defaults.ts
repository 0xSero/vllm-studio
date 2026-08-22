import type { Recipe } from "../models/types";

type ParserName = string | undefined;

const GLM_4_REASONING_TAGS = ["4.5", "4.6", "4.7", "4-5", "4-6", "4-7"];
const GLM_5_REASONING_TAGS = ["5.0", "5.1", "5-0", "5-1"];
const MINIMAX_M2_TAGS = ["m2", "m-2"];
const QWEN_MOE_TAGS = ["qwen3.5", "qwen3-3.5", "qwen3-235b", "qwen3_235b"];

const modelIdForRecipe = (recipe: Recipe): string =>
  (recipe.served_model_name || recipe.model_path || "").toLowerCase();

const includesAny = (value: string, tags: string[]): boolean =>
  tags.some((tag) => value.includes(tag));

const isMiniMaxM2 = (modelId: string): boolean =>
  modelId.includes("minimax") && includesAny(modelId, MINIMAX_M2_TAGS);

const isGlm4Line = (modelId: string): boolean =>
  modelId.includes("glm") && includesAny(modelId, GLM_4_REASONING_TAGS);

const isGlm5Line = (modelId: string): boolean =>
  modelId.includes("glm") && includesAny(modelId, GLM_5_REASONING_TAGS);

const isIntellect3 = (modelId: string): boolean =>
  modelId.includes("intellect") && modelId.includes("3");

const isQwenMoe = (modelId: string): boolean =>
  includesAny(modelId, QWEN_MOE_TAGS) || (modelId.includes("qwen") && modelId.includes("262"));

/** First match wins, so order is the precedence — a mirothinker build is deepseek-r1 even
 *  though it is not an intellect model, and an explicit `undefined` opts a family out. */
const REASONING_PARSERS: readonly (readonly [(modelId: string) => boolean, ParserName])[] = [
  [isMiniMaxM2, "minimax_m2_append_think"],
  [(modelId): boolean => isIntellect3(modelId) || modelId.includes("mirothinker"), "deepseek_r1"],
  [(modelId): boolean => isGlm4Line(modelId) || isGlm5Line(modelId), "glm45"],
  [(modelId): boolean => modelId.includes("qwen3") && modelId.includes("thinking"), "deepseek_r1"],
  [(modelId): boolean => modelId.includes("qwen3"), "qwen3"],
];

const TOOL_CALL_PARSERS: readonly (readonly [(modelId: string) => boolean, ParserName])[] = [
  [(modelId): boolean => modelId.includes("mirothinker"), undefined],
  [isMiniMaxM2, "minimax-m2"],
  [isGlm4Line, "glm45"],
  [isGlm5Line, "glm47"],
  [isIntellect3, "qwen3_xml"],
];

const firstMatch = (
  table: readonly (readonly [(modelId: string) => boolean, ParserName])[],
  recipe: Recipe,
): ParserName => {
  const modelId = modelIdForRecipe(recipe);
  return table.find(([matches]) => matches(modelId))?.[1];
};

export const getDefaultReasoningParser = (recipe: Recipe): ParserName =>
  firstMatch(REASONING_PARSERS, recipe);

export const getDefaultToolCallParser = (recipe: Recipe): ParserName =>
  firstMatch(TOOL_CALL_PARSERS, recipe);

export const shouldEnableExpertParallel = (recipe: Recipe, explicitOverride: unknown): boolean => {
  if (explicitOverride === true) return true;
  if (explicitOverride === false || recipe.tensor_parallel_size <= 1) return false;
  const modelId = modelIdForRecipe(recipe);
  return isMiniMaxM2(modelId) || isQwenMoe(modelId);
};
