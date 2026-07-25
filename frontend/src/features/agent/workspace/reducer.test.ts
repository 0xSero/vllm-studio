import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentModel } from "@/features/agent/workspace/types";
import { createInitialState, reducer } from "./store";

function model(id: string, active: boolean): AgentModel {
  return {
    id,
    name: id,
    provider: "local-studio",
    controllerUrl: "http://controller.local:8080",
    contextWindow: 128_000,
    maxTokens: 32_000,
    reasoning: false,
    vision: false,
    active,
  };
}

test("running model wins over stale current and preferred selections", () => {
  const stopped = model("stopped", false);
  const running = model("running", true);
  const initial = { ...createInitialState(), selectedModel: stopped.id };
  const next = reducer(initial, {
    type: "setModels",
    models: [stopped, running],
    preferredModelId: stopped.id,
  });

  assert.equal(next.selectedModel, running.id);
});

test("ready preferred model remains selected", () => {
  const first = model("first", true);
  const preferred = model("preferred", true);
  const next = reducer(createInitialState(), {
    type: "setModels",
    models: [first, preferred],
    preferredModelId: preferred.id,
    controllerStatus: { running: true, launching: null },
  });

  assert.equal(next.selectedModel, preferred.id);
  assert.deepEqual(next.controllerStatus, { running: true, launching: null });
});
