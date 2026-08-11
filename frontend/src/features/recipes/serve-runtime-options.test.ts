import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RuntimeTarget } from "@/lib/types";
import {
  isManagedRuntimeTarget,
  managedRuntimeBackendsFor,
} from "@/features/settings/runtime-targets";
import { isManagedServeRuntimeTarget } from "@/lib/serve-runtime";
import {
  preferredRuntimeForBackend,
  runtimeOptionsFor,
} from "@/features/recipes/serve-runtime-options";

const target = (pythonPath: string): RuntimeTarget =>
  ({ backend: "vllm", kind: "venv", pythonPath }) as RuntimeTarget;

describe("isManagedServeRuntimeTarget", () => {
  test("recognizes POSIX and Windows managed virtual environments", () => {
    assert.equal(
      isManagedServeRuntimeTarget("vllm", target("/data/runtime/venvs/vllm-latest/bin/python")),
      true,
    );
    assert.equal(
      isManagedServeRuntimeTarget(
        "vllm",
        target(String.raw`C:\data\runtime\venvs\vllm-latest\Scripts\python.exe`),
      ),
      true,
    );
    assert.equal(
      isManagedRuntimeTarget(
        target(String.raw`C:\data\runtime\venvs\vllm-latest\Scripts\python.exe`),
      ),
      true,
    );
  });

  test("maps WSL2 targets to explicit recipes and suppresses native managed installs", () => {
    const wslTarget = {
      id: "vllm:wsl2:ubuntu",
      backend: "vllm",
      kind: "wsl2",
      source: "discovered",
      label: "vLLM via WSL2 (Ubuntu)",
      installed: true,
      active: false,
      version: null,
      binaryPath: "vllm",
      wslDistribution: "Ubuntu",
      wslDefault: true,
      capabilities: {
        canLaunch: true,
        canUpdate: false,
        canInspectOptions: false,
        supportsDocker: false,
      },
      health: { status: "warning" },
    } as RuntimeTarget;

    const options = runtimeOptionsFor("vllm", [wslTarget]);
    assert.equal(options.length, 1);
    assert.deepEqual(options[0]?.runtime, {
      kind: "wsl2",
      ref: "Ubuntu",
      binary: "vllm",
      label: "vLLM via WSL2 (Ubuntu)",
    });
    assert.match(options[0]?.detail ?? "", /engine checked at launch/);
    assert.equal(preferredRuntimeForBackend("vllm", [wslTarget]).kind, "wsl2");
    assert.equal(
      preferredRuntimeForBackend("vllm", [
        { ...wslTarget, wslDistribution: "Debian", wslDefault: false },
        wslTarget,
      ]).ref,
      "Ubuntu",
    );
    assert.deepEqual(managedRuntimeBackendsFor([wslTarget]), []);
  });
});
