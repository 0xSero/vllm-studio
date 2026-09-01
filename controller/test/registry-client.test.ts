import { describe, expect, test } from "bun:test";
import { RegistryClientError, makeRegistryClient } from "../src/modules/registry/client";
import { fixtureFetch, runEffect as run } from "./fixtures";

const BASE = "https://registry.test/registry";

describe("registry client", () => {
  test("reads and validates the discovery index", async () => {
    const { fetch, requests } = fixtureFetch();
    const client = makeRegistryClient({ baseUrl: BASE, fetch });
    const result = await run(client.index());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.counts["recipe"]).toBeGreaterThan(0);
    expect(result.value.recipes.length).toBeGreaterThan(0);
    expect(requests).toEqual([`${BASE}/index.json`]);
  });

  test("progressively loads exact records and memoizes them", async () => {
    const { fetch, requests } = fixtureFetch();
    const client = makeRegistryClient({ baseUrl: BASE, fetch });
    const recipeId = "diffusiongemma-26b-a4b-bf16-rtx-pro-6000-blackwell-96gb-vllm-tp1";
    const first = await run(client.recipe(recipeId));
    const second = await run(client.recipe(recipeId));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.id).toBe(recipeId);
    expect(second.value).toEqual(first.value);
    const recipeRequests = requests.filter((url) => url.includes(`recipe/${recipeId}`));
    expect(recipeRequests.length).toBe(1);
  });

  test("unwraps {data} envelopes so the published API works as a base too", async () => {
    const { fetch } = fixtureFetch({
      bodies: {
        [`${BASE}/hardware/rtx-5090-32gb`]: JSON.stringify({
          data: {
            schema_version: "local-ai-registry/v1",
            id: "rtx-5090-32gb",
            vendor: "nvidia",
            name: "GeForce RTX 5090",
            kind: "discrete",
            accelerator_backend: "nvidia",
            memory: { vram_gb: 32, vram_type: "GDDR7", cpu_memory_gb: null, bandwidth_gb_per_s: 1792 },
          },
          meta: { source: "registry" },
        }),
      },
      missing: ["/hardware/rtx-5090-32gb.json"],
    });
    const client = makeRegistryClient({ baseUrl: BASE, fetch });
    const result = await run(client.hardware("rtx-5090-32gb"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("rtx-5090-32gb");
    expect(result.value.memory.vram_gb).toBe(32);
  });

  test("fails with a typed error on schema-invalid records", async () => {
    const { fetch } = fixtureFetch({
      bodies: { [`${BASE}/hardware/rtx-5090-32gb.json`]: JSON.stringify({ id: "rtx-5090-32gb" }) },
    });
    const client = makeRegistryClient({ baseUrl: BASE, fetch });
    const result = await run(client.hardware("rtx-5090-32gb"));
    expect(!result.ok).toBe(true);
    if (result.ok) return;
    expect(result.error instanceof RegistryClientError).toBe(true);
    if (!(result.error instanceof RegistryClientError)) return;
    expect(result.error.operation).toContain("hardware");
  });

  test("fails with a typed error when the registry is unreachable", async () => {
    const { fetch } = fixtureFetch({ failing: ["index.json"] });
    const client = makeRegistryClient({ baseUrl: BASE, fetch });
    const result = await run(client.index());
    expect(!result.ok).toBe(true);
    if (result.ok) return;
    expect(result.error instanceof RegistryClientError).toBe(true);
  });

  test("a 404 record reports a typed error carrying the status", async () => {
    const { fetch } = fixtureFetch({ missing: ["recipe/does-not-exist"] });
    const client = makeRegistryClient({ baseUrl: BASE, fetch });
    const result = await run(client.recipe("does-not-exist"));
    expect(!result.ok).toBe(true);
    if (result.ok) return;
    expect((result.error as RegistryClientError | undefined)?.status).toBe(404);
  });

  test("invalidate drops the cache so records are refetched", async () => {
    const { fetch, requests } = fixtureFetch();
    const client = makeRegistryClient({ baseUrl: BASE, fetch });
    await run(client.model("deepseek"));
    await run(client.invalidate());
    await run(client.model("deepseek"));
    expect(requests.filter((url) => url.endsWith("/model/deepseek.json")).length).toBe(2);
  });

});
