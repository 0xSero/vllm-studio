import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { __resetDataDirCacheForTests, resolveSettingsFilePath } from "./data-dir";
import { getApiSettings, saveApiSettings } from "./api-settings";

let dataDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.VLLM_STUDIO_DATA_DIR;
  dataDir = mkdtempSync(path.join(tmpdir(), "vllm-studio-settings-test-"));
  process.env.VLLM_STUDIO_DATA_DIR = dataDir;
  __resetDataDirCacheForTests();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.VLLM_STUDIO_DATA_DIR;
  else process.env.VLLM_STUDIO_DATA_DIR = originalEnv;
  __resetDataDirCacheForTests();
});

describe("api-settings", () => {
  it("resolves the configured data dir", () => {
    expect(resolveSettingsFilePath()).toBe(path.join(dataDir, "api-settings.json"));
  });

  it("round-trips backendUrl through file", async () => {
    await saveApiSettings({
      backendUrl: "http://100.90.62.80:8080",
      apiKey: "k",
      voiceUrl: "https://voice.example.com",
      voiceModel: "whisper-large-v3-turbo",
    });
    const loaded = await getApiSettings();
    expect(loaded.backendUrl).toBe("http://100.90.62.80:8080");
    const onDisk = JSON.parse(readFileSync(resolveSettingsFilePath(), "utf-8"));
    expect(onDisk.backendUrl).toBe("http://100.90.62.80:8080");
  });

  it("ignores stale settings in legacy locations once a target file exists", async () => {
    // Pre-populate target dir with a file pointing at the canonical URL.
    writeFileSync(
      resolveSettingsFilePath(),
      JSON.stringify({ backendUrl: "http://canonical:8080" }),
    );
    // Drop a stale file in a legacy candidate that we know the resolver will
    // never read once VLLM_STUDIO_DATA_DIR is honored.
    const legacyDir = path.join(dataDir, "..", "legacy-dummy");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      path.join(legacyDir, "api-settings.json"),
      JSON.stringify({ backendUrl: "http://stale:1" }),
    );

    const loaded = await getApiSettings();
    expect(loaded.backendUrl).toBe("http://canonical:8080");

    rmSync(legacyDir, { recursive: true, force: true });
  });
});
