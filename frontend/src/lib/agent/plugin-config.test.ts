import { describe, expect, it } from "vitest";
import { pluginConfigKey, setPluginEnabledInConfig } from "./plugin-config";

describe("plugin config", () => {
  it("builds Codex plugin keys", () => {
    expect(pluginConfigKey("browser-use", "openai-bundled")).toBe("browser-use@openai-bundled");
    expect(pluginConfigKey("local-plugin")).toBe("local-plugin");
  });

  it("updates an existing plugin enabled flag", () => {
    const raw = '[plugins."browser-use@openai-bundled"]\nenabled = true\n\n[profiles.default]\n';
    expect(setPluginEnabledInConfig(raw, "browser-use@openai-bundled", false)).toBe(
      '[plugins."browser-use@openai-bundled"]\nenabled = false\n[profiles.default]\n',
    );
  });

  it("adds enabled to an existing plugin section without one", () => {
    const raw = '[plugins."computer-use@openai-bundled"]\nfoo = "bar"\n';
    expect(setPluginEnabledInConfig(raw, "computer-use@openai-bundled", true)).toBe(
      '[plugins."computer-use@openai-bundled"]\nfoo = "bar"\nenabled = true\n',
    );
  });

  it("appends a missing plugin section", () => {
    expect(setPluginEnabledInConfig("model = \"x\"\n", "github@openai-curated", true)).toBe(
      'model = "x"\n\n[plugins."github@openai-curated"]\nenabled = true\n',
    );
  });
});
