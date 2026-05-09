import { expect, test, type Page } from "@playwright/test";

async function mockAppApis(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("vllm-studio-setup-complete", "true");
    window.localStorage.setItem("vllmstudio_backend_url", "http://127.0.0.1:8080");
    window.localStorage.setItem(
      "vllm-studio.controllers",
      JSON.stringify(["http://127.0.0.1:8081"]),
    );
  });

  await page.route("**/api/settings", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        backendUrl: "http://127.0.0.1:8080",
        apiKey: "",
        hasApiKey: false,
        voiceUrl: "",
        voiceModel: "whisper-large-v3-turbo",
      }),
    });
  });
  await page.route("**/api/agent/projects", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projects: [
          {
            id: "project-1",
            name: "Fixture project",
            path: "/tmp/fixture-project",
            addedAt: "2026-05-09T00:00:00.000Z",
            exists: true,
            hasGit: false,
            branch: null,
          },
        ],
      }),
    });
  });
  await page.route("**/api/agent/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          {
            id: "test-model",
            name: "test-model",
            provider: "vllm-studio",
            contextWindow: 32768,
            maxTokens: 4096,
            reasoning: false,
            active: true,
          },
        ],
      }),
    });
  });
  await page.route("**/api/agent/setup-checks", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        checks: [
          { id: "pi", label: "Pi agent binary", ok: true, value: "/usr/bin/pi", guidance: "ok" },
        ],
      }),
    });
  });
  await page.route("**/api/agent/plugins", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        plugins: [
          {
            id: "browser-use",
            name: "browser-use",
            path: "/tmp/browser-use",
            installed: true,
            enabled: true,
          },
          {
            id: "computer-use",
            name: "computer-use",
            path: "/tmp/computer-use",
            installed: true,
            enabled: true,
          },
        ],
        validation: { browserUseAvailable: true, computerUseAvailable: true },
      }),
    });
  });
  await page.route("**/api/agent/skills", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        skills: [{ id: "skill:test", name: "test skill", source: "~/.codex", path: "/tmp/skill" }],
      }),
    });
  });
  await page.route("**/api/agent/sessions/all**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sessions: [] }),
    });
  });

  await page.route("**/api/proxy/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ running: false, process: null, inference_port: 8000 }),
    });
  });
  await page.route("**/api/proxy/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        config: {
          host: "127.0.0.1",
          port: 8080,
          inference_port: 8000,
          models_dir: "/models",
          data_dir: "/data",
          db_path: "/data/controller.db",
          api_key_configured: false,
        },
        environment: {
          controller_url: "http://127.0.0.1:8080",
          inference_url: "http://127.0.0.1:8000",
          frontend_url: "http://localhost:3001",
        },
        runtime: {
          platform: { kind: "unknown" },
          gpus: { count: 0, types: [] },
          cuda: {},
        },
        services: [],
      }),
    });
  });
  await page.route("**/api/proxy/compat", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ checks: [] }) });
  });
  await page.route("**/api/proxy/logs", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sessions: [{ id: "controller", model: "test-model" }] }),
    });
  });
  await page.route("**/api/proxy/logs/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ logs: ["controller booted", "ready"] }),
    });
  });
  await page.route("**/api/proxy/gpus", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ gpus: [] }) });
  });
  await page.route("**/api/proxy/v1/metrics/vllm", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generation_throughput: 12, prompt_throughput: 44, avg_ttft_ms: 88 }),
    });
  });
  await page.route("**/api/proxy/studio/downloads", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ downloads: [] }),
    });
  });
  await page.route("**/api/proxy/studio/models", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ models: [] }) });
  });
  await page.route("**/api/proxy/studio/recommendations", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ recommendations: [], max_vram_gb: 0 }),
    });
  });
  await page.route("**/api/proxy/runtime/targets", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ targets: [] }) });
  });
  await page.route("**/api/proxy/v1/huggingface/models**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          _id: "Qwen/Qwen3.6-27B",
          modelId: "Qwen/Qwen3.6-27B",
          downloads: 100,
          likes: 10,
          tags: ["text-generation"],
          private: false,
        },
      ]),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockAppApis(page);
});

test("agent new chat surface renders with composer guidance", async ({ page }) => {
  await page.goto("/agent?new=1");
  await expect(page.getByText("A dream is something you do for yourself")).toBeVisible();
  await expect(page.getByPlaceholder(/Ask test-model/)).toBeVisible();
});

test("agent composer loads plugins with @ and skills with $ as tabs", async ({ page }) => {
  await page.goto("/agent?new=1");
  const composer = page.getByPlaceholder(/Ask test-model/);
  await composer.fill("@");
  await page.getByRole("button", { name: /@browser-use/ }).click();
  await expect(page.getByRole("button", { name: "Unload @browser-use" })).toBeVisible();

  await composer.fill("$test");
  await page.getByRole("button", { name: /\$test skill/ }).click();
  await expect(page.getByRole("button", { name: "Unload $test skill" })).toBeVisible();
});

test("settings exposes archive, plugin, skill, setup, and controller surfaces", async ({
  page,
}) => {
  await page.goto("/settings#plugins");
  await expect(page.getByText("Plugin registry")).toBeVisible();
  await expect(page.getByText("Computer-use", { exact: true })).toBeVisible();
  await expect(page.getByText("Browser-use", { exact: true })).toBeVisible();

  await page.goto("/settings#skills");
  await expect(page.getByText("test skill")).toBeVisible();

  await page.goto("/settings#setup");
  await expect(page.getByText("Controller connection")).toBeVisible();
});

test("models page exposes search, running models, and downloads sections", async ({ page }) => {
  await page.goto("/recipes");
  await expect(page.getByRole("button", { name: "Search Models" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Current Running Models" })).toBeVisible();
  await page.getByRole("button", { name: "Downloads" }).click();
  await expect(page.getByText("No downloads")).toBeVisible();
});

test("server page exposes health, logs, and API docs tab", async ({ page }) => {
  await page.goto("/server");
  await expect(page.getByText("Server Health")).toBeVisible();
  await expect(page.getByText("Server Logs")).toBeVisible();
  await page.getByRole("button", { name: "API Docs" }).click();
  await expect(page.getByText("OpenAPI reference")).toBeVisible();
});
