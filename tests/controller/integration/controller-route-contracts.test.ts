import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type EnvSnapshot = Record<string, string | undefined>;

const ENV_KEYS = [
  "VLLM_STUDIO_DATA_DIR",
  "VLLM_STUDIO_DB_PATH",
  "VLLM_STUDIO_MODELS_DIR",
  "VLLM_STUDIO_HOST",
  "VLLM_STUDIO_PORT",
  "VLLM_STUDIO_INFERENCE_PORT",
  "VLLM_STUDIO_MOCK_INFERENCE",
  "VLLM_STUDIO_MOCK_MODEL_ID",
  "VLLM_STUDIO_API_KEY",
] as const;

let envSnapshot: EnvSnapshot;
let tempDir: string;

beforeEach(() => {
  envSnapshot = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  tempDir = mkdtempSync(join(tmpdir(), "vllm-studio-controller-test-"));
  Object.assign(process.env, {
    VLLM_STUDIO_DATA_DIR: tempDir,
    VLLM_STUDIO_DB_PATH: join(tempDir, "controller.db"),
    VLLM_STUDIO_MODELS_DIR: join(tempDir, "models"),
    VLLM_STUDIO_HOST: "127.0.0.1",
    VLLM_STUDIO_PORT: "18080",
    VLLM_STUDIO_INFERENCE_PORT: "65534",
    VLLM_STUDIO_MOCK_INFERENCE: "true",
    VLLM_STUDIO_MOCK_MODEL_ID: "mock-model",
  });
  delete process.env.VLLM_STUDIO_API_KEY;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempDir, { recursive: true, force: true });
});

async function createTestApp() {
  const [{ createAppContext }, { createApp }] = await Promise.all([
    import("../../../controller/src/app-context"),
    import("../../../controller/src/http/app"),
  ]);
  const context = createAppContext();
  return createApp(context);
}

describe("controller route contracts", () => {
  test("status route reports no active runtime on an isolated test port", async () => {
    const app = await createTestApp();
    const response = await app.request("/status");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      running: false,
      process: null,
      inference_port: 65534,
      launching: null,
    });
  });

  test("mock inference exposes an OpenAI-compatible model list without a live backend", async () => {
    const app = await createTestApp();
    const response = await app.request("/v1/models");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.object).toBe("list");
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "mock-model",
        object: "model",
        owned_by: "vllm-studio",
        active: true,
      }),
    ]);
  });

  test("invalid controller proxy targets fail before any upstream request is made", async () => {
    const app = await createTestApp();
    const response = await app.request(
      "/controllers/route/status?target=file:///etc/passwd",
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.detail).toBe("target must be an http(s) controller URL");
  });

  test("vram calculator rejects malformed requests with structured errors", async () => {
    const app = await createTestApp();
    const response = await app.request("/vram-calculator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_length: 0 }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.detail).toBe("model is required");
  });
});
