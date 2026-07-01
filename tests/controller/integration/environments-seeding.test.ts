import { describe, expect, test } from "bun:test";

import { createTestApp, registerControllerTestLifecycle } from "./fixtures";

registerControllerTestLifecycle();

interface TestApp {
  request(path: string, init?: RequestInit): Promise<Response>;
}

interface EnvironmentListItem {
  id: string;
  name: string;
  recipeId: string;
  engineId: string;
  version: string;
  variant: string | null;
  image: string;
  imagePulled: boolean;
  seeded: boolean;
  running: boolean;
}

const createRecipe = async (
  app: TestApp,
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  const response = await app.request("/recipes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "qwen3-32b",
      name: "Qwen3-32B",
      model_path: "/mnt/llm_models/Qwen3-32B",
      backend: "vllm",
      ...overrides,
    }),
  });
  expect(response.status).toBe(200);
};

const listEnvironments = async (app: TestApp): Promise<EnvironmentListItem[]> => {
  const response = await app.request("/environments");
  expect(response.status).toBe(200);
  return (await response.json()) as EnvironmentListItem[];
};

describe("environment seeding on GET /environments", () => {
  test("seeds one environment per docker-capable recipe with the default engine image", async () => {
    const app = await createTestApp();
    await createRecipe(app);

    const list = await listEnvironments(app);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "env-qwen3-32b",
      name: "Qwen3-32B",
      recipeId: "qwen3-32b",
      engineId: "vllm",
      version: "0.24.0",
      seeded: true,
      image: "vllm/vllm-openai:v0.24.0",
    });
    expect(typeof list[0]?.imagePulled).toBe("boolean");
  });

  test("re-listing does not duplicate the seeded environment", async () => {
    const app = await createTestApp();
    await createRecipe(app);

    expect(await listEnvironments(app)).toHaveLength(1);
    expect(await listEnvironments(app)).toHaveLength(1);
  });

  test("a recipe pinning extra_args.docker_image seeds with that custom ref", async () => {
    const app = await createTestApp();
    await createRecipe(app, { extra_args: { docker_image: "voipmonitor/vllm:custom" } });

    const list = await listEnvironments(app);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "env-qwen3-32b",
      seeded: true,
      image: "voipmonitor/vllm:custom",
    });
  });

  test("an existing user environment for the recipe suppresses seeding", async () => {
    const app = await createTestApp();
    await createRecipe(app);

    const createResponse = await app.request("/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "env-custom",
        name: "Qwen3-32B (SGLang)",
        recipeId: "qwen3-32b",
        engineId: "sglang",
        version: "0.4.7",
        variant: "cu124",
      }),
    });
    expect(createResponse.status).toBe(200);

    const list = await listEnvironments(app);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "env-custom",
      seeded: false,
      image: "lmsysorg/sglang:v0.4.7-cu124",
    });
  });

  test("mlx recipes never seed an environment", async () => {
    const app = await createTestApp();
    await createRecipe(app, { backend: "mlx" });

    expect(await listEnvironments(app)).toHaveLength(0);
  });
});
