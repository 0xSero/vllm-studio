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
    expect(
      resolveEnvironmentImage({ engineId: "sglang", version: "0.4.7", variant: "cu124" }),
    ).toBe("lmsysorg/sglang:v0.4.7-cu124");
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
  const ENVIRONMENT_ID = "env-qwen3-32b";

  const innerCommand = (cmd: string[], image: string): string[] => {
    const imageIdx = cmd.indexOf(image);
    expect(imageIdx).toBeGreaterThan(-1);
    return cmd.slice(imageIdx + 1);
  };

  const flagValue = (args: string[], flag: string): string | undefined => {
    expect(args).toContain(flag);
    return args[args.indexOf(flag) + 1];
  };

  it("feeds vLLM's `vllm serve` entrypoint a positional model path, never --model or a subcommand", () => {
    const cmd = buildEnvironmentContainerCommand("vllm", baseRecipe(), IMAGE, ENVIRONMENT_ID);
    expect(cmd[0]).toBe("docker");
    expect(cmd[1]).toBe("run");
    const inner = innerCommand(cmd, IMAGE);
    expect(inner[0]).toBe("/mnt/llm_models/Qwen3-32B");
    expect(inner[1]).toBe("--host");
    expect(inner[2]).toBe("0.0.0.0");
    expect(inner[3]).toBe("--port");
    expect(inner[4]).toBe("8000");
    expect(inner).not.toContain("--model");
    expect(inner).not.toContain("serve");
  });

  it("carries the full vLLM recipe flag set into the container command", () => {
    const cmd = buildEnvironmentContainerCommand(
      "vllm",
      baseRecipe({ tensor_parallel_size: 4, max_model_len: 16384 }),
      IMAGE,
      ENVIRONMENT_ID,
    );
    const inner = innerCommand(cmd, IMAGE);
    expect(flagValue(inner, "--tensor-parallel-size")).toBe("4");
    expect(flagValue(inner, "--max-model-len")).toBe("16384");
    expect(flagValue(inner, "--served-model-name")).toBe("qwen3-32b");
    expect(flagValue(inner, "--gpu-memory-utilization")).toBe("0.9");
    expect(flagValue(inner, "--max-num-seqs")).toBe("8");
  });

  it("omits --tensor-parallel-size at the single-GPU default", () => {
    const cmd = buildEnvironmentContainerCommand("vllm", baseRecipe(), IMAGE, ENVIRONMENT_ID);
    expect(innerCommand(cmd, IMAGE)).not.toContain("--tensor-parallel-size");
  });

  it("wraps SGLang's official image with the explicit launch_server module and full recipe args", () => {
    const cmd = buildEnvironmentContainerCommand(
      "sglang",
      baseRecipe({ backend: "sglang" }),
      "lmsysorg/sglang:v0.4.7-cu124",
      ENVIRONMENT_ID,
    );
    const inner = innerCommand(cmd, "lmsysorg/sglang:v0.4.7-cu124");
    expect(inner[0]).toBe("python3");
    expect(inner[1]).toBe("-m");
    expect(inner[2]).toBe("sglang.launch_server");
    expect(flagValue(inner, "--model-path")).toBe("/mnt/llm_models/Qwen3-32B");
    expect(flagValue(inner, "--context-length")).toBe("32768");
    expect(flagValue(inner, "--mem-fraction-static")).toBe("0.9");
    expect(flagValue(inner, "--max-running-requests")).toBe("8");
    expect(inner).toContain("--enable-metrics");
  });

  it("feeds llama.cpp's llama-server entrypoint --model (not -m) plus alias and context flags", () => {
    const cmd = buildEnvironmentContainerCommand(
      "llamacpp",
      baseRecipe({ backend: "llamacpp" }),
      "ghcr.io/ggml-org/llama.cpp:server-cuda-b9853",
      ENVIRONMENT_ID,
    );
    const inner = innerCommand(cmd, "ghcr.io/ggml-org/llama.cpp:server-cuda-b9853");
    expect(inner[0]).toBe("--model");
    expect(inner[1]).toBe("/mnt/llm_models/Qwen3-32B");
    expect(inner[2]).toBe("--host");
    expect(inner[3]).toBe("0.0.0.0");
    expect(inner[4]).toBe("--port");
    expect(inner[5]).toBe("8000");
    expect(flagValue(inner, "--alias")).toBe("qwen3-32b");
    expect(flagValue(inner, "--ctx-size")).toBe("32768");
    expect(inner).not.toContain("-m");
    expect(inner).not.toContain("--served-model-name");
  });

  it("bind-mounts the model path read-only for every engine", () => {
    const cmd = buildEnvironmentContainerCommand("vllm", baseRecipe(), IMAGE, ENVIRONMENT_ID);
    const mountIdx = cmd.indexOf("-v");
    expect(cmd[mountIdx + 1]).toBe("/mnt/llm_models/Qwen3-32B:/mnt/llm_models/Qwen3-32B:ro");
  });

  it("names the container from the environment id, not the recipe id (one recipe, many environments)", () => {
    const first = buildEnvironmentContainerCommand("vllm", baseRecipe(), IMAGE, "env-a");
    const second = buildEnvironmentContainerCommand("vllm", baseRecipe(), IMAGE, "env-b");
    expect(first[first.indexOf("--name") + 1]).toBe("local-studio-env-env-a");
    expect(second[second.indexOf("--name") + 1]).toBe("local-studio-env-env-b");
  });
});
