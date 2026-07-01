import type { EngineBackend } from "./system";

export type EnvironmentEngineId = Extract<EngineBackend, "vllm" | "sglang" | "llamacpp">;

export interface Environment {
  id: string;
  name: string;
  recipeId: string;
  engineId: EnvironmentEngineId;
  version: string;
  variant: string | null;
  image: string | null;
  seeded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EngineImage {
  image: string;
  tag: string;
  size: string;
}

export interface EngineImagePull {
  image: string;
  status: "pulling" | "done" | "failed";
  startedAt: string;
  error: string | null;
}

export interface EngineImagesInfo {
  id: EnvironmentEngineId;
  repository: string;
  defaultImage: string;
  images: EngineImage[];
  pulls: EngineImagePull[];
}
