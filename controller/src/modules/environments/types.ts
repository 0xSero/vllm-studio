import type { EngineBackend } from "../../../../shared/contracts/system";
import type { Brand } from "../models/types";

/** Engines with an official, pinned-version Docker image. MLX is Apple
 * Silicon (Metal) only — Docker on macOS runs in a Linux VM with no GPU
 * passthrough, so a containerized MLX environment would have no
 * acceleration and isn't offered. */
export type EnvironmentEngineId = Extract<EngineBackend, "vllm" | "sglang" | "llamacpp">;

export type EnvironmentId = Brand<string, "EnvironmentId">;

export const asEnvironmentId = (value: string): EnvironmentId => value as EnvironmentId;

/**
 * A pinned-version Docker environment for a recipe: which official upstream
 * image to run it in, resolved via `image-registry.ts`. Persisted definition
 * only — container run/build status is a runtime concern, tracked the same
 * way a native recipe's running state is (not stored on the record itself).
 */
export interface Environment {
  id: EnvironmentId;
  name: string;
  recipeId: string;
  engineId: EnvironmentEngineId;
  version: string;
  variant: string | null;
  createdAt: string;
  updatedAt: string;
}
