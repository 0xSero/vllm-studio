// Golden characterization test for replaySessionEvents (messages/replay.ts).
//
// This pins the CURRENT canonical-replay behavior so the one-reducer
// consolidation (replay.ts deleted, replaced by a fold over
// runtime/pi-event-applier.ts reduceSessionEvent) can be verified against a
// fixed contract: the new fold must reproduce these goldens byte-for-byte
// through the same normalized projection (scripts/replay-projection.ts).
//
// Fixture provenance: scripts/fixtures/replay-canonical-session.jsonl is a
// SANITIZED canonical pi session log. Its structural shape (entry types,
// field names, role sequence, multi-toolCall assistant turn, toolResult
// entries, model_change / thinking_level_change / compaction / custom
// entries) mirrors real logs under ~/.pi/agent/sessions/**, but every piece
// of prompt/content text is a short synthetic placeholder.
//
// Regenerate the golden intentionally with:
//   UPDATE_GOLDENS=1 bun test scripts/replay-parity.test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { replaySessionEvents } from "../src/features/agent/messages/replay";
import { projectReplayResult, type ProjectedReplay } from "./replay-projection";

const fixturesDir = new URL("./fixtures/", import.meta.url).pathname;
const goldenPath = join(fixturesDir, "replay-canonical-session.golden.json");

function parseJsonl(raw: string): Record<string, unknown>[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function replayProjection(events: Record<string, unknown>[]): ProjectedReplay {
  return projectReplayResult(replaySessionEvents(events));
}

const stableJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

test("replaySessionEvents over the sanitized canonical fixture matches the checked-in golden", () => {
  const events = parseJsonl(readFileSync(join(fixturesDir, "replay-canonical-session.jsonl"), "utf8"));
  const projection = replayProjection(events);

  if (process.env.UPDATE_GOLDENS) {
    writeFileSync(goldenPath, stableJson(projection));
  }
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as ProjectedReplay;
  assert.deepEqual(projection, golden);
});

test("replay projection is deterministic across runs (no wall-clock leakage)", () => {
  const events = parseJsonl(readFileSync(join(fixturesDir, "replay-canonical-session.jsonl"), "utf8"));
  assert.deepEqual(replayProjection(events), replayProjection(events));
});

// Optional broad parity sweep over REAL session logs. Enabled only when
// PI_PARITY_SESSIONS_DIR points at a directory of pi session JSONLs (e.g.
// ~/.pi/agent/sessions). First run records a local golden per session file
// (content-addressed, NOT checked in — real sessions contain private text);
// later runs — in particular, the post-consolidation run — must match them.
// Golden location: PI_PARITY_GOLDENS_DIR or <repo>/frontend/scripts/.parity-goldens.
// Files larger than PI_PARITY_MAX_BYTES (default 4 MiB) are skipped — real
// session dirs hold multi-hundred-MB logs that crash the test process when
// slurped wholesale; the cap keeps the sweep deterministic and finishable.
const paritySessionsDir = process.env.PI_PARITY_SESSIONS_DIR;
const parityMaxBytes = Number(process.env.PI_PARITY_MAX_BYTES || 4 * 1024 * 1024);

function collectJsonlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...collectJsonlFiles(full));
    else if (entry.endsWith(".jsonl") && stats.size <= parityMaxBytes) out.push(full);
  }
  return out.sort();
}

test(
  "replaySessionEvents parity sweep over $PI_PARITY_SESSIONS_DIR",
  { skip: !paritySessionsDir },
  () => {
    if (!paritySessionsDir) return;
    const goldensDir =
      process.env.PI_PARITY_GOLDENS_DIR ?? join(fixturesDir, "..", ".parity-goldens");
    mkdirSync(goldensDir, { recursive: true });

    const files = collectJsonlFiles(paritySessionsDir);
    assert.ok(files.length > 0, `no .jsonl files under ${paritySessionsDir}`);

    let recorded = 0;
    let compared = 0;
    for (const file of files) {
      let events: Record<string, unknown>[];
      try {
        events = parseJsonl(readFileSync(file, "utf8"));
      } catch {
        continue; // unreadable/corrupt logs are out of scope for parity
      }
      const projection = replayProjection(events);
      const key = createHash("sha256").update(file).digest("hex").slice(0, 24);
      const golden = join(goldensDir, `${key}.json`);
      if (!existsSync(golden) || process.env.UPDATE_GOLDENS) {
        writeFileSync(golden, stableJson({ source: file, projection }));
        recorded += 1;
        continue;
      }
      const saved = JSON.parse(readFileSync(golden, "utf8")) as {
        source: string;
        projection: ProjectedReplay;
      };
      assert.deepEqual(projection, saved.projection, `replay parity drift for ${file}`);
      compared += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`parity sweep: ${compared} compared, ${recorded} newly recorded`);
  },
);
