import { describe, expect, it } from "bun:test";

import { getEngineSpec } from "../../../controller/src/modules/engines/engine-spec";
import { getDockerImage } from "../../../controller/src/modules/engines/process/backend-builder";
import type { Config } from "../../../controller/src/config/env";
import type { Recipe } from "../../../controller/src/modules/models/types";

const baseRecipe = (extra: Record<string, unknown>, env: Record<string, string> = {}): Recipe =>
  ({
    id: "glm-5.2",
    name: "GLM-5.2",
    model_path: "/mnt/llm_models/GLM-5.2-504B",
    backend: "vllm",
    host: "0.0.0.0",
    port: 8000,
    served_model_name: "glm-5.2",
    tensor_parallel_size: 4,
    pipeline_parallel_size: 1,
    max_model_len: 240000,
    gpu_memory_utilization: 0.92,
    max_num_seqs: 8,
    kv_cache_dtype: "fp8",
    trust_remote_code: true,
    tool_call_parser: "glm47",
    reasoning_parser: "glm45",
    quantization: "modelopt_fp4",
    dtype: "bfloat16",
    python_path: null,
    env_vars: env,
    extra_args: extra,
  }) as unknown as Recipe;

const config = { data_dir: "/tmp/local-studio-test" } as Config;

const buildVllmCommand = (recipe: Recipe): string[] => getEngineSpec("vllm").buildCommand(recipe, config);

const pairIndex = (cmd: string[], flag: string, value: string): number => {
  for (let i = 0; i < cmd.length - 1; i += 1) {
    if (cmd[i] === flag && cmd[i + 1] === value) return i;
  }
  return -1;
};

describe("vLLM docker_image wrapping", () => {
  const IMAGE = "voipmonitor/vllm:eldritch-enlightenment-cu132";

  it("reads docker_image from extra_args (snake or kebab)", () => {
    expect(getDockerImage(baseRecipe({ docker_image: IMAGE }))).toBe(IMAGE);
    expect(getDockerImage(baseRecipe({ "docker-image": IMAGE }))).toBe(IMAGE);
    expect(getDockerImage(baseRecipe({}))).toBeNull();
  });

  it("wraps the serve command in `docker run` with host networking and GPUs", () => {
    const cmd = buildVllmCommand(baseRecipe({ docker_image: IMAGE, "moe-backend": "b12x" }));
    expect(cmd[0]).toBe("docker");
    expect(cmd[1]).toBe("run");
    expect(pairIndex(cmd, "--network", "host")).toBeGreaterThanOrEqual(0);
    expect(cmd).toContain("--gpus");
    expect(cmd).toContain(IMAGE);
    // inner command runs the in-container vLLM binary after the image
    const imageIdx = cmd.indexOf(IMAGE);
    expect(cmd[imageIdx + 1]).toBe("/opt/venv/bin/vllm");
    expect(cmd[imageIdx + 2]).toBe("serve");
    expect(cmd).toContain("--moe-backend");
    expect(pairIndex(cmd, "--moe-backend", "b12x")).toBeGreaterThanOrEqual(0);
    // model is bind-mounted read-only at the same path
    expect(
      pairIndex(cmd, "-v", "/mnt/llm_models/GLM-5.2-504B:/mnt/llm_models/GLM-5.2-504B:ro"),
    ).toBeGreaterThanOrEqual(0);
  });

  it("forwards NCCL_GRAPH_FILE but skips NCCL_GRAPH_DUMP_FILE", () => {
    const cmd = buildVllmCommand(
      baseRecipe(
        { docker_image: IMAGE },
        { NCCL_GRAPH_FILE: "/dev/null", NCCL_GRAPH_DUMP_FILE: "/tmp/x", NCCL_P2P_DISABLE: "1" },
      ),
    );
    expect(pairIndex(cmd, "-e", "NCCL_GRAPH_FILE=/dev/null")).toBeGreaterThanOrEqual(0);
    expect(pairIndex(cmd, "-e", "NCCL_P2P_DISABLE=1")).toBeGreaterThanOrEqual(0);
    expect(pairIndex(cmd, "-e", "NCCL_GRAPH_DUMP_FILE=/tmp/x")).toBe(-1);
  });

  it("builds a native command (no docker) when docker_image is absent", () => {
    const cmd = buildVllmCommand(baseRecipe({ "moe-backend": "b12x" }));
    expect(cmd[0]).not.toBe("docker");
    expect(cmd).toContain("serve");
  });
});
