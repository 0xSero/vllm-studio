import { afterEach, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
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
  "VLLM_STUDIO_RUNTIME_SKIP_DOCKER",
  "VLLM_STUDIO_RUNTIME_SKIP_SYSTEM",
  "VLLM_STUDIO_LLAMA_BIN",
  "VLLM_STUDIO_SGLANG_PYTHON",
  "VLLM_STUDIO_MLX_PYTHON",
  "PI_CODING_AGENT_DIR",
] as const;

let envSnapshot: EnvSnapshot;
export let tempDir: string;

export type ControllerRequestRow = {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  success: number;
  error_class: string | null;
  error_message: string | null;
  user_agent: string | null;
};

export type ControllerFunctionCallRow = {
  function_name: string;
  duration_ms: number;
  success: number;
  error_class: string | null;
  error_message: string | null;
};

export function registerControllerTestLifecycle() {
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
      VLLM_STUDIO_RUNTIME_SKIP_DOCKER: "1",
      VLLM_STUDIO_RUNTIME_SKIP_SYSTEM: "1",
      PI_CODING_AGENT_DIR: join(tempDir, "pi-agent"),
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
}

export async function createTestApp() {
  const { app } = await createTestHarness();
  return app;
}

export async function createTestHarness() {
  const [{ createAppContext }, { createApp }] = await Promise.all([
    import("../../../controller/src/app-context"),
    import("../../../controller/src/http/app"),
  ]);
  const context = createAppContext();
  return { app: createApp(context), context };
}

export function readControllerRequestRows(): ControllerRequestRow[] {
  const dbPath = process.env.VLLM_STUDIO_DB_PATH;
  if (!dbPath) throw new Error("VLLM_STUDIO_DB_PATH is required for tests");
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query<ControllerRequestRow, []>(
        `SELECT method, path, status, duration_ms, success, error_class, error_message, user_agent
         FROM controller_requests
         ORDER BY id ASC`,
      )
      .all();
  } finally {
    db.close();
  }
}

export function readControllerFunctionCallRows(): ControllerFunctionCallRow[] {
  const dbPath = process.env.VLLM_STUDIO_DB_PATH;
  if (!dbPath) throw new Error("VLLM_STUDIO_DB_PATH is required for tests");
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query<ControllerFunctionCallRow, []>(
        `SELECT function_name, duration_ms, success, error_class, error_message
         FROM controller_function_calls
         ORDER BY id ASC`,
      )
      .all();
  } finally {
    db.close();
  }
}

export async function collectSseJson(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map(
      (line) =>
        JSON.parse(line.slice("data: ".length)) as Record<string, unknown>,
    );
}
