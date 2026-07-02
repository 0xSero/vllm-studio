import type { AppContext } from "../../app-context";
import { listLogFiles, resolveExistingLogPath, tailFileLines } from "../../core/log-files";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import type { ProcessInfo, Recipe } from "../models/types";

const LLAMACPP_LOG_TAIL_LINES = 240;
export const LLAMACPP_TPS_STALE_MS = 15_000;
const TOKENS_PER_SECOND_PATTERN = /([0-9]+(?:\.[0-9]+)?)\s*tokens\s+per\s+second/i;
const PROMPT_EVAL_PATTERN = /prompt eval time\s*=/i;
const EVAL_PATTERN = /(^|\s)eval time\s*=/i;

export interface LlamacppThroughputSample {
  promptTps: number;
  generationTps: number;
  sampleKey: string;
}

const parseTokensPerSecond = (line: string): number | null => {
  const match = line.match(TOKENS_PER_SECOND_PATTERN);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
};

const parseLlamacppThroughputFromLines = (lines: string[]): LlamacppThroughputSample | null => {
  if (lines.length === 0) return null;

  let promptLine = "";
  let evalLine = "";

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (!promptLine && PROMPT_EVAL_PATTERN.test(line)) {
      promptLine = line;
      continue;
    }
    if (!evalLine && EVAL_PATTERN.test(line) && !PROMPT_EVAL_PATTERN.test(line)) {
      evalLine = line;
    }
    if (promptLine && evalLine) break;
  }

  const promptTps = promptLine ? (parseTokensPerSecond(promptLine) ?? 0) : 0;
  const generationTps = evalLine ? (parseTokensPerSecond(evalLine) ?? 0) : 0;
  if (promptTps <= 0 && generationTps <= 0) return null;

  return {
    promptTps,
    generationTps,
    sampleKey: `${promptLine}::${evalLine}`,
  };
};

const findRunningRecipeForProcess = (context: AppContext, current: ProcessInfo): Recipe | null => {
  const recipes = context.stores.recipeStore.list();
  return (
    recipes.find((recipe) =>
      isRecipeRunning(recipe, current, {
        allowCurrentContainsRecipePath: true,
      }),
    ) ?? null
  );
};

export const scrapeLlamacppThroughput = (
  context: AppContext,
  current: ProcessInfo,
): LlamacppThroughputSample | null => {
  const recipe = findRunningRecipeForProcess(context, current);
  const recipeLogPath = recipe ? resolveExistingLogPath(context.config.data_dir, recipe.id) : null;
  const servedName = (current.served_model_name ?? "").toLowerCase();

  let logPath = recipeLogPath;
  if (!logPath) {
    const entries = listLogFiles(context.config.data_dir).filter(
      (entry) => entry.sessionId !== "controller",
    );
    const byName =
      servedName.length > 0
        ? entries.find((entry) => entry.sessionId.toLowerCase().includes(servedName))
        : null;
    logPath = byName?.path ?? entries[0]?.path ?? null;
  }

  if (!logPath) return null;
  const lines = tailFileLines(logPath, LLAMACPP_LOG_TAIL_LINES);
  return parseLlamacppThroughputFromLines(lines);
};
