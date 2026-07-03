import type { StudioModelRecommendation, StudioStarterPreset } from "./types";

/**
 * First-run presets shown when a controller has no recipes yet. Three lanes:
 * a serious local model, a small fast local model, and a remote endpoint —
 * so every machine (and no machine at all) has a working first chat.
 */
export const STUDIO_STARTER_PRESETS: StudioStarterPreset[] = [
  {
    id: "qwen3-6-35b",
    name: "Qwen3.6 35B",
    description:
      "Hybrid MoE in native FP4 — frontier-class local chat, tool use, and reasoning on a single Blackwell GPU.",
    kind: "download",
    tags: ["local", "reasoning", "tool-use", "recommended"],
    size_gb: 20,
    min_vram_gb: 24,
    model_id: "nvidia/Qwen3.6-35B-A3B-NVFP4",
    backend: "vllm",
    recipe_overrides: {
      served_model_name: "qwen3.6-35b",
      max_model_len: 131072,
      tool_call_parser: "qwen3_coder",
      reasoning_parser: "qwen3",
      enable_auto_tool_choice: true,
      trust_remote_code: true,
    },
  },
  {
    id: "lfm2-5",
    name: "LFM2.5 8B",
    description:
      "Liquid AI's on-device MoE (8B-A1B, Q4_K_M) — a ~5 GB download that chats instantly on modest hardware.",
    kind: "download",
    tags: ["local", "fast", "small"],
    size_gb: 5,
    min_vram_gb: null,
    model_id: "LiquidAI/LFM2.5-8B-A1B-GGUF",
    allow_patterns: ["*Q4_K_M.gguf"],
    backend: "llamacpp",
    gguf_file: "LFM2.5-8B-A1B-Q4_K_M.gguf",
    recipe_overrides: {
      served_model_name: "lfm2.5",
      max_model_len: 32768,
    },
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description:
      "Connect a hosted endpoint with one API key — full-strength chat with nothing to download.",
    kind: "remote",
    tags: ["remote", "instant"],
    size_gb: null,
    min_vram_gb: null,
    remote: {
      base_url: "https://api.homelabai.org/v1",
      model: "deepseek-v4-flash",
    },
  },
];

export const STUDIO_MODEL_RECOMMENDATIONS: StudioModelRecommendation[] = [
  {
    id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
    name: "Llama 4 Maverick 17Bx128E",
    size_gb: 160,
    min_vram_gb: 140,
    description: "Meta's latest MoE flagship — 400B+ params, top-tier reasoning.",
    tags: ["chat", "reasoning", "flagship"],
  },
  {
    id: "Qwen/Qwen3-235B-A22B",
    name: "Qwen3 235B (A22B MoE)",
    size_gb: 150,
    min_vram_gb: 130,
    description: "Qwen's largest MoE model with thinking/non-thinking modes.",
    tags: ["chat", "reasoning", "multilingual", "flagship"],
  },
  {
    id: "deepseek-ai/DeepSeek-R1",
    name: "DeepSeek R1",
    size_gb: 160,
    min_vram_gb: 140,
    description: "Top-tier open reasoning model, 671B MoE.",
    tags: ["reasoning", "code", "flagship"],
  },
  {
    id: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    name: "Llama 4 Scout 17Bx16E",
    size_gb: 38,
    min_vram_gb: 34,
    description: "Efficient Llama 4 MoE variant with 10M token context.",
    tags: ["chat", "long-context", "recommended"],
  },
  {
    id: "Qwen/Qwen3-32B",
    name: "Qwen3 32B",
    size_gb: 64,
    min_vram_gb: 48,
    description: "Dense 32B with built-in thinking — strong all-rounder.",
    tags: ["chat", "reasoning", "code", "recommended"],
  },
  {
    id: "meta-llama/Llama-3.3-70B-Instruct",
    name: "Llama 3.3 70B Instruct",
    size_gb: 140,
    min_vram_gb: 80,
    description: "Latest Llama 3.3 dense model, excellent instruction following.",
    tags: ["chat", "general", "recommended"],
  },
  {
    id: "mistralai/Mistral-Small-24B-Instruct-2501",
    name: "Mistral Small 24B",
    size_gb: 48,
    min_vram_gb: 32,
    description: "Mistral's latest efficient model with strong tool use.",
    tags: ["chat", "tool-use", "fast"],
  },
  {
    id: "google/gemma-3-27b-it",
    name: "Gemma 3 27B",
    size_gb: 54,
    min_vram_gb: 40,
    description: "Google's latest open model — multilingual, vision-ready.",
    tags: ["chat", "multilingual", "vision"],
  },
  {
    id: "Qwen/Qwen3-14B",
    name: "Qwen3 14B",
    size_gb: 28,
    min_vram_gb: 20,
    description: "Great quality-to-size ratio with thinking mode.",
    tags: ["chat", "reasoning", "fast"],
  },
  {
    id: "meta-llama/Llama-3.1-8B-Instruct",
    name: "Llama 3.1 8B",
    size_gb: 16,
    min_vram_gb: 12,
    description: "Fast and reliable for single-GPU setups.",
    tags: ["chat", "fast", "starter"],
  },
  {
    id: "Qwen/Qwen3-8B",
    name: "Qwen3 8B",
    size_gb: 16,
    min_vram_gb: 12,
    description: "Compact model with thinking and tool-use support.",
    tags: ["chat", "reasoning", "fast", "starter"],
  },
  {
    id: "microsoft/Phi-4",
    name: "Phi-4 14B",
    size_gb: 28,
    min_vram_gb: 20,
    description: "Microsoft's latest small-but-capable reasoning model.",
    tags: ["chat", "reasoning", "code"],
  },
];
