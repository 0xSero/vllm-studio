import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

function envValue(name: string): string | undefined {
  const filepath = path.join(process.cwd(), ".env.local");
  if (!existsSync(filepath)) return undefined;
  const line = readFileSync(filepath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  if (!line) return undefined;
  const value = line.slice(name.length + 1).trim();
  return value.replace(/^['"]|['"]$/g, "") || undefined;
}

process.env.LIVE_DGX_API_KEY ||= envValue("API_KEY");

const baseURL = process.env.LIVE_LOCAL_STUDIO_URL || "http://127.0.0.1:61449";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "live-dgx.spec.ts",
    "live-agent.spec.ts",
    "installed-release.spec.ts",
    "hydration.spec.ts",
  ],
  outputDir: "../test-results/live-dgx",
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  timeout: 240_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 960 },
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: {
      mode: "on",
      size: { width: 1440, height: 960 },
      show: {
        actions: { duration: 750, position: "bottom-right", fontSize: 14 },
        test: { level: "step", position: "top-left", fontSize: 14 },
      },
    },
  },
});
