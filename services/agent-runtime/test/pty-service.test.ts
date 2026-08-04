import { describe, expect, test } from "bun:test";
import os from "node:os";
import {
  MAX_REPLAY_CHARS,
  clampReplay,
  closePtySession,
  isPtyAvailable,
  openPtySession,
  subscribePtySession,
  writePtySession,
} from "../src/pty-service";

function waitForOutput(id: string, needle: string, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let seen = "";
    const subscription = subscribePtySession(id, {
      onData: (chunk) => {
        seen += chunk;
        if (seen.includes(needle)) {
          subscription?.unsubscribe();
          clearTimeout(timer);
          resolve(seen);
        }
      },
      onExit: () => {},
    });
    if (!subscription) return reject(new Error("no session"));
    seen = subscription.replay;
    const timer = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`timed out waiting for ${JSON.stringify(needle)}; saw: ${seen.slice(-400)}`));
    }, timeoutMs);
  });
}

// node-pty child shells don't execute under the bun test harness (verified:
// the same spawn/write/read roundtrip passes under Node, which is what runs
// the agent runtime in production). Interactive tests skip under bun.
const interactivePtyUsable = isPtyAvailable() && !process.versions.bun;

describe("pty-service", () => {
  test("spawns a real shell, streams output, and reuses by ownerKey", async () => {
    if (!interactivePtyUsable) {
      console.warn("pty-service interactive test skipped (bun harness or node-pty unavailable)");
      return;
    }
    const ownerKey = `test:${Date.now()}`;
    const opened = openPtySession({ cwd: os.homedir(), cols: 80, rows: 24, ownerKey });
    expect(opened.reused).toBe(false);
    try {
      writePtySession(opened.id, "echo pty-roundtrip-$((20+3))\r");
      const output = await waitForOutput(opened.id, "pty-roundtrip-23", 20_000);
      expect(output).toContain("pty-roundtrip-23");

      const reopened = openPtySession({ cwd: os.homedir(), cols: 100, rows: 30, ownerKey });
      expect(reopened.id).toBe(opened.id);
      expect(reopened.reused).toBe(true);

      // Replay is retained for reattach.
      const subscription = subscribePtySession(opened.id, { onData: () => {}, onExit: () => {} });
      expect(subscription?.replay ?? "").toContain("pty-roundtrip-23");
      subscription?.unsubscribe();
    } finally {
      closePtySession(opened.id);
    }
  });

  test("refuses unsafe cwd by falling back to home", async () => {
    if (!interactivePtyUsable) return;
    const ownerKey = `test-root:${Date.now()}`;
    const opened = openPtySession({ cwd: "/", cols: 80, rows: 24, ownerKey });
    try {
      writePtySession(opened.id, "pwd\r");
      const output = await waitForOutput(opened.id, os.homedir());
      expect(output).toContain(os.homedir());
    } finally {
      closePtySession(opened.id);
    }
  });

  test("rejects writes to unknown sessions", () => {
    expect(writePtySession("does-not-exist", "boom")).toBe(false);
  });

  // Pure buffer-cap logic — runs under bun without node-pty. The replay buffer
  // a reattaching client replays must stay bounded and keep the most recent
  // output (the tail), never the stale head.
  test("clampReplay bounds the buffer and keeps the tail", () => {
    const short = "hello world";
    expect(clampReplay(short)).toBe(short);

    const oversized = "A".repeat(MAX_REPLAY_CHARS) + "TAIL";
    const clamped = clampReplay(oversized);
    expect(clamped.length).toBe(MAX_REPLAY_CHARS);
    expect(clamped.endsWith("TAIL")).toBe(true);
    expect(clamped.startsWith("A")).toBe(true);
    // The head rolled off: fewer leading A's than we started with.
    expect(clamped).not.toBe(oversized);

    expect(clampReplay("").length).toBe(0);
    expect(clampReplay("X".repeat(MAX_REPLAY_CHARS)).length).toBe(MAX_REPLAY_CHARS);
  });
});
