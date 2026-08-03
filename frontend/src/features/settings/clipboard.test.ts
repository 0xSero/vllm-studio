import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { writeClipboardText } from "@/lib/clipboard";

describe("writeClipboardText", () => {
  test("uses the Clipboard API when available", async () => {
    const values: string[] = [];
    await writeClipboardText("connection", {
      clipboard: { writeText: async (value) => void values.push(value) },
      fallback: () => false,
    });
    assert.deepEqual(values, ["connection"]);
  });

  test("falls back when the Clipboard API is unavailable", async () => {
    const values: string[] = [];
    await writeClipboardText("connection", {
      clipboard: null,
      fallback: (value) => {
        values.push(value);
        return true;
      },
    });
    assert.deepEqual(values, ["connection"]);
  });

  test("rejects when neither copy path succeeds", async () => {
    await assert.rejects(
      writeClipboardText("connection", { clipboard: null, fallback: () => false }),
      /Clipboard access is unavailable/,
    );
  });
});
