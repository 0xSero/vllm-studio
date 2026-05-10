import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadSession } from "./sessions-store";

const originalEnv = { ...process.env };
const roots: string[] = [];

afterEach(() => {
  process.env = { ...originalEnv };
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const encodeCwdForPi = (cwd: string): string => {
  const normalized = path.resolve(cwd).replace(/\\+/g, "/");
  const collapsed = normalized.replace(/^\//, "").replace(/\/+/g, "-");
  return `--${collapsed}--`;
};

describe("session store", () => {
  it("hydrates sessions saved under Pi's resolved cwd", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vllm-studio-sessions-"));
    roots.push(root);
    process.env.PI_CODING_AGENT_DIR = path.join(root, "pi-agent");

    const actualCwd = path.join(root, "actual");
    const linkedCwd = path.join(root, "linked");
    mkdirSync(actualCwd, { recursive: true });
    symlinkSync(actualCwd, linkedCwd);
    const piCwd = realpathSync.native(actualCwd);

    const sessionId = "session-realpath";
    const sessionDir = path.join(
      process.env.PI_CODING_AGENT_DIR,
      "sessions",
      encodeCwdForPi(piCwd),
    );
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      path.join(sessionDir, `2026-05-10T00-00-00-000Z_${sessionId}.jsonl`),
      [
        JSON.stringify({ type: "session", id: sessionId, cwd: piCwd }),
        JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
      ].join("\n"),
    );

    const events = await loadSession(linkedCwd, sessionId);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "session", id: sessionId });
  });
});
