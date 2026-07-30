import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, SignJWT } from "jose";

type CapturedRequest = {
  path: string;
  authorization: string | null;
  model: string | null;
  stream: boolean;
};

const freePort = (): number => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("reserved") });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("Could not allocate a verification port");
  return port;
};

const waitForController = async (url: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Isolated controller did not become ready");
};

const jsonRequest = async (
  url: string,
  path: string,
  init?: RequestInit,
): Promise<{ response: Response; body: Record<string, unknown> }> => {
  const response = await fetch(`${url}${path}`, init);
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
};

test("isolated controller routes keyless and keyed OpenAI providers over real HTTP", async () => {
  const root = mkdtempSync(join(tmpdir(), "local-studio-provider-integration-"));
  const dataDirectory = join(root, "data");
  const modelsDirectory = join(root, "models");
  mkdirSync(dataDirectory, { recursive: true });
  mkdirSync(modelsDirectory, { recursive: true });
  const captured: CapturedRequest[] = [];
  let fallbackHits = 0;
  const fallback = Bun.serve({
    port: 0,
    fetch: () => {
      fallbackHits += 1;
      return Response.json({ data: [{ id: "fallback-model" }] });
    },
  });
  const upstream = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/redirect/v1/models") {
        return Response.redirect(`http://127.0.0.1:${fallback.port}/v1/models`, 302);
      }
      const body =
        request.method === "POST" ? ((await request.json()) as Record<string, unknown>) : {};
      captured.push({
        path: url.pathname,
        authorization: request.headers.get("authorization"),
        model: typeof body["model"] === "string" ? body["model"] : null,
        stream: body["stream"] === true,
      });
      const prefix = url.pathname.split("/")[1] ?? "";
      const model = prefix === "keyed" ? "keyed-model" : "model-a";
      if (url.pathname.endsWith("/v1/models")) {
        return Response.json({ object: "list", data: [{ id: model, object: "model" }] });
      }
      if (url.pathname.endsWith("/v1/chat/completions")) {
        if (body["stream"] === true) {
          return new Response(
            `data: ${JSON.stringify({
              id: "chat",
              choices: [{ index: 0, delta: { content: "4" } }],
            })}\n\ndata: [DONE]\n\n`,
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        return Response.json({
          id: "chat",
          object: "chat.completion",
          model: body["model"],
          choices: [
            { index: 0, finish_reason: "stop", message: { role: "assistant", content: "4" } },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const controllerPort = freePort();
  const controllerUrl = `http://127.0.0.1:${controllerPort}`;
  const controllerEnvironment = {
    ...process.env,
    LOCAL_STUDIO_HOST: "127.0.0.1",
    LOCAL_STUDIO_PORT: String(controllerPort),
    LOCAL_STUDIO_DATA_DIR: dataDirectory,
    LOCAL_STUDIO_MODELS_DIR: modelsDirectory,
    LOCAL_STUDIO_INFERENCE_HOST: "127.0.0.1",
    LOCAL_STUDIO_INFERENCE_PORT: String(fallback.port),
    LOCAL_STUDIO_DISABLE_METRICS: "true",
    LOCAL_STUDIO_PROVIDER_HOST_ALLOWLIST: "127.0.0.1",
    LOCAL_STUDIO_KUBERAY_API_URL: "",
    LOCAL_STUDIO_KUBERAY_TOKEN_FILE: "",
    LOCAL_STUDIO_KUBERAY_CA_FILE: "",
    LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG: "",
  };
  const output: string[] = [];
  let controller = Bun.spawn([process.execPath, "src/main.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: controllerEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const captureOutput = async (process: Bun.Subprocess): Promise<void> => {
    const stdout =
      process.stdout && typeof process.stdout !== "number"
        ? await new Response(process.stdout).text()
        : "";
    const stderr =
      process.stderr && typeof process.stderr !== "number"
        ? await new Response(process.stderr).text()
        : "";
    output.push(stdout, stderr);
  };
  const stopController = async (): Promise<void> => {
    controller.kill("SIGTERM");
    await controller.exited;
    await captureOutput(controller);
  };
  try {
    await waitForController(controllerUrl);
    const initial = await jsonRequest(controllerUrl, "/studio/providers");
    expect(initial.body["providers"]).toEqual([]);

    const probe = await jsonRequest(controllerUrl, "/studio/providers/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "keyless",
        name: "Keyless",
        base_url: `http://127.0.0.1:${upstream.port}/keyless/v1/`,
        authentication: { type: "none" },
      }),
    });
    expect(probe.response.status).toBe(200);
    expect(probe.body).toEqual({ provider: "keyless", models: [{ id: "model-a" }] });
    const afterProbe = await jsonRequest(controllerUrl, "/studio/providers");
    expect(afterProbe.body["providers"]).toEqual([]);

    const created = await jsonRequest(controllerUrl, "/studio/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "keyless",
        name: "Keyless",
        base_url: `http://127.0.0.1:${upstream.port}/keyless`,
        authentication: { type: "none" },
      }),
    });
    expect(created.response.status).toBe(200);
    const providers = await jsonRequest(controllerUrl, "/studio/providers");
    expect((providers.body["providers"] as unknown[]).length).toBe(1);

    const catalog = await jsonRequest(controllerUrl, "/studio/provider-models");
    expect(catalog.body).toEqual({
      providers: [{ provider: "keyless", models: [{ id: "model-a" }] }],
    });
    const models = await jsonRequest(controllerUrl, "/v1/models");
    expect((models.body["data"] as Array<{ id: string }>).map(({ id }) => id)).toContain(
      "keyless/model-a",
    );

    const nonStreaming = await jsonRequest(controllerUrl, "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "keyless/model-a",
        messages: [{ role: "user", content: "Reply with exactly 4." }],
        stream: false,
      }),
    });
    expect(nonStreaming.response.status).toBe(200);
    expect(
      (nonStreaming.body["choices"] as Array<{ message: { content: string } }>)[0]?.message.content,
    ).toBe("4");

    const streaming = await fetch(`${controllerUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "keyless/model-a",
        messages: [{ role: "user", content: "Reply with exactly 4." }],
        stream: true,
      }),
    });
    const streamBody = await streaming.text();
    expect(streaming.status).toBe(200);
    expect(streamBody).toContain('"content":"4"');
    expect(streamBody).toContain("data: [DONE]");

    const secret = "integration-secret-value";
    const keyed = await jsonRequest(controllerUrl, "/studio/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "keyed",
        name: "Keyed",
        base_url: `http://127.0.0.1:${upstream.port}/keyed`,
        api_key: secret,
        authentication: { type: "api_key" },
      }),
    });
    expect(keyed.response.status).toBe(200);
    const keyedChat = await jsonRequest(controllerUrl, "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "keyed/keyed-model",
        messages: [{ role: "user", content: "Reply with exactly 4." }],
      }),
    });
    expect(keyedChat.response.status).toBe(200);

    const disabled = await jsonRequest(controllerUrl, "/studio/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "disabled",
        name: "Disabled",
        base_url: `http://127.0.0.1:${upstream.port}/disabled`,
        enabled: false,
        authentication: { type: "none" },
      }),
    });
    expect(disabled.response.status).toBe(200);
    const fallbackBeforeDenied = fallbackHits;
    for (const model of ["unknown/model-a", "disabled/model-a"]) {
      const denied = await fetch(`${controllerUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "4" }] }),
      });
      expect(denied.status).toBe(404);
    }
    expect(fallbackHits).toBe(fallbackBeforeDenied);

    const redirectProbe = await fetch(`${controllerUrl}/studio/providers/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "redirected",
        name: "Redirected",
        base_url: `http://127.0.0.1:${upstream.port}/redirect`,
        authentication: { type: "none" },
      }),
    });
    expect(redirectProbe.status).toBe(503);
    expect(fallbackHits).toBe(fallbackBeforeDenied);

    const deniedHost = await fetch(`${controllerUrl}/studio/providers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "denied-host",
        name: "Denied host",
        base_url: "http://example.invalid",
        authentication: { type: "none" },
      }),
    });
    expect(deniedHost.status).toBe(400);

    expect(
      captured
        .filter(({ path }) => path.startsWith("/keyless/"))
        .every(({ authorization }) => authorization === null),
    ).toBe(true);
    expect(
      captured.some(
        ({ path, authorization, model }) =>
          path === "/keyed/v1/chat/completions" &&
          authorization === `Bearer ${secret}` &&
          model === "keyed-model",
      ),
    ).toBe(true);

    await stopController();
    const settingsPath = join(dataDirectory, "studio-settings.json");
    const persisted = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      providers: Array<Record<string, unknown>>;
    };
    persisted.providers.push({
      id: "legacy",
      name: "Legacy keyless",
      base_url: `http://127.0.0.1:${upstream.port}/keyless`,
      api_key: "",
      enabled: true,
    });
    writeFileSync(settingsPath, JSON.stringify(persisted, null, 2));
    controller = Bun.spawn([process.execPath, "src/main.ts"], {
      cwd: join(import.meta.dir, ".."),
      env: controllerEnvironment,
      stdout: "pipe",
      stderr: "pipe",
    });
    await waitForController(controllerUrl);
    const restarted = await jsonRequest(controllerUrl, "/studio/providers");
    const legacy = (restarted.body["providers"] as Array<Record<string, unknown>>).find(
      ({ id }) => id === "legacy",
    );
    expect(legacy?.["authentication"]).toEqual({ type: "none" });
    const legacyChat = await jsonRequest(controllerUrl, "/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "legacy/model-a",
        messages: [{ role: "user", content: "Reply with exactly 4." }],
      }),
    });
    expect(legacyChat.response.status).toBe(200);
    await stopController();
    expect(output.join("")).not.toContain(secret);
    const controllerLog = readFileSync(join(dataDirectory, "logs", "vllm_controller.log"), "utf8");
    expect(controllerLog).not.toContain(secret);
  } finally {
    if (controller.exitCode === null) {
      controller.kill("SIGTERM");
      await controller.exited;
    }
    upstream.stop(true);
    fallback.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

test("isolated controller probes and creates an apim_client provider with client_secret", async () => {
  const root = mkdtempSync(join(tmpdir(), "local-studio-apim-integration-"));
  const dataDirectory = join(root, "data");
  const modelsDirectory = join(root, "models");
  mkdirSync(dataDirectory, { recursive: true });
  mkdirSync(modelsDirectory, { recursive: true });
  const keys = await generateKeyPair("RS256");
  const tokenServer = Bun.serve({
    port: 0,
    async fetch() {
      const accessToken = await new SignJWT({
        aud: "api://gateway",
        scp: "models.invoke",
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(keys.privateKey);
      return Response.json({
        access_token: accessToken,
        expires_in: 600,
        token_type: "Bearer",
      });
    },
  });
  let upstreamAuthorization: string | null = null;
  const upstream = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      upstreamAuthorization = request.headers.get("authorization");
      if (url.pathname.endsWith("/v1/models")) {
        return Response.json({ data: [{ id: "gateway-model" }] });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const controllerPort = freePort();
  const controllerUrl = `http://127.0.0.1:${controllerPort}`;
  const controllerEnvironment = {
    ...process.env,
    LOCAL_STUDIO_HOST: "127.0.0.1",
    LOCAL_STUDIO_PORT: String(controllerPort),
    LOCAL_STUDIO_DATA_DIR: dataDirectory,
    LOCAL_STUDIO_MODELS_DIR: modelsDirectory,
    LOCAL_STUDIO_INFERENCE_HOST: "127.0.0.1",
    LOCAL_STUDIO_INFERENCE_PORT: String(upstream.port),
    LOCAL_STUDIO_DISABLE_METRICS: "true",
    LOCAL_STUDIO_PROVIDER_HOST_ALLOWLIST: "127.0.0.1",
    LOCAL_STUDIO_KUBERAY_API_URL: "",
    LOCAL_STUDIO_KUBERAY_TOKEN_FILE: "",
    LOCAL_STUDIO_KUBERAY_CA_FILE: "",
    LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG: "",
  };
  const controller = Bun.spawn([process.execPath, "src/main.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: controllerEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stopController = async (): Promise<void> => {
    controller.kill("SIGTERM");
    await controller.exited;
  };
  try {
    await waitForController(controllerUrl);
    const clientSecret = "apim-client-secret-value";
    const probe = await jsonRequest(controllerUrl, "/studio/providers/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "apim-gw",
        name: "APIM Gateway",
        base_url: `http://127.0.0.1:${upstream.port}/v1`,
        client_secret: clientSecret,
        authentication: {
          type: "apim_client",
          issuer_id: "issuer-01",
          audience: "api://gateway",
          scopes: ["models.invoke"],
          token_endpoint: `http://127.0.0.1:${tokenServer.port}`,
          client_id: "local-studio",
        },
      }),
    });
    expect(probe.response.status).toBe(200);
    expect(probe.body).toEqual({ provider: "apim-gw", models: [{ id: "gateway-model" }] });
    expect(upstreamAuthorization).toMatch(/^Bearer /);
    expect(upstreamAuthorization).not.toContain(clientSecret);

    const created = await jsonRequest(controllerUrl, "/studio/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "apim-gw",
        name: "APIM Gateway",
        base_url: `http://127.0.0.1:${upstream.port}/v1`,
        client_secret: clientSecret,
        authentication: {
          type: "apim_client",
          issuer_id: "issuer-01",
          audience: "api://gateway",
          scopes: ["models.invoke"],
          token_endpoint: `http://127.0.0.1:${tokenServer.port}`,
          client_id: "local-studio",
        },
      }),
    });
    expect(created.response.status).toBe(200);
    const providerBody = created.body["provider"] as Record<string, unknown>;
    const auth = providerBody["authentication"] as Record<string, unknown>;
    expect(auth["type"]).toBe("apim_client");
    expect(auth["issuer_id"]).toBe("issuer-01");
    expect(auth["audience"]).toBe("api://gateway");
    expect(auth["client_id"]).toBe("local-studio");
    expect(auth["token_endpoint"]).toBe(`http://127.0.0.1:${tokenServer.port}`);
    expect(auth).not.toHaveProperty("client_secret");
    expect(auth["client_secret_ref"]).toMatch(/^provider:apim-gw:client-secret:/u);

    await stopController();
    const settingsPath = join(dataDirectory, "studio-settings.json");
    const persisted = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      providers: Array<Record<string, unknown>>;
    };
    const persistedProvider = persisted.providers.find((p) => p["id"] === "apim-gw");
    expect(persistedProvider).toBeDefined();
    const persistedAuth = persistedProvider?.["authentication"] as Record<string, unknown>;
    expect(persistedAuth["client_secret_ref"]).toMatch(/^provider:apim-gw:client-secret:/u);
    const settingsJson = readFileSync(settingsPath, "utf8");
    expect(settingsJson).not.toContain(clientSecret);
  } finally {
    if (controller.exitCode === null) {
      controller.kill("SIGTERM");
      await controller.exited;
    }
    tokenServer.stop(true);
    upstream.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
