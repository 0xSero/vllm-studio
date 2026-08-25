import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The pi boundary: only `src/pi/**` may import `@earendil-works/*`. Everything
 * else consumes the pi module's surface, so pi upgrades and the
 * snapshot-projection work (docs/agent-state-plan.md) have exactly one seam.
 */
const SRC = join(import.meta.dir, "..", "src");

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });

describe("pi module boundary", () => {
  test("only src/pi imports @earendil-works packages", () => {
    const offenders = walk(SRC)
      .filter((path) => !relative(SRC, path).startsWith("pi/"))
      .filter((path) => readFileSync(path, "utf8").includes("@earendil-works/"))
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });
});
