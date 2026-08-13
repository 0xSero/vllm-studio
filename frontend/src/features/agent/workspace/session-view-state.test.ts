import assert from "node:assert/strict";
import { test } from "node:test";
import {
  patchSessionView,
  readSessionView,
} from "@/features/agent/workspace/session-view-state";

function storage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("browser location and input remain isolated by session", () => {
  const target = storage();
  patchSessionView(target, { key: "session-a", aliases: [] }, {
    browser: { input: "https://a.example", url: "https://a.example" },
  });
  patchSessionView(target, { key: "session-b", aliases: [] }, {
    browser: { input: "https://b.example", url: "https://b.example" },
  });
  assert.deepEqual(readSessionView(target, { key: "session-a", aliases: [] })?.browser, {
    input: "https://a.example",
    url: "https://a.example",
  });
  assert.deepEqual(readSessionView(target, { key: "session-b", aliases: [] })?.browser, {
    input: "https://b.example",
    url: "https://b.example",
  });
});
