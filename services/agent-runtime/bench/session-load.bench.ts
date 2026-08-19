/**
 * End-to-end loadSession cost against a REAL rollout file: first open (cold
 * caches) then repeat opens and a "load earlier" page, which is what a user
 * scrolling back actually pays.
 *
 * Read-only: opens files under ~/.pi and never writes.
 */
import { statSync } from "node:fs";
import { loadSession } from "../src/sessions-store";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: bun run bench/session-load.bench.ts <rollout.jsonl> ...");
  process.exit(1);
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * The directory name encodes the cwd lossily (real hyphens in a path are
 * indistinguishable from separators), so read the truth out of the rollout's
 * own header line instead.
 */
function headerFor(filepath: string): Promise<{ cwd: string; id: string }> {
  const file = Bun.file(filepath);
  const stream = file.stream();
  const reader = stream.getReader();
  return reader.read().then(({ value }) => {
    const firstLine = new TextDecoder().decode(value).split("\n")[0];
    const header = JSON.parse(firstLine) as { cwd?: string; id?: string };
    void reader.cancel();
    return { cwd: header.cwd ?? "", id: header.id ?? "" };
  }) as unknown as { cwd: string; id: string };
}

console.log("loadSession — ms per call\n");
console.log("file\t\t\tMB\tcold\twarm\tpage(before)");

for (const filepath of files) {
  const { size } = statSync(filepath);
  const name = filepath.split("/").pop()?.slice(0, 20) ?? filepath;
  const { cwd, id } = await headerFor(filepath);

  const time = async (options: Parameters<typeof loadSession>[2]) => {
    const started = performance.now();
    const result = await loadSession(cwd, id, options);
    const ms = performance.now() - started;
    return { ms, events: result.events.length, cursor: result.cursor };
  };

  const cold = await time({ tail: 500 });
  if (cold.events === 0) {
    console.log(`${name}\t${mb(size)}\tSKIP (session file not resolvable from cwd/id)`);
    continue;
  }
  const warm = await time({ tail: 500 });
  const page = await time({ before: cold.cursor ?? undefined });

  console.log(
    `${name}\t${mb(size)}\t${cold.ms.toFixed(0)}\t${warm.ms.toFixed(0)}\t${page.ms.toFixed(0)}`,
  );
}

console.log("\ncold = first open, warm = reopen, page = one 'load earlier' fetch");
