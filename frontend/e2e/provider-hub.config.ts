import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const frontendPort = 43_216;
const runtimePort = 43_217;
const cloudPort = 43_213;
const baseURL = `http://127.0.0.1:${frontendPort}`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "local-studio-e2e-providers-"));
const homeDir = mkdtempSync(path.join(os.tmpdir(), "local-studio-e2e-home-"));
writeFileSync(path.join(dataDir, "api-settings.json"), "{}\n");
const providersModule = path.resolve(__dirname, "fixtures", "e2e-providers.mjs");
const fakeCloudScript = path.resolve(__dirname, "fixtures", "fake-cloud.mjs");
const projectScript = path.resolve(__dirname, "..", "..", "scripts", "project.mjs");

export default defineConfig({
  testDir: ".",
  testMatch: ["provider-hub.spec.ts"],
  outputDir: "../test-results/provider-hub",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  expect: { timeout: 10_000 },
  timeout: 120_000,
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
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
      command: `PORT=${cloudPort} node ${fakeCloudScript}`,
      url: `http://127.0.0.1:${cloudPort}/health`,
      timeout: 15_000,
      reuseExistingServer: false,
    },
    {
      command: [
        `PORT=${frontendPort}`,
        `HOME=${homeDir}`,
        `LOCAL_STUDIO_AGENT_RUNTIME_URL=http://127.0.0.1:${runtimePort}`,
        `LOCAL_STUDIO_DATA_DIR=${dataDir}`,
        `LOCAL_STUDIO_E2E_PROVIDERS=${providersModule}`,
        `LOCAL_STUDIO_E2E_FAKE_CLOUD=http://127.0.0.1:${cloudPort}`,
        "PI_OFFLINE=1",
        `node ${projectScript} start`,
      ].join(" "),
      url: `${baseURL}/api/desktop-health`,
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
