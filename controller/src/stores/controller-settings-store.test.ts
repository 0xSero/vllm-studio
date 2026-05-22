import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { ControllerSettingsStore } from "./controller-settings-store";

describe("ControllerSettingsStore", () => {
  it("persists UI preferences in the controller database", () => {
    const directory = mkdtempSync(join(tmpdir(), "controller-settings-"));
    const dbPath = join(directory, "controller.db");
    try {
      const first = new ControllerSettingsStore(dbPath);
      first.saveUiPreferences({
        "vllm-studio-state": "{\"state\":{\"themeId\":\"codex-dark\"}}",
        "vllm-studio.customThemeTokens": "{\"bg\":\"#111\"}",
      });

      const second = new ControllerSettingsStore(dbPath);
      expect(second.getUiPreferences()).toEqual({
        "vllm-studio-state": "{\"state\":{\"themeId\":\"codex-dark\"}}",
        "vllm-studio.customThemeTokens": "{\"bg\":\"#111\"}",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
