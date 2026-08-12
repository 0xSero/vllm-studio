/**
 * Usage-scan cost against a REAL rollout, in the shape the app actually hits
 * it: a cold scan, then a scan after the session has grown by one turn — which
 * is what every open of a session you are actively using looks like.
 *
 * Copies the rollout into a temp dir first so the real file is never touched.
 *
 * Usage: bun run bench/session-usage.bench.ts <rollout.jsonl> ...
 */
import { appendFileSync, copyFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSessionUsageTotals } from "../src/session-usage";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: bun run bench/session-usage.bench.ts <rollout.jsonl> ...");
  process.exit(1);
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

const newTurn = () =>
  `${JSON.stringify({
    type: "message",
    message: { role: "assistant", usage: { input: 1000, output: 100 } },
  })}\n`;

console.log("usage scan — ms\n");
console.log("file\t\t\tMB\tcold\tunchanged\tafter-append");

for (const source of files) {
  const { size } = statSync(source);
  const name = source.split("/").pop()?.slice(0, 20) ?? source;

  const root = mkdtempSync(path.join(tmpdir(), "usage-bench-"));
  const working = path.join(root, "rollout.jsonl");
  copyFileSync(source, working);

  try {
    const time = async () => {
      const started = performance.now();
      const totals = await readSessionUsageTotals(working);
      return { ms: performance.now() - started, calls: totals.calls };
    };

    const cold = await time();
    const unchanged = await time();
    appendFileSync(working, newTurn());
    const appended = await time();

    console.log(
      `${name}\t${mb(size)}\t${cold.ms.toFixed(0)}\t${unchanged.ms.toFixed(0)}\t\t${appended.ms.toFixed(0)}`,
    );
    if (appended.calls !== cold.calls + 1) {
      console.log(`  WRONG: appended turn should add one call, got ${appended.calls} vs ${cold.calls}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("\nafter-append is the number that matters: every open of a live session pays it");
