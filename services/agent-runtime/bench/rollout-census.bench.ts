/**
 * What is actually inside a rollout file.
 *
 * Session opens are slow in proportion to file size, but file size turns out to
 * have almost nothing to do with transcript length: on this machine's sessions,
 * 91-95% of the bytes are `custom` / `custom_message` entries that are inert to
 * the transcript and discarded on every read. This prints the split so a slow
 * session can be diagnosed as "large transcript" or "polluted by an extension"
 * without guessing.
 *
 * Read-only.
 *
 * Usage: bun run bench/rollout-census.bench.ts <rollout.jsonl> ...
 */
import { statSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: bun run bench/rollout-census.bench.ts <rollout.jsonl> ...");
  process.exit(1);
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/** Mirrors isInertEvent in sessions-store: inert to the transcript fold. */
const INERT_TYPES = new Set(["custom", "custom_message"]);

type Bucket = { count: number; bytes: number };

for (const filepath of files) {
  const { size } = statSync(filepath);
  const text = await Bun.file(filepath).text();

  let renderable: Bucket = { count: 0, bytes: 0 };
  let inert: Bucket = { count: 0, bytes: 0 };
  const byWriter = new Map<string, Bucket>();

  for (const line of text.split("\n")) {
    if (!line) continue;
    let event: { type?: string; customType?: string } | null = null;
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      continue;
    }
    const type = String(event?.type);
    const bucket = INERT_TYPES.has(type) ? inert : renderable;
    bucket.count += 1;
    bucket.bytes += line.length;
    if (!INERT_TYPES.has(type)) continue;
    // Inert entries are attributed to whatever wrote them, which is how you
    // find the extension responsible.
    const writer = event?.customType ?? "(no customType)";
    const current = byWriter.get(writer) ?? { count: 0, bytes: 0 };
    byWriter.set(writer, { count: current.count + 1, bytes: current.bytes + line.length });
  }

  const total = renderable.bytes + inert.bytes;
  console.log(`\n${filepath.split("/").pop()}  ${mb(size)}MB`);
  console.log(
    `  transcript: ${renderable.count} entries, ${mb(renderable.bytes)}MB` +
      `   inert: ${inert.count} entries, ${mb(inert.bytes)}MB` +
      `   (${total ? ((inert.bytes / total) * 100).toFixed(1) : "0"}% inert)`,
  );
  if (byWriter.size === 0) continue;
  console.log("  inert bytes by writer:");
  for (const [writer, bucket] of [...byWriter].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 6)) {
    console.log(
      `    ${writer.padEnd(34)} ${String(bucket.count).padStart(6)} entries  ${mb(bucket.bytes).padStart(7)}MB` +
        `  avg ${Math.round(bucket.bytes / bucket.count)}B`,
    );
  }
}

console.log("\nHigh inert share means the reader pays for bytes no user will ever see.");
