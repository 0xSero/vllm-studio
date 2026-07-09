import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeTarget } from "../src/lib/types";
import {
  defaultRuntimeForBackend,
  runtimeOptionsFor,
} from "../src/features/recipes/serve-runtime-options";

const target = (patch: Partial<RuntimeTarget>): RuntimeTarget => ({
  id: "vllm:system:test",
  backend: "vllm",
  kind: "system",
  label: "vLLM system binary",
  installed: true,
  active: false,
  version: "0.15.0",
  pythonPath: null,
  binaryPath: "/usr/local/bin/vllm",
  dockerImage: null,
  source: "discovered",
  capabilities: {
    canLaunch: true,
    canUpdate: false,
    canInspectOptions: true,
    supportsDocker: true,
  },
  health: { status: "ok" },
  ...patch,
});

test("defaults Python engines to their Local Studio managed venv", () => {
  assert.deepEqual(defaultRuntimeForBackend("vllm"), {
    kind: "managed_venv",
    ref: "vllm",
    label: "Managed vLLM",
  });
});

test("marks the managed runtime ready when its controller venv exists", () => {
  const options = runtimeOptionsFor("vllm", [
    target({
      id: "vllm:venv:managed",
      kind: "venv",
      label: "vllm venv (vllm-latest)",
      pythonPath: "/data/runtime/venvs/vllm-latest/bin/python",
      binaryPath: null,
    }),
  ]);
  assert.equal(options[0]?.runtime.kind, "managed_venv");
  assert.equal(options[0]?.installed, true);
  assert.equal(options[0]?.canInstall, false);
});

test("maps discovered venvs to explicit system runtime paths", () => {
  const options = runtimeOptionsFor("vllm", [
    target({
      id: "vllm:venv:custom",
      kind: "venv",
      label: "vLLM custom venv",
      pythonPath: "/opt/custom/bin/python",
      binaryPath: null,
    }),
  ]);
  assert.deepEqual(options[1]?.runtime, {
    kind: "system",
    ref: "/opt/custom/bin/python",
    label: "vLLM custom venv",
  });
});

test("maps Docker targets to the selected image reference", () => {
  const options = runtimeOptionsFor("vllm", [
    target({
      id: "vllm:docker:image",
      kind: "docker",
      label: "vLLM Docker",
      dockerImage: "vllm/vllm-openai:v0.15.0",
      binaryPath: null,
    }),
  ]);
  assert.deepEqual(options[1]?.runtime, {
    kind: "docker",
    ref: "vllm/vllm-openai:v0.15.0",
    label: "vLLM Docker",
  });
});
