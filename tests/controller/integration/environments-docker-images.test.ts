import { describe, expect, it } from "bun:test";

import { resolveEnvironmentImage } from "../../../controller/src/modules/environments/image-registry";
import { buildEnvironmentContainerCommand } from "../../../controller/src/modules/environments/container-command";
import type { Recipe } from "../../../controller/src/modules/models/types";

const baseRecipe = (overrides: Partial<Recipe> = {}): Recipe =>
  ({
    id: "qwen3-32b",
    name: "Qwen3-32B",
    model_path: "/mnt/llm_models/Qwen3-32B",
    backend: "vllm",
    host: "0.0.0.0",
    port: 8000,
    served_model_name: "qwen3-32b",
    tensor_parallel_size: 1,
    pipeline_parallel_size: 1,
    max_model_len: 32768,
    gpu_memory_utilization: 0.9,
    max_num_seqs: 8,
    kv_cache_dtype: "auto",
    trust_remote_code: false,
    tool_call_parser: null,
    reasoning_parser: null,
    quantization: null,
    dtype: "auto",
    python_path: null,
    env_vars: {},
    extra_args: {},
    ...overrides,
  }) as unknown as Recipe;

describe("resolveEnvironmentImage", () => {
  it("resolves vLLM's plain version tag", () => {
    expect(resolveEnvironmentImage({ engineId: "vllm", version: "0.11.0" })).toBe(
      "vllm/vllm-openai:v0.11.0",
    );
  });

  it("resolves vLLM with an accelerator variant suffix", () => {
    expect(
      resolveEnvironmentImage({ engineId: "vllm", version: "0.24.0", variant: "cu129-ubuntu2404" }),
    ).toBe("vllm/vllm-openai:v0.24.0-cu129-ubuntu2404");
  });

  it("resolves SGLang's version+accelerator tag", () => {
    expect(resolveEnvironmentImage({ engineId: "sglang", version: "0.4.7", variant: "cu124" })).toBe(
      "lmsysorg/sglang:v0.4.7-cu124",
    );
  });

  it("resolves llama.cpp's build-number tag", () => {
    expect(
      resolveEnvironmentImage({ engineId: "llamacpp", version: "9853", variant: "cuda" }),
    ).toBe("ghcr.io/ggml-org/llama.cpp:server-cuda-b9853");
  });

  it("resolves llama.cpp's plain CPU build-number tag with no variant", () => {
    expect(resolveEnvironmentImage({ engineId: "llamacpp", version: "9853" })).toBe(
      "ghcr.io/ggml-org/llama.cpp:server-b9853",
    );
  });
});

describe("buildEnvironmentContainerCommand", () => {
  const IMAGE = "vllm/vllm-openai:v0.11.0";

  it("wraps vLLM's official image with --model/--host/--port and no CLI subcommand", () => {
    const cmd = buildEnvironmentContainerCommand("vllm", baseRecipe(), IMAGE);
    expect(cmd[0]).toBe("docker");
    expect(cmd[1]).toBe("run");
    expect(cmd).toContain(IMAGE);
    const imageIdx = cmd.indexOf(IMAGE);
    expect(cmd[imageIdx + 1]).toBe("--model");
    expect(cmd[imageIdx + 2]).toBe("/mnt/llm_models/Qwen3-32B");
    expect(cmd).toContain("--served-model-name");
  });

  it("wraps SGLang's official image with the explicit launch_server module", () => {
    const cmd = buildEnvironmentContainerCommand(
      "sglang",
      baseRecipe({ backend: "sglang" }),
      "lmsysorg/sglang:v0.4.7-cu124",
    );
    const imageIdx = cmd.indexOf("lmsysorg/sglang:v0.4.7-cu124");
    expect(cmd[imageIdx + 1]).toBe("python3");
    expect(cmd[imageIdx + 2]).toBe("-m");
    expect(cmd[imageIdx + 3]).toBe("sglang.launch_server");
    expect(cmd).toContain("--model-path");
  });

  it("wraps llama.cpp's server image with -m/--host/--port only", () => {
    const cmd = buildEnvironmentContainerCommand(
      "llamacpp",
      baseRecipe({ backend: "llamacpp" }),
      "ghcr.io/ggml-org/llama.cpp:server-cuda-b9853",
    );
    const imageIdx = cmd.indexOf("ghcr.io/ggml-org/llama.cpp:server-cuda-b9853");
    expect(cmd[imageIdx + 1]).toBe("-m");
    expect(cmd[imageIdx + 2]).toBe("/mnt/llm_models/Qwen3-32B");
    expect(cmd).not.toContain("--served-model-name");
  });

  it("bind-mounts the model path read-only for every engine", () => {
    const cmd = buildEnvironmentContainerCommand("vllm", baseRecipe(), IMAGE);
    const mountIdx = cmd.indexOf("-v");
    expect(cmd[mountIdx + 1]).toBe("/mnt/llm_models/Qwen3-32B:/mnt/llm_models/Qwen3-32B:ro");
  });
});
