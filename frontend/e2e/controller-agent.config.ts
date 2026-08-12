import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const frontendPort = 43_220;
const runtimePort = 43_221;
const controllerPort = 43_222;
const secondaryControllerPort = 43_223;
const baseURL = `http://127.0.0.1:${frontendPort}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "local-studio-controller-e2e-data-"));
const homeDir = mkdtempSync(path.join(os.tmpdir(), "local-studio-controller-e2e-home-"));
const kittylitterBin = path.join(homeDir, "kittylitter");
writeFileSync(
  kittylitterBin,
  `#!/bin/sh
printf '%s\\n' '{"v":1,"node_id":"test-node","token":"test-token","host_name":"test-host","relay":null}'
`,
);
chmodSync(kittylitterBin, 0o755);
writeFileSync(
  path.join(dataDir, "api-settings.json"),
  JSON.stringify({ backendUrl: `http://127.0.0.1:${controllerPort}`, apiKey: "" }),
);
const piAgentDir = path.join(homeDir, ".pi", "agent");
mkdirSync(piAgentDir, { recursive: true });
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
const projectScript = path.resolve(__dirname, "..", "..", "scripts", "project.mjs");
const resourcesPath = path.resolve(__dirname, "..");

export default defineConfig({
  metadata: { localStudioDataDir: dataDir },
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
        `PORT=${frontendPort}`,
        `HOME=${homeDir}`,
        `LOCAL_STUDIO_AGENT_RUNTIME_URL=http://127.0.0.1:${runtimePort}`,
        `LOCAL_STUDIO_DATA_DIR=${dataDir}`,
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
