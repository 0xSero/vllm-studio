import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { type AppContext, AppContextService } from "../src/app-context";
import type { ProviderConfig } from "../src/config/persisted-config";
import { createControllerRuntime, type ControllerRuntime } from "../src/core/effect-runtime";
import { createApp } from "../src/http/app";
import { parseRecipe } from "../src/modules/models/recipes/recipe-serializer";
import { LaneSwitchService } from "../src/modules/studio/lane-switch";

const apiKey = "lane-chat-gate-key";
const environmentKeys = [
  "HOME",
  "PI_CODING_AGENT_DIR",
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_CORS_ORIGINS",
  "LOCAL_STUDIO_DISABLE_METRICS",
  "LOCAL_STUDIO_INFERENCE_HOST",
  "LOCAL_STUDIO_INFERENCE_PORT",
  "LOCAL_STUDIO_OMLX_PORT",
  "LOCAL_STUDIO_DS4_PORT",
] as const;

type EnvironmentKey = (typeof environmentKeys)[number];
type ChatErrorBody = {
  error?: { code?: string; type?: string; message?: string };
  detail?: string;
};

const unusedPort = (): number => {
  const server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("expected an ephemeral port");
  return port;
};

const chatCompletion = (content: string) => ({
  id: "chatcmpl-lane-gate",
  object: "chat.completion",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const writeScript = (directory: string, name: string, body: string): void => {
  const path = join(directory, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

const previousEnvironment = new Map<EnvironmentKey, string | undefined>();
let temporaryDirectory = "";
let scriptsDirectory = "";
let runtime: ControllerRuntime;
let context: AppContext;
let app: ReturnType<typeof createApp>;
let injectedSwitch: LaneSwitchService | null = null;
let omlxPort = 0;
let ds4Port = 0;
let amdPort = 0;
let inferencePort = 0;
let omlxServer: ReturnType<typeof Bun.serve> | null = null;
let ds4Server: ReturnType<typeof Bun.serve> | null = null;
let amdServer: ReturnType<typeof Bun.serve> | null = null;
let inferenceServer: ReturnType<typeof Bun.serve> | null = null;
const omlxChatModels: string[] = [];
const ds4ChatModels: string[] = [];
const amdChatModels: string[] = [];
const inferenceChatModels: string[] = [];

const authHeaders = { "x-api-key": apiKey, "content-type": "application/json" };

const providers = (): ProviderConfig[] => [
  {
    id: "omlx",
    name: "oMLX",
    base_url: `http://127.0.0.1:${omlxPort}`,
    api_key: "omlx-key",
    enabled: true,
  },
  {
    id: "ds4",
    name: "ds4",
    base_url: `http://127.0.0.1:${ds4Port}`,
    api_key: "ds4-key",
    enabled: true,
  },
  {
    id: "amd",
    name: "AMD",
    base_url: `http://127.0.0.1:${amdPort}`,
    api_key: "amd-key",
    enabled: true,
  },
];

const laneHandler =
  (lane: "omlx" | "ds4", sink: string[]) =>
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v1/models") {
      return Response.json({ data: [{ id: lane === "omlx" ? "laguna-s-2.1" : "deepseek-v4-flash" }] });
    }
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const body = (await request.json()) as { model?: string };
      sink.push(typeof body.model === "string" ? body.model : "");
      return Response.json(chatCompletion(lane));
    }
    return new Response(null, { status: 404 });
  };

const stopServer = (server: ReturnType<typeof Bun.serve> | null): null => {
  server?.stop(true);
  return null;
};

const serveOmlx = (): void => {
  omlxServer = stopServer(omlxServer);
  omlxServer = Bun.serve({ port: omlxPort, fetch: laneHandler("omlx", omlxChatModels) });
};

const serveDs4 = (): void => {
  ds4Server = stopServer(ds4Server);
  ds4Server = Bun.serve({ port: ds4Port, fetch: laneHandler("ds4", ds4ChatModels) });
};

const stopOmlx = (): void => {
  omlxServer = stopServer(omlxServer);
};

const stopDs4 = (): void => {
  ds4Server = stopServer(ds4Server);
};

const chat = (model: string, extra: Record<string, unknown> = {}) =>
  app.request("/v1/chat/completions", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      ...extra,
    }),
  });

const expectLaneCode = async (response: Response, code: string): Promise<void> => {
  expect(response.status).toBe(503);
  const body = (await response.json()) as ChatErrorBody;
  expect(body.error?.code).toBe(code);
  expect(body.error?.type).toBe(code);
  expect(body.detail).toBe(
    code === "lane_switch_in_progress" ? "Lane switch in progress." : "Lane is not resident.",
  );
};

const installLaneSwitch = async (enabled: boolean, ds4Script = "#!/bin/bash\nexit 0\n") => {
  if (injectedSwitch) {
    await Effect.runPromise(injectedSwitch.shutdown());
    injectedSwitch = null;
  }
  writeScript(scriptsDirectory, "switch-to-ds4.sh", ds4Script);
  writeScript(scriptsDirectory, "switch-to-laguna.sh", "#!/bin/bash\nexit 0\n");
  const service = new LaneSwitchService({
    logger: context.logger,
    eventManager: context.eventManager,
    getProviders: () => context.config.providers,
    config: {
      enabled,
      scriptsDirectory,
      omlxPort,
      ds4Port,
      lanePath: null,
    },
    probeCacheMs: 0,
    probeTimeoutMs: 80,
  });
  context.laneSwitch = service;
  injectedSwitch = service;
  return service;
};

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "lane-chat-gate-"));
  scriptsDirectory = join(temporaryDirectory, "scripts");
  mkdirSync(scriptsDirectory, { recursive: true });
  writeScript(scriptsDirectory, "switch-to-ds4.sh", "#!/bin/bash\nexit 0\n");
  writeScript(scriptsDirectory, "switch-to-laguna.sh", "#!/bin/bash\nexit 0\n");
  omlxPort = unusedPort();
  ds4Port = unusedPort();
  amdPort = unusedPort();
  inferencePort = unusedPort();
  for (const key of environmentKeys) previousEnvironment.set(key, process.env[key]);
  process.env["HOME"] = join(temporaryDirectory, "home");
  process.env["PI_CODING_AGENT_DIR"] = join(temporaryDirectory, "pi");
  process.env["LOCAL_STUDIO_DATA_DIR"] = join(temporaryDirectory, "data");
  process.env["LOCAL_STUDIO_MODELS_DIR"] = join(temporaryDirectory, "models");
  process.env["LOCAL_STUDIO_API_KEY"] = apiKey;
  process.env["LOCAL_STUDIO_CORS_ORIGINS"] = "https://allowed.example";
  process.env["LOCAL_STUDIO_DISABLE_METRICS"] = "true";
  process.env["LOCAL_STUDIO_INFERENCE_HOST"] = "127.0.0.1";
  process.env["LOCAL_STUDIO_INFERENCE_PORT"] = String(inferencePort);
  process.env["LOCAL_STUDIO_OMLX_PORT"] = String(omlxPort);
  process.env["LOCAL_STUDIO_DS4_PORT"] = String(ds4Port);
  runtime = createControllerRuntime();
  context = await runtime.runPromise(AppContextService);
  context.config.providers = providers();
  app = createApp(context, runtime);
  serveOmlx();
  serveDs4();
  amdServer = Bun.serve({
    port: amdPort,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        const body = (await request.json()) as { model?: string };
        amdChatModels.push(typeof body.model === "string" ? body.model : "");
        return Response.json(chatCompletion("amd"));
      }
      return new Response(null, { status: 404 });
    },
  });
  inferenceServer = Bun.serve({
    port: inferencePort,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        const body = (await request.json()) as { model?: string };
        inferenceChatModels.push(typeof body.model === "string" ? body.model : "");
        return Response.json(chatCompletion("inference"));
      }
      return new Response(null, { status: 404 });
    },
  });
});

afterAll(async () => {
  if (injectedSwitch) await Effect.runPromise(injectedSwitch.shutdown());
  omlxServer = stopServer(omlxServer);
  ds4Server = stopServer(ds4Server);
  amdServer = stopServer(amdServer);
  inferenceServer = stopServer(inferenceServer);
  await runtime.dispose();
  for (const key of environmentKeys) {
    const value = previousEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("exclusive-lane chat gate (flag off)", () => {
  beforeAll(async () => {
    await installLaneSwitch(false);
    context.config.providers = providers();
    serveOmlx();
    serveDs4();
  });

  test("does not 503 exclusive ids and still routes to the provider", async () => {
    omlxChatModels.length = 0;
    const response = await chat("omlx/laguna-s-2.1");
    expect(response.status).toBe(200);
    expect(omlxChatModels).toEqual(["laguna-s-2.1"]);
    const body = (await response.json()) as ChatErrorBody;
    expect(body.error?.code).toBeUndefined();
  });

  test("does not 503 user-pi exclusive ids", async () => {
    const response = await chat("user-pi-ds4/deepseek-v4-flash");
    expect(response.status).not.toBe(503);
    const body = (await response.json()) as ChatErrorBody;
    expect(body.error?.code).not.toBe("lane_not_resident");
    expect(body.error?.code).not.toBe("lane_switch_in_progress");
  });
});

describe("exclusive-lane chat gate (flag on)", () => {
  beforeAll(async () => {
    await installLaneSwitch(true);
    context.config.providers = providers();
  });

  beforeEach(() => {
    context.config.providers = providers();
    omlxChatModels.length = 0;
    ds4ChatModels.length = 0;
    amdChatModels.length = 0;
    inferenceChatModels.length = 0;
  });

  afterEach(async () => {
    await Effect.runPromise(context.laneSwitch.waitForCurrentRun());
    await installLaneSwitch(true);
  });

  test("503s lane_switch_in_progress while the slot is running", async () => {
    stopOmlx();
    stopDs4();
    await installLaneSwitch(true, "#!/bin/bash\nsleep 2\nexit 0\n");
    const accepted = await Effect.runPromise(context.laneSwitch.accept("ds4"));
    expect(accepted.kind).toBe("accepted");
    await expectLaneCode(await chat("omlx/laguna-s-2.1"), "lane_switch_in_progress");
    await expectLaneCode(await chat("ds4/deepseek-v4-flash"), "lane_switch_in_progress");
    await expectLaneCode(
      await chat("user-pi-omlx/laguna-s-2.1"),
      "lane_switch_in_progress",
    );
    const streaming = await chat("ds4/deepseek-v4-flash", { stream: true });
    await expectLaneCode(streaming, "lane_switch_in_progress");
  });

  test("does not gate AMD or unprefixed recipes while a switch is running", async () => {
    stopOmlx();
    stopDs4();
    await installLaneSwitch(true, "#!/bin/bash\nsleep 2\nexit 0\n");
    const accepted = await Effect.runPromise(context.laneSwitch.accept("ds4"));
    expect(accepted.kind).toBe("accepted");
    const amd = await chat("amd/AMD-qwen3.8-27b");
    expect(amd.status).toBe(200);
    expect(amdChatModels).toEqual(["AMD-qwen3.8-27b"]);
    const recipe = await chat("unprefixed-recipe");
    expect(recipe.status).toBe(200);
    expect(inferenceChatModels).toEqual(["unprefixed-recipe"]);
  });

  test("503s lane_not_resident when no exclusive lane answers", async () => {
    stopOmlx();
    stopDs4();
    await expectLaneCode(await chat("omlx/laguna-s-2.1"), "lane_not_resident");
    await expectLaneCode(await chat("ds4/deepseek-v4-flash"), "lane_not_resident");
    expect(inferenceChatModels).toEqual([]);
  });

  test("503s lane_not_resident when the other exclusive lane is resident", async () => {
    stopOmlx();
    serveDs4();
    await expectLaneCode(await chat("omlx/laguna-s-2.1"), "lane_not_resident");
    expect(ds4ChatModels).toEqual([]);
  });

  test("503s lane_not_resident on conflict because resident_lane matches neither id", async () => {
    serveOmlx();
    serveDs4();
    await expectLaneCode(await chat("omlx/laguna-s-2.1"), "lane_not_resident");
    await expectLaneCode(await chat("ds4/deepseek-v4-flash"), "lane_not_resident");
    expect(omlxChatModels).toEqual([]);
    expect(ds4ChatModels).toEqual([]);
  });

  test("503s lane_not_resident when the lane is resident but providerRouting is null", async () => {
    serveOmlx();
    stopDs4();
    const omlx = context.config.providers.find((provider) => provider.id === "omlx");
    if (!omlx) throw new Error("expected omlx provider");
    omlx.enabled = false;
    await expectLaneCode(await chat("omlx/laguna-s-2.1"), "lane_not_resident");
    expect(omlxChatModels).toEqual([]);
    expect(inferenceChatModels).toEqual([]);
    omlx.enabled = true;
    omlx.api_key = "";
    await expectLaneCode(await chat("omlx/laguna-s-2.1"), "lane_not_resident");
    expect(inferenceChatModels).toEqual([]);
  });

  test("routes exclusive chat to the provider base_url when resident and not switching", async () => {
    serveOmlx();
    stopDs4();
    const response = await chat("omlx/laguna-s-2.1");
    expect(response.status).toBe(200);
    expect(omlxChatModels).toEqual(["laguna-s-2.1"]);
    expect(inferenceChatModels).toEqual([]);
    const payload = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    expect(payload.choices[0]?.message.content).toBe("omlx");
  });

  test("routes ds4 chat when ds4 is resident with providerRouting", async () => {
    stopOmlx();
    serveDs4();
    const response = await chat("ds4/deepseek-v4-flash");
    expect(response.status).toBe(200);
    expect(ds4ChatModels).toEqual(["deepseek-v4-flash"]);
    expect(inferenceChatModels).toEqual([]);
  });

  test("classifies user-pi exclusive ids and does not fall through to :8000", async () => {
    serveOmlx();
    stopDs4();
    await expectLaneCode(await chat("user-pi-omlx/laguna-s-2.1"), "lane_not_resident");
    await expectLaneCode(await chat("user-pi-ds4/deepseek-v4-flash"), "lane_not_resident");
    expect(inferenceChatModels).toEqual([]);
    expect(omlxChatModels).toEqual([]);
  });

  test("classifies the original model string before recipe rewrite", async () => {
    serveOmlx();
    stopDs4();
    await runtime.runPromise(
      context.stores.recipeStore.save(
        parseRecipe({
          id: "omlx/laguna-s-2.1",
          name: "Exclusive collision",
          model_path: "/models/exclusive-collision",
          backend: "vllm",
          served_model_name: "rewritten-recipe",
        }),
      ),
    );
    try {
      const response = await chat("omlx/laguna-s-2.1");
      await expectLaneCode(response, "lane_not_resident");
      expect(inferenceChatModels).toEqual([]);
      expect(omlxChatModels).toEqual([]);
    } finally {
      await runtime.runPromise(context.stores.recipeStore.delete("omlx/laguna-s-2.1"));
    }
  });

  test("503s lane_switch_in_progress while restoring", async () => {
    serveOmlx();
    stopDs4();
    writeScript(scriptsDirectory, "switch-to-ds4.sh", "#!/bin/bash\nexit 1\n");
    writeScript(scriptsDirectory, "switch-to-laguna.sh", "#!/bin/bash\nsleep 2\nexit 0\n");
    const accepted = await Effect.runPromise(context.laneSwitch.accept("ds4"));
    expect(accepted.kind).toBe("accepted");
    const deadline = Date.now() + 2_000;
    while (context.laneSwitch.jobSnapshot().state !== "restoring") {
      if (Date.now() > deadline) {
        throw new Error(`expected restoring, got ${context.laneSwitch.jobSnapshot().state}`);
      }
      await Bun.sleep(10);
    }
    await expectLaneCode(await chat("omlx/laguna-s-2.1"), "lane_switch_in_progress");
  });
});
