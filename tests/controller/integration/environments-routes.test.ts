import { describe, expect, test } from "bun:test";

import { createTestApp, registerControllerTestLifecycle } from "./fixtures";

registerControllerTestLifecycle();

const createRecipe = async (app: Awaited<ReturnType<typeof createTestApp>>): Promise<void> => {
  const response = await app.request("/recipes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "qwen3-32b",
      name: "Qwen3-32B",
      model_path: "/mnt/llm_models/Qwen3-32B",
      backend: "vllm",
    }),
  });
  expect(response.status).toBe(200);
};

describe("environments routes", () => {
  test("rejects creation without an existing recipe", async () => {
    const app = await createTestApp();
    const response = await app.request("/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "env-a",
        name: "A",
        recipeId: "does-not-exist",
        engineId: "vllm",
        version: "0.11.0",
      }),
    });
    expect(response.status).toBe(400);
  });

  test("creates an environment for an existing recipe and resolves its image", async () => {
    const app = await createTestApp();
    await createRecipe(app);

    const createResponse = await app.request("/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "env-qwen3-32b",
        name: "Qwen3-32B (vLLM v0.11.0)",
        recipeId: "qwen3-32b",
        engineId: "vllm",
        version: "0.11.0",
      }),
    });
    const created = await createResponse.json();
    expect(createResponse.status).toBe(200);
    expect(created).toMatchObject({
      id: "env-qwen3-32b",
      recipeId: "qwen3-32b",
      engineId: "vllm",
      version: "0.11.0",
      image: "vllm/vllm-openai:v0.11.0",
    });
  });

  test("lists and fetches created environments, 404s for unknown ids", async () => {
    const app = await createTestApp();
    await createRecipe(app);
    await app.request("/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "env-qwen3-32b",
        name: "Qwen3-32B",
        recipeId: "qwen3-32b",
        engineId: "sglang",
        version: "0.4.7",
        variant: "cu124",
      }),
    });

    const listResponse = await app.request("/environments");
    const list = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "env-qwen3-32b",
      seeded: false,
      image: "lmsysorg/sglang:v0.4.7-cu124",
    });

    const getResponse = await app.request("/environments/env-qwen3-32b");
    expect(getResponse.status).toBe(200);

    const missingResponse = await app.request("/environments/does-not-exist");
    expect(missingResponse.status).toBe(404);
  });

  test("deletes an environment", async () => {
    const app = await createTestApp();
    await createRecipe(app);
    await app.request("/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "env-qwen3-32b",
        name: "Qwen3-32B",
        recipeId: "qwen3-32b",
        engineId: "vllm",
        version: "0.11.0",
      }),
    });

    const deleteResponse = await app.request("/environments/env-qwen3-32b", { method: "DELETE" });
    expect(deleteResponse.status).toBe(200);

    const secondDeleteResponse = await app.request("/environments/env-qwen3-32b", {
      method: "DELETE",
    });
    expect(secondDeleteResponse.status).toBe(404);
  });
});
