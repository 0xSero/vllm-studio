import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentModel } from "@/features/agent/workspace/types";
import { deriveWorkbenchReadiness } from "./workbench-readiness";

function controllerModel(id: string, active: boolean): AgentModel {
  return {
    id,
    name: id,
    provider: "local-studio",
    controllerUrl: "http://controller.local:8080",
    contextWindow: 128_000,
    maxTokens: 32_000,
    reasoning: true,
    vision: false,
    active,
  };
}

function readiness(overrides: Partial<Parameters<typeof deriveWorkbenchReadiness>[0]> = {}) {
  return deriveWorkbenchReadiness({
    models: [],
    selectedModelId: "",
    loading: false,
    error: "",
    controllerStatus: null,
    ...overrides,
  });
}

test("ready controller model enables the first-message state", () => {
  const model = controllerModel("qwen", true);
  const result = readiness({ models: [model], selectedModelId: model.id });

  assert.equal(result.kind, "ready");
  assert.equal(result.model, model);
  assert.match(result.title, /qwen is ready/);
});

test("initial model loading presents a connecting state", () => {
  assert.equal(readiness({ loading: true }).kind, "connecting");
});

test("controller launch presents a startup state", () => {
  const model = controllerModel("qwen", false);
  const result = readiness({
    models: [model],
    selectedModelId: model.id,
    controllerStatus: { running: true, launching: "qwen-serve" },
  });

  assert.equal(result.kind, "starting");
  assert.equal(result.primaryAction, "status");
});

test("authentication and connectivity errors have distinct recovery actions", () => {
  const authentication = readiness({ error: "HTTP 401 Unauthorized" });
  const offline = readiness({ error: "fetch failed: ECONNREFUSED" });

  assert.equal(authentication.kind, "authentication");
  assert.equal(authentication.primaryAction, "settings");
  assert.equal(offline.kind, "offline");
  assert.equal(offline.primaryAction, "retry");
});

test("empty and stopped controllers direct the user to Models", () => {
  const empty = readiness();
  const model = controllerModel("qwen", false);
  const stopped = readiness({ models: [model], selectedModelId: model.id });

  assert.equal(empty.kind, "empty");
  assert.equal(empty.primaryAction, "models");
  assert.equal(stopped.kind, "stopped");
  assert.equal(stopped.primaryAction, "models");
});

test("non-controller provider models remain available without controller active state", () => {
  const model: AgentModel = {
    ...controllerModel("cloud-model", false),
    controllerUrl: undefined,
  };
  assert.equal(readiness({ models: [model], selectedModelId: model.id }).kind, "ready");
});
