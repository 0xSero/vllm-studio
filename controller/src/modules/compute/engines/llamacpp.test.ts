import { describe, expect, test } from "bun:test";
import type { Config } from "../../../config/env";
import { parseRecipe } from "../../models/recipes/recipe-serializer";
import { recipeToLaunchInput } from "../active-model";
import type { HostProfile, LaunchRequest } from "../contracts";
import { planLaunch } from "./registry";

/** DGX Spark: aarch64, unified memory, docker present but no GPU images for llama.cpp. */
const spark: HostProfile = {
  nodeId: "self",
  platform: "linux",
  arch: "arm64",
  accelerator: "cuda",
  unifiedMemory: true,
  wsl: false,
  docker: true,
  dockerGpu: false,
  deviceCount: 1,
};

const recipe = parseRecipe({
  id: "spark-qwen38-27b-rvn-q8",
  name: "Qwen3.8 27B RVN Q8",
  backend: "llamacpp",
  runtime: { kind: "binary", ref: "/opt/ai/llama.cpp/build/bin/llama-server" },
  model_path: "/srv/models/qwen38-27b-rvn/RVN-Q8_0-multilingual-mtp.gguf",
  served_model_name: "spark-qwen38-27b-rvn-q8",
  max_model_len: 262144,
  max_num_seqs: 4,
  port: 8000,
  vision: true,
  extra_args: {
    mmproj: "/srv/models/qwen38-27b-rvn/mmproj-Qwen3.8-27B-Q8_0.gguf",
    n_gpu_layers: "999",
    flash_attn: "on",
    spec_type: "draft-mtp",
    spec_draft_n_max: "2",
    temp: "0.6",
    top_p: "0.95",
    top_k: "20",
    min_p: "0.0",
    presence_penalty: "0.0",
    repeat_penalty: "1.0",
    jinja: true,
    reasoning: "on",
    cache_reuse: "256",
    kv_unified: true,
    host: "0.0.0.0",
    api_key_file: "/etc/ai/llama-api.key",
  },
});

describe("llamacpp native process plan", () => {
  test("a binary-runtime recipe plans to the v2.15.2 llama-server argv", () => {
    const input = recipeToLaunchInput(recipe, { inference_port: 8000 } as Config, []);
    expect(input.runtime).toBe("process");
    expect(input.binary).toBe("/opt/ai/llama.cpp/build/bin/llama-server");

    // Mirrors what lifecycle builds once the instance record is reserved.
    const request: LaunchRequest = {
      engine: input.engine,
      host: spark,
      runtime: input.runtime,
      devices: [],
      port: input.portOverride ?? 8000,
      modelPath: input.modelPath,
      servedModelName: input.servedModelName,
      options: input.options,
      extraArgs: input.extraArgs,
      env: input.env,
      dockerImage: input.dockerImage,
      binary: input.binary,
    };
    const plan = planLaunch(request);

    expect(plan.kind).toBe("process");
    expect(plan.image).toBeUndefined();
    expect(plan.mounts).toEqual([]);
    expect(plan.health.path).toBe("/health");
    expect(plan.health.readyDeadlineMs).toBe(600_000);
    // extra_args override base flags: the loopback --host is dropped, not duplicated.
    expect(plan.argv).toEqual([
      "/opt/ai/llama.cpp/build/bin/llama-server",
      "--model", "/srv/models/qwen38-27b-rvn/RVN-Q8_0-multilingual-mtp.gguf",
      "--alias", "spark-qwen38-27b-rvn-q8",
      "--port", "8000",
      "--ctx-size", "262144",
      "--parallel", "4",
      "--metrics",
      "--mmproj", "/srv/models/qwen38-27b-rvn/mmproj-Qwen3.8-27B-Q8_0.gguf",
      "--n-gpu-layers", "999",
      "--flash-attn", "on",
      "--spec-type", "draft-mtp",
      "--spec-draft-n-max", "2",
      "--temp", "0.6",
      "--top-p", "0.95",
      "--top-k", "20",
      "--min-p", "0.0",
      "--presence-penalty", "0.0",
      "--repeat-penalty", "1.0",
      "--jinja",
      "--reasoning", "on",
      "--cache-reuse", "256",
      "--kv-unified",
      "--host", "0.0.0.0",
      "--api-key-file", "/etc/ai/llama-api.key",
    ]);
  });

  test("a llamacpp recipe without a runtime defaults to llama-server on PATH", () => {
    const bare = parseRecipe({ id: "bare", name: "bare", backend: "llamacpp", model_path: "/m.gguf" });
    expect(bare.runtime).toEqual({ kind: "binary", ref: "llama-server" });
    const input = recipeToLaunchInput(bare, { inference_port: 8000 } as Config, []);
    expect(input.runtime).toBe("process");
    expect(input.binary).toBe("llama-server");
  });
});
