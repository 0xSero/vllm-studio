import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceRequestStore } from "./inference-request-store";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

const createStore = (): InferenceRequestStore => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-usage-"));
  directories.push(directory);
  return new InferenceRequestStore(join(directory, "controller.db"));
};

describe("InferenceRequestStore", () => {
  test("lifetime aggregation includes models without recipes", () => {
    const store = createStore();
    store.record({ model: "known", prompt_tokens: 10, completion_tokens: 2 });
    store.record({ model: "historical", prompt_tokens: 30, completion_tokens: 4 });

    expect(store.aggregate()?.totals).toMatchObject({
      total_tokens: 46,
      prompt_tokens: 40,
      completion_tokens: 6,
      total_requests: 2,
    });
    expect(store.aggregate(new Set(["known"]))?.totals.total_tokens).toBe(12);
  });
});
