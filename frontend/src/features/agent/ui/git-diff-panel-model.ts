import { parsePatchFiles, type CodeViewDiffItem } from "@pierre/diffs";
import type { GitState } from "@/features/agent/contracts";

export type GitDiffPayload = Partial<GitState>;
export type DiffViewMode = "unified" | "split";

function patchCacheKey(diff: string) {
  let primary = 0x811c9dc5;
  let secondary = 0x9e3779b9;
  for (let index = 0; index < diff.length; index += 1) {
    const code = diff.charCodeAt(index);
    primary ^= code;
    primary = Math.imul(primary, 0x01000193) >>> 0;
    secondary ^= code;
    secondary = Math.imul(secondary, 0x85ebca6b) >>> 0;
  }
  return `working-tree:${diff.length}:${primary.toString(36)}:${secondary.toString(36)}`;
}

export function parseUnifiedDiff(diff: string): CodeViewDiffItem[] {
  const normalized = diff.trim();
  if (!normalized) return [];
  try {
    return parsePatchFiles(normalized, patchCacheKey(normalized)).flatMap((patch) =>
      patch.files.map((fileDiff, index) => ({
        id: fileDiff.cacheKey ?? `${fileDiff.prevName ?? "file"}:${fileDiff.name}:${index}`,
        type: "diff" as const,
        fileDiff,
      })),
    );
  } catch {
    return [];
  }
}

export function gitDiffHeaderTitle(payload: GitDiffPayload | null, cwd: string | null): string {
  if (payload?.branch) return payload.branch;
  return cwd ? "Working tree diff" : "No directory";
}
