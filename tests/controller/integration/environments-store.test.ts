import { describe, expect, it } from "bun:test";

import { EnvironmentStore } from "../../../controller/src/modules/environments/environment-store";
import { parseEnvironment } from "../../../controller/src/modules/environments/environment-serializer";
import type { Environment } from "../../../controller/src/modules/environments/types";
import { delay } from "../../../controller/src/core/async";

const makeEnvironment = (overrides: Partial<Environment> = {}): Environment =>
  parseEnvironment({
    id: "env-qwen3-32b",
    name: "Qwen3-32B (vLLM v0.11.0)",
    recipeId: "qwen3-32b",
    engineId: "vllm",
    version: "0.11.0",
    variant: null,
    ...overrides,
  });

describe("parseEnvironment", () => {
  it("defaults variant to null and stamps created/updated timestamps", () => {
    const environment = parseEnvironment({
      id: "env-a",
      name: "A",
      recipeId: "recipe-a",
      engineId: "sglang",
      version: "0.4.7",
    });
    expect(environment.variant).toBeNull();
    expect(environment.createdAt).toBeTruthy();
    expect(environment.updatedAt).toBeTruthy();
    expect(environment.id).toBe("env-a");
  });

  it("rejects an engineId outside vllm/sglang/llamacpp (no mlx Docker environments)", () => {
    expect(() =>
      parseEnvironment({
        id: "env-b",
        name: "B",
        recipeId: "recipe-b",
        engineId: "mlx",
        version: "1.0.0",
      }),
    ).toThrow();
  });
});

describe("EnvironmentStore", () => {
  it("round-trips create/list/get/delete", () => {
    const store = new EnvironmentStore(":memory:");
    expect(store.list()).toEqual([]);

    const environment = makeEnvironment();
    store.save(environment);

    expect(store.list()).toHaveLength(1);
    expect(store.get(environment.id)?.recipeId).toBe("qwen3-32b");
    expect(store.get("does-not-exist")).toBeNull();

    expect(store.delete(environment.id)).toBe(true);
    expect(store.delete(environment.id)).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("upserts on save with the same id, bumping updatedAt", async () => {
    const store = new EnvironmentStore(":memory:");
    const first = makeEnvironment();
    store.save(first);
    const firstSaved = store.get(first.id);

    await delay(5);
    const second = makeEnvironment({ version: "0.12.0" });
    store.save(second);

    expect(store.list()).toHaveLength(1);
    const updated = store.get(first.id);
    expect(updated?.version).toBe("0.12.0");
    expect(updated?.updatedAt).not.toBe(firstSaved?.updatedAt);
  });
});
