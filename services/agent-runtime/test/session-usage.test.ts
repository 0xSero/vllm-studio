import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSessionUsageTotals } from "../src/session-usage";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "session-usage-"));
  temporaryRoots.push(root);
  return path.join(root, "rollout.jsonl");
}

const header = () => JSON.stringify({ type: "session", id: "s1", cwd: "/tmp" });

/** One assistant turn that cost `input`/`output` tokens. */
const turn = (input: number, output: number) =>
  JSON.stringify({
    type: "message",
    message: { role: "assistant", usage: { input, output, cost: { total: 0.5 } } },
  });

/** A line with no usage block — the pre-filter should skip it entirely. */
const chatter = (text: string) =>
  JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });

// Resuming a scan means trusting a byte offset. Everything below is about that
// offset being exactly right, because being one byte off does not throw — it
// silently reports a wrong lifetime spend.
describe("incremental usage scan", () => {
  test("totals a whole rollout on the first read", async () => {
    const file = fixture();
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n${turn(200, 30)}\n`);

    const totals = await readSessionUsageTotals(file);

    expect(totals.input).toBe(300);
    expect(totals.output).toBe(50);
    expect(totals.calls).toBe(2);
  });

  test("an appended turn adds to the total instead of restarting it", async () => {
    const file = fixture();
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n`);
    expect((await readSessionUsageTotals(file)).input).toBe(100);

    appendFileSync(file, `${turn(400, 60)}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.input).toBe(500);
    expect(totals.output).toBe(80);
    expect(totals.calls).toBe(2);
  });

  test("a half-written final line is re-read once it is complete", async () => {
    // The writer is mid-append when we scan: the last line has no newline yet.
    // Counting it as scanned would lose that turn forever.
    const file = fixture();
    const partial = turn(700, 90);
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n${partial.slice(0, 30)}`);
    expect((await readSessionUsageTotals(file)).input).toBe(100);

    writeFileSync(file, `${header()}\n${turn(100, 20)}\n${partial}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.input).toBe(800);
    expect(totals.calls).toBe(2);
  });

  test("multi-byte turns do not drift the resume offset", async () => {
    // Character offsets and byte offsets diverge the moment a turn contains
    // anything non-ASCII, and the resume point is a byte offset.
    const file = fixture();
    writeFileSync(file, `${header()}\n${chatter("绿茶 — ☕️ naïve")}\n${turn(100, 20)}\n`);
    expect((await readSessionUsageTotals(file)).input).toBe(100);

    appendFileSync(file, `${chatter("مرحبا 🌍")}\n${turn(250, 25)}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.input).toBe(350);
    expect(totals.output).toBe(45);
    expect(totals.calls).toBe(2);
  });

  test("a rewritten file is rescanned rather than resumed", async () => {
    // The resume is only sound while the file is append-only. If it is replaced,
    // the cached prefix belongs to a different session.
    const file = fixture();
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n`);
    expect((await readSessionUsageTotals(file)).input).toBe(100);

    const replacement = JSON.stringify({ type: "session", id: "s2", cwd: "/tmp/other" });
    writeFileSync(file, `${replacement}\n${turn(7, 3)}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.input).toBe(7);
    expect(totals.calls).toBe(1);
  });

  test("a truncated file is rescanned rather than resumed", async () => {
    const file = fixture();
    writeFileSync(file, `${header()}\n${turn(100, 20)}\n${turn(200, 30)}\n`);
    expect((await readSessionUsageTotals(file)).input).toBe(300);

    const shorter = `${header()}\n${turn(100, 20)}\n`;
    truncateSync(file, Buffer.byteLength(shorter, "utf-8"));

    expect((await readSessionUsageTotals(file)).input).toBe(100);
  });

  test("compactions keep counting across a resume", async () => {
    const file = fixture();
    writeFileSync(file, `${header()}\n${JSON.stringify({ type: "compaction" })}\n`);
    expect((await readSessionUsageTotals(file)).compactions).toBe(1);

    appendFileSync(file, `${JSON.stringify({ type: "compaction" })}\n${turn(10, 5)}\n`);

    const totals = await readSessionUsageTotals(file);
    expect(totals.compactions).toBe(2);
    expect(totals.input).toBe(10);
  });
});
