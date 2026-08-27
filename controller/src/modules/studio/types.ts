/**
 * A curated first-run preset. `download` presets pull weights from Hugging Face
 * and become a local recipe; `remote` presets register an external
 * OpenAI-compatible provider (no weights, only an API key).
 */
export type StudioRecipeOverride =
  | string
  | number
  | boolean
  | null
  | StudioRecipeOverride[]
  | { [key: string]: StudioRecipeOverride };

export interface StudioStarterPreset {
  id: string;
  name: string;
  description: string;
  kind: "download" | "remote";
  tags: string[];
  size_gb: number | null;
  min_vram_gb: number | null;
  model_id?: string;
  allow_patterns?: string[];
  backend?: "vllm" | "llamacpp";
  gguf_file?: string;
  recipe_overrides?: Record<string, StudioRecipeOverride>;
  remote?: { base_url: string; model: string };
}
