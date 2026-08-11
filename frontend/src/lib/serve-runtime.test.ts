import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RuntimeTarget } from "@/lib/types";
import { isManagedRuntimeTarget } from "@/features/settings/runtime-targets";
import { isManagedServeRuntimeTarget } from "./serve-runtime";

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
});
