import { createServer } from "node:http";

const port = Number(process.env.PORT) || 43220;
const slowResponseDelayMs = 10_000;
const modelId = process.env.MODEL_ID || "controller-model";

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
}

function latestUserText(payload) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  return contentText(messages.filter((message) => message?.role === "user").at(-1)?.content);
}

function replyFor(text) {
  if (text.includes("goal-complete-marker")) return "Recorded goal work finished. GOAL_COMPLETE";
  if (text.includes("interrupt-now-marker")) return "Steered response acknowledged.";
  if (text.includes("queue-after-marker")) return "Queued response acknowledged.";
  if (text.includes("slow-response-marker")) return "Slow response complete.";
  return "Controller scoped Pi reply.";
}

async function streamCompletion(request, response) {
  const payload = await readJson(request);
  const userText = latestUserText(payload);
  const slow = userText.includes("slow-response-marker");
  if (slow) await new Promise((resolve) => setTimeout(resolve, slowResponseDelayMs));
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const id = `controller-${Date.now()}`;
  const chunks = replyFor(userText).match(/.{1,12}/g) ?? [];
  response.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    })}\n\n`,
  );
  for (const content of chunks) {
    response.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      })}\n\n`,
    );
    if (slow) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  response.write(
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`,
  );
  response.write("data: [DONE]\n\n");
  response.end();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") return json(response, 200, { ok: true });
  if (url.pathname === "/studio/settings" && request.method === "GET") {
    return json(response, 200, {
      config_path: "/tmp/local-studio/config.json",
      persisted: { models_dir: "/models" },
      effective: { models_dir: "/models" },
    });
  }
  if (url.pathname === "/studio/diagnostics") {
    return json(response, 200, {
      app_version: "test",
      timestamp: new Date().toISOString(),
      platform: "darwin",
      arch: "arm64",
      release: "test",
      cpu_model: "Test CPU",
      cpu_cores: 8,
      memory_total: 68_719_476_736,
      memory_free: 34_359_738_368,
      gpus: [{ name: "Test GPU", memory_total_mb: 65_536 }],
      runtime: {
        vllm_installed: false,
        vllm_version: null,
        python_path: null,
        vllm_bin: null,
      },
      disks: [],
      config: {
        host: "127.0.0.1",
        port,
        inference_port: port,
        api_key_configured: false,
        models_dir: "/models",
        data_dir: "/tmp/local-studio",
        db_path: "/tmp/local-studio/test.db",
        sglang_python: null,
        llama_bin: null,
        mlx_python: null,
      },
    });
  }
  if (url.pathname === "/studio/presets") {
    return json(response, 200, { presets: [], max_vram_gb: 64 });
  }
  if (url.pathname === "/studio/downloads") {
    return json(response, 200, { downloads: [] });
  }
  if (url.pathname === "/v1/audio/status") {
    return json(response, 200, {
      status: {
        backend: "chatterbox-turbo",
        package_version: "0.1.7",
        model_revision: "749d1c1a46eb10492095d68fbcf55691ccf137cd",
        install: { phase: "ready", progress: 1, message: "Chatterbox Turbo is ready", error: null },
        worker: { phase: "stopped", queue_depth: 0, error: null },
        gpu: {
          uuid: "GPU-00000000-0000-0000-0000-000000000001",
          name: "Test RTX 3090",
          pci_bus_id: "0000:01:00.0",
        },
        prerequisites: {
          ffmpeg: true,
          python_311: true,
          storage: { available_bytes: 68_719_476_736, required_bytes: 42_949_672_960, ready: true },
        },
        voice_count: 1,
      },
    });
  }
  if (url.pathname === "/v1/audio/voices") {
    return json(response, 200, {
      voices: [
        {
          id: "voice_00000000000000000000000000000001",
          name: "Recorded parity voice",
          duration_ms: 8_000,
          created_at: "2026-08-11T00:00:00.000Z",
        },
      ],
    });
  }
  if (url.pathname === "/runtime/targets") {
    return json(response, 200, { targets: [] });
  }
  if (url.pathname === "/runtime/jobs") {
    return json(response, 200, { jobs: [] });
  }
  if (url.pathname === "/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");
    return;
  }
  if (url.pathname === "/v1/models") {
    return json(response, 200, {
      object: "list",
      data: [{ id: modelId, object: "model" }],
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
