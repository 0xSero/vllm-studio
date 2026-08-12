import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const frontendPort = 43_220;
const runtimePort = 43_221;
const controllerPort = 43_222;
const secondaryControllerPort = 43_223;
const recordedControllerPort = 43_224;
const baseURL = `http://127.0.0.1:${frontendPort}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "local-studio-controller-e2e-data-"));
const homeDir = mkdtempSync(path.join(os.tmpdir(), "local-studio-controller-e2e-home-"));
const recordedControllerDir = mkdtempSync(
  path.join(os.tmpdir(), "local-studio-recorded-controller-"),
);
const kittylitterBin = path.join(homeDir, "kittylitter");
writeFileSync(
  kittylitterBin,
  `#!/bin/sh
printf '%s\\n' '{"v":1,"node_id":"test-node","token":"test-token","host_name":"test-host","relay":null}'
`,
);
chmodSync(kittylitterBin, 0o755);
const recordedRuntime = (name: string, version: string): string => {
  const executable = path.join(recordedControllerDir, name);
  writeFileSync(
    executable,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'Python 3.12.0'
else
  printf '%s\\n' '${JSON.stringify({ version, python: executable })}'
fi
`,
  );
  chmodSync(executable, 0o755);
  return executable;
};
const recordedVllmPython = recordedRuntime("vllm-python", "0.9.1");
const recordedSglangPython = recordedRuntime("sglang-python", "0.4.2");
const recordedMlxPython = recordedRuntime("mlx-python", "0.26.0");
const recordedLlama = path.join(recordedControllerDir, "llama-server");
writeFileSync(recordedLlama, "#!/bin/sh\nprintf '%s\\n' 'version: 4321 (recorded)'\n");
chmodSync(recordedLlama, 0o755);
writeFileSync(
  path.join(dataDir, "api-settings.json"),
  JSON.stringify({ backendUrl: `http://127.0.0.1:${controllerPort}`, apiKey: "" }),
);
const piAgentDir = path.join(homeDir, ".pi", "agent");
mkdirSync(piAgentDir, { recursive: true });
const recordedSkillDir = path.join(homeDir, ".codex", "skills", "recorded-resource");
mkdirSync(recordedSkillDir, { recursive: true });
writeFileSync(
  path.join(recordedSkillDir, "SKILL.md"),
  `---
name: recorded-resource
description: Recorded integration resource
---

# Recorded resource

This instruction proves the discovered skill detail flow.
`,
);
writeFileSync(
  path.join(piAgentDir, "models.json"),
  JSON.stringify({
    providers: {
      personal: {
        baseUrl: `http://127.0.0.1:${controllerPort}/v1`,
        api: "openai-completions",
        models: [
          {
            id: "other-model",
            name: "Other model",
            reasoning: false,
            input: ["text"],
            contextWindow: 32_000,
            maxTokens: 8_000,
          },
        ],
      },
    },
  }),
);
const controllerScript = path.resolve(__dirname, "fixtures", "fake-controller.mjs");
const recordedControllerScript = path.resolve(
  __dirname,
  "..",
  "..",
  "controller",
  "src",
  "main.ts",
);
const projectScript = path.resolve(__dirname, "..", "..", "scripts", "project.mjs");
const resourcesPath = path.resolve(__dirname, "..");

export default defineConfig({
  metadata: {
    localStudioDataDir: dataDir,
    localStudioHomeDir: homeDir,
    recordedControllerPort,
  },
  testDir: ".",
  testMatch: ["controller-agent.spec.ts"],
  outputDir: "../test-results/controller-agent",
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: {
      mode: "on",
      size: { width: 1440, height: 960 },
      show: {
        actions: { duration: 650, position: "bottom-right", fontSize: 14 },
        test: { level: "step", position: "top-left", fontSize: 14 },
      },
    },
  },
  webServer: [
    {
      command: `PORT=${controllerPort} node ${controllerScript}`,
      url: `http://127.0.0.1:${controllerPort}/health`,
      timeout: 15_000,
      reuseExistingServer: false,
    },
    {
      command: `PORT=${secondaryControllerPort} MODEL_ID=secondary-model node ${controllerScript}`,
      url: `http://127.0.0.1:${secondaryControllerPort}/health`,
      timeout: 15_000,
      reuseExistingServer: false,
    },
    {
      command: [
        "LOCAL_STUDIO_HOST=127.0.0.1",
        `LOCAL_STUDIO_PORT=${recordedControllerPort}`,
        `LOCAL_STUDIO_INFERENCE_PORT=${recordedControllerPort + 1}`,
        `LOCAL_STUDIO_DATA_DIR=${recordedControllerDir}`,
        `LOCAL_STUDIO_MODELS_DIR=${path.join(recordedControllerDir, "models")}`,
        `LOCAL_STUDIO_RUNTIME_PYTHON=${recordedVllmPython}`,
        `LOCAL_STUDIO_SGLANG_PYTHON=${recordedSglangPython}`,
        `LOCAL_STUDIO_MLX_PYTHON=${recordedMlxPython}`,
        `LOCAL_STUDIO_LLAMA_BIN=${recordedLlama}`,
        "LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM=1",
        "LOCAL_STUDIO_RUNTIME_SKIP_DOCKER=1",
        "LOCAL_STUDIO_DISABLE_METRICS=1",
        `bun ${recordedControllerScript}`,
      ].join(" "),
      url: `http://127.0.0.1:${recordedControllerPort}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: [
        `PORT=${frontendPort}`,
        `HOME=${homeDir}`,
        `LOCAL_STUDIO_AGENT_RUNTIME_URL=http://127.0.0.1:${runtimePort}`,
        `LOCAL_STUDIO_DATA_DIR=${dataDir}`,
        `PI_CODING_AGENT_DIR=${path.join(dataDir, "pi-agent")}`,
        `LOCAL_STUDIO_RESOURCES_PATH=${resourcesPath}`,
        `KITTYLITTER_BIN=${kittylitterBin}`,
        `node ${projectScript} start`,
      ].join(" "),
      url: `${baseURL}/api/desktop-health`,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
