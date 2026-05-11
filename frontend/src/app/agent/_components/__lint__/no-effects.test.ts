import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COMPONENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EFFECT_CALL = "use" + "Effect(";
const EFFECT_BUDGETS = new Map<string, number>([["use-workspace.ts", 1]]);
const EXCLUDED_FILES = new Set(["chat-pane.tsx"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return entry === "__lint__" ? [] : sourceFiles(fullPath);
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) return [];
    return [fullPath];
  });
}

function relativeFile(filePath: string): string {
  return path.relative(COMPONENTS_DIR, filePath).replaceAll(path.sep, "/");
}

function countEffectCalls(source: string): number {
  return source.split(EFFECT_CALL).length - 1;
}

describe("agent workspace lint budgets", () => {
  it("keeps useEffect calls out of component files", () => {
    const offenders = sourceFiles(COMPONENTS_DIR).flatMap((filePath) => {
      const relative = relativeFile(filePath);
      if (EXCLUDED_FILES.has(relative)) return [];
      const count = countEffectCalls(readFileSync(filePath, "utf8"));
      const budget = EFFECT_BUDGETS.get(relative) ?? 0;
      return count === budget ? [] : [`${relative}: expected ${budget}, found ${count}`];
    });

    expect(offenders).toEqual([]);
  });

  it("keeps the agent workspace shell below 400 lines", () => {
    const source = readFileSync(path.join(COMPONENTS_DIR, "agent-workspace.tsx"), "utf8");
    expect(source.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(400);
  });
});
