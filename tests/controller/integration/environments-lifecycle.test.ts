import { describe, expect, test } from "bun:test";

import { createTestApp, registerControllerTestLifecycle } from "./fixtures";
import { isEnvironmentRunning } from "../../../controller/src/modules/environments/environment-process";

registerControllerTestLifecycle();

// NOTE: these tests deliberately never exercise a real successful
// `POST /environments/:id/start` — that spawns a real `docker run` against
// an official multi-gigabyte image (vllm/vllm-openai, lmsysorg/sglang,
// ghcr.io/ggml-org/llama.cpp) with no model/GPU on a dev/CI machine, which
// would hang or pollute the host with a pulling container. Only the fast,
// side-effect-free paths (unknown-id guards, not-running short-circuits) are
// covered here; a real start/stop round-trip needs manual verification
// against a host that actually has Docker + a GPU + a downloaded model.

const createRecipeAndEnvironment = async (
  app: Awaited<ReturnType<typeof createTestApp>>,
): Promise<void> => {
  await app.request("/recipes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "qwen3-32b",
      name: "Qwen3-32B",
      model_path: "/mnt/llm_models/Qwen3-32B",
      backend: "vllm",
    }),
  });
  await app.request("/environments", {
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
};

describe("isEnvironmentRunning", () => {
  test("returns false for an id with no matching container", () => {
    expect(isEnvironmentRunning("no-such-environment")).toBe(false);
  });
});

describe("environment start/stop routes", () => {
  test("404s starting an unknown environment", async () => {
    const app = await createTestApp();
    const response = await app.request("/environments/does-not-exist/start", { method: "POST" });
    expect(response.status).toBe(404);
  });

  test("404s stopping an unknown environment", async () => {
    const app = await createTestApp();
    const response = await app.request("/environments/does-not-exist/stop", { method: "POST" });
    expect(response.status).toBe(404);
  });

  test("stopping an environment that isn't running short-circuits to stopped:true", async () => {
    const app = await createTestApp();
    await createRecipeAndEnvironment(app);

    const response = await app.request("/environments/env-qwen3-32b/stop", { method: "POST" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ stopped: true });
  });

  test("list/get responses report running:false when no container exists", async () => {
    const app = await createTestApp();
    await createRecipeAndEnvironment(app);

    const getResponse = await app.request("/environments/env-qwen3-32b");
    const environment = await getResponse.json();
    expect(environment.running).toBe(false);

    const listResponse = await app.request("/environments");
    const list = await listResponse.json();
    expect(list[0].running).toBe(false);
  });
});
