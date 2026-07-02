import { basename } from "node:path";
import type { ProcessInfo, Recipe } from "../types";

export interface RecipeMatchOptions {
  allowCurrentContainsRecipePath?: boolean;
  allowEitherPathContains?: boolean;
}

const normalizeModelPath = (path: string): string => path.replace(/\/+$/, "");

// True when `ancestor` equals `descendant` or is a parent directory of it, using
// path-segment boundaries. A plain substring check would treat `/models/llama`
// as matching `/models/llama-3.1-8b` — a different model — so use a "/" boundary.
const isPathPrefix = (ancestor: string, descendant: string): boolean =>
  descendant === ancestor || descendant.startsWith(`${ancestor}/`);

/**
 * Determine whether a running process matches a given recipe.
 * Matching order:
 * 1) served_model_name (case-insensitive)
 * 2) normalized exact model path
 * 3) optional contains-style path match (route-specific)
 * 4) model path basename
 * @param recipe - Recipe to match against.
 * @param current - Current process info.
 * @param options - Matching options.
 * @returns True if the process matches the recipe.
 */
export const isRecipeRunning = (
  recipe: Recipe,
  current: ProcessInfo,
  options: RecipeMatchOptions = {},
): boolean => {
  const canonicalName = (recipe.served_model_name ?? "").toLowerCase();
  if (
    canonicalName &&
    current.served_model_name &&
    current.served_model_name.toLowerCase() === canonicalName
  ) {
    return true;
  }

  if (!current.model_path) {
    return false;
  }

  const recipePath = normalizeModelPath(recipe.model_path);
  const currentPath = normalizeModelPath(current.model_path);

  if (recipePath === currentPath) {
    return true;
  }

  if (options.allowEitherPathContains) {
    if (isPathPrefix(currentPath, recipePath) || isPathPrefix(recipePath, currentPath)) {
      return true;
    }
  } else if (options.allowCurrentContainsRecipePath) {
    if (isPathPrefix(recipePath, currentPath)) {
      return true;
    }
  }

  // Basename fallback ONLY when one side lacks directory context (e.g. the
  // running process reports just a filename). Comparing basenames of two full
  // paths with different parents would falsely match distinct models that
  // happen to share a filename (/a/model.gguf vs /b/model.gguf), reporting a
  // launch as already-running and silently serving the wrong model.
  if (!recipePath.includes("/") || !currentPath.includes("/")) {
    return basename(recipePath) === basename(currentPath);
  }
  return false;
};
