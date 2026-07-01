import type { EngineBackend } from "../../../../shared/contracts/system";

/** Engines with an official, pinned-version Docker image. MLX is Apple
 * Silicon (Metal) only — Docker on macOS runs in a Linux VM with no GPU
 * passthrough, so a containerized MLX environment would have no
 * acceleration and isn't offered. */
export type EnvironmentEngineId = Extract<EngineBackend, "vllm" | "sglang" | "llamacpp">;

export type EnvironmentAccelerator = "cuda" | "rocm" | "cpu";

export interface EnvironmentImageSpec {
  readonly engineId: EnvironmentEngineId;
  readonly version: string;
  readonly accelerator: EnvironmentAccelerator;
}
