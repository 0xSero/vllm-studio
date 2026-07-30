import { createServer } from "node:http";

const port = Number(process.env.PORT) || 43220;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  for await (const _chunk of request) void _chunk;
}

async function streamCompletion(request, response) {
  await readBody(request);
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const id = `controller-${Date.now()}`;
  const chunks = ["Controller", " scoped", " Pi", " reply."];
  response.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "controller-model",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    })}\n\n`,
  );
  for (const content of chunks) {
    response.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "controller-model",
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`,
    );
  }
  response.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "controller-model",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`,
  );
  response.write("data: [DONE]\n\n");
  response.end();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") return json(response, 200, { ok: true });
  if (url.pathname === "/events") {
    response.writeHead(204);
    return response.end();
  }
  if (url.pathname === "/status") {
    return json(response, 200, {
      running: false,
      process: null,
      inference_port: 8000,
      launching: null,
    });
  }
  if (url.pathname === "/studio/settings") {
    return json(response, 200, {
      config_path: "/tmp/local-studio-e2e.json",
      persisted: { models_dir: null, ui_preferences: {} },
      effective: { models_dir: "/tmp/models" },
    });
  }
  if (url.pathname === "/studio/diagnostics") {
    return json(response, 200, {
      app_version: "2.1.0",
      timestamp: "2026-07-29T12:00:00.000Z",
      platform: "darwin",
      arch: "arm64",
      release: "e2e",
      cpu_model: "Apple Silicon",
      cpu_cores: 12,
      memory_total: 68_719_476_736,
      memory_free: 34_359_738_368,
      gpus: [],
      runtime: {
        vllm_installed: false,
        vllm_version: null,
        python_path: null,
        vllm_bin: null,
      },
      disks: [
        {
          path: "/tmp/models",
          total_bytes: 1_099_511_627_776,
          free_bytes: 549_755_813_888,
          available_bytes: 549_755_813_888,
        },
      ],
      config: { models_dir: "/tmp/models" },
    });
  }
  if (url.pathname === "/studio/downloads") return json(response, 200, { downloads: [] });
  if (url.pathname === "/studio/presets") {
    return json(response, 200, { presets: [], max_vram_gb: 0 });
  }
  if (url.pathname === "/runtime/jobs") return json(response, 200, { jobs: [] });
  if (url.pathname === "/runtime/targets") return json(response, 200, { targets: [] });
  if (url.pathname === "/environment/kubernetes") {
    return json(response, 200, {
      configuration: { enabled: false, api_url: "", token_file: "", ca_file: null },
      probe: {
        state: "unconfigured",
        checked_at: null,
        kubernetes_version: null,
        ray_api_version: null,
        detail: "Kubernetes workload admission is not configured.",
      },
    });
  }
  if (url.pathname === "/ai/v1/health") {
    return json(response, 200, {
      configured: false,
      required: false,
      state: "claimed",
      detail: "Microsoft Foundry is not configured.",
      correlation_ids: [],
      model_count: 0,
      agent_count: 0,
    });
  }
  if (url.pathname === "/workbench/notebooks") {
    return json(response, 200, { notebooks: [] });
  }
  if (url.pathname === "/workbench/ray-jobs") return json(response, 200, { jobs: [] });
  if (url.pathname === "/v1/models") {
    return json(response, 200, {
      object: "list",
      data: [{ id: "controller-model", object: "model" }],
    });
  }
  if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
    return streamCompletion(request, response);
  }
  return json(response, 404, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake controller: http://127.0.0.1:${port}`);
});
