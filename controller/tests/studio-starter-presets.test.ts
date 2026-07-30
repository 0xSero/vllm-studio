import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { STUDIO_STARTER_PRESETS } from "../src/modules/studio/configs";

describe("STUDIO_STARTER_PRESETS", () => {
  test("every preset has a unique id", () => {
    const ids = STUDIO_STARTER_PRESETS.map((preset) => preset.id);
    assert.equal(new Set(ids).size, ids.length, "preset ids must be unique");
  });

  test("every remote preset has a base_url and authentication", () => {
    for (const preset of STUDIO_STARTER_PRESETS) {
      if (preset.kind !== "remote") continue;
      assert.ok(preset.remote, `${preset.id} is missing remote config`);
      assert.ok(preset.remote!.base_url, `${preset.id} is missing base_url`);
      assert.ok(
        preset.remote!.authentication,
        `${preset.id} is missing authentication`,
      );
    }
  });

  test("local-llm-server preset is keyless and discovers models at setup", () => {
    const preset = STUDIO_STARTER_PRESETS.find((preset) => preset.id === "local-llm-server");
    assert.ok(preset, "local-llm-server preset is missing");
    assert.equal(preset.kind, "remote");
    const remote = preset.remote!;
    assert.equal(remote.authentication, "none");
    assert.equal(remote.model, "");
    assert.ok(
      remote.base_url.startsWith("http://localhost:"),
      "local-llm-server should target localhost",
    );
  });

  test("trustnest-apim preset carries Entra ID client-credentials defaults", () => {
    const preset = STUDIO_STARTER_PRESETS.find((preset) => preset.id === "trustnest-apim");
    assert.ok(preset, "trustnest-apim preset is missing");
    assert.equal(preset.kind, "remote");
    const remote = preset.remote!;
    assert.equal(remote.authentication, "apim_client");
    assert.equal(remote.model, "");
    assert.equal(
      remote.audience,
      "api://c94dc58f-d839-4fdf-b0a4-22442c7baf50",
    );
    assert.ok(
      remote.token_endpoint?.includes("login.microsoftonline.com"),
      "token_endpoint should point to Entra ID",
    );
    assert.ok(
      remote.scopes?.length,
      "trustnest-apim should declare at least one OAuth scope",
    );
    assert.equal(
      remote.subscription_key_header,
      "TrustNest-Apim-Subscription-Key",
    );
    assert.equal(remote.path_style, "openai");
  });

  test("tensorprime-gemma4 preset is keyless and discovers models at setup", () => {
    const preset = STUDIO_STARTER_PRESETS.find((preset) => preset.id === "tensorprime-gemma4");
    assert.ok(preset, "tensorprime-gemma4 preset is missing");
    assert.equal(preset.kind, "remote");
    const remote = preset.remote!;
    assert.equal(remote.authentication, "none");
    assert.equal(remote.model, "");
    assert.equal(remote.base_url, "http://api.tprime.vlans.ca");
  });

  test("tensorprime-litellm preset is keyless and discovers models at setup", () => {
    const preset = STUDIO_STARTER_PRESETS.find((preset) => preset.id === "tensorprime-litellm");
    assert.ok(preset, "tensorprime-litellm preset is missing");
    assert.equal(preset.kind, "remote");
    const remote = preset.remote!;
    assert.equal(remote.authentication, "none");
    assert.equal(remote.model, "");
    assert.equal(remote.base_url, "http://api.tprime.vlans.ca");
    assert.ok(
      preset.tags.includes("multi-model"),
      "tensorprime-litellm should be tagged multi-model",
    );
  });
});
