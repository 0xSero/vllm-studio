import { describe, expect, test } from "bun:test";
import { runtimeTargetsForWslDistributions } from "./runtime-targets";

describe("WSL2 runtime targets", () => {
  test("offers only vLLM and SGLang without probing or claiming a version", () => {
    const targets = runtimeTargetsForWslDistributions([
      { name: "Ubuntu", version: 2, default: true },
      { name: "Debian Dev", version: 2, default: false },
    ]);

    expect(targets).toHaveLength(4);
    expect(new Set(targets.map((target) => target.backend))).toEqual(new Set(["vllm", "sglang"]));
    expect(targets.every((target) => target.kind === "wsl2")).toBe(true);
    expect(targets.every((target) => target.version === null)).toBe(true);
    expect(targets.every((target) => target.health.status === "warning")).toBe(true);
    expect(targets.slice(0, 2).every((target) => target.wslDefault)).toBe(true);
    expect(targets.find((target) => target.backend === "vllm")?.binaryPath).toBe("vllm");
    expect(targets.find((target) => target.backend === "sglang")?.binaryPath).toBe("sglang");
    expect(targets.map((target) => target.wslDistribution)).toEqual([
      "Ubuntu",
      "Ubuntu",
      "Debian Dev",
      "Debian Dev",
    ]);
  });
});
