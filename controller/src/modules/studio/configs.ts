import type { StudioStarterPreset } from "./types";

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
    id: "tensorprime",
    name: "TensorPrime",
    description:
      "Connect the governed vLLM and llm-d endpoint. Commissioning verifies the live model catalog before activation.",
    kind: "remote",
    tags: ["remote", "governed", "keyless"],
    size_gb: null,
    min_vram_gb: null,
    remote: {
      base_url: "http://api.tprime.vlans.ca",
      model: "qwen3-next-80b-a3b-nvfp4",
      authentication: "none",
    },
  },
  {
    id: "tensorprime-gemma4",
    name: "TensorPrime Gemma 4",
    description:
      "Connect the TensorPrime vLLM Gemma 4 endpoint. Models are discovered at setup time through the governed platform API.",
    kind: "remote",
    tags: ["remote", "governed", "keyless"],
    size_gb: null,
    min_vram_gb: null,
    remote: {
      base_url: "http://api.tprime.vlans.ca",
      model: "",
      authentication: "none",
    },
  },
  {
    id: "tensorprime-litellm",
    name: "TensorPrime LiteLLM Gateway",
    description:
      "Connect the TensorPrime LiteLLM multi-model gateway. All routed models are discovered at setup time through the governed platform API.",
    kind: "remote",
    tags: ["remote", "governed", "keyless", "multi-model"],
    size_gb: null,
    min_vram_gb: null,
    remote: {
      base_url: "http://api.tprime.vlans.ca",
      model: "",
      authentication: "none",
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
      base_url: "http://pop-os-1.tailadb2c1.ts.net:8080/v1",
      model: "deepseek-v4-flash",
      authentication: "api_key",
    },
  },
  {
    id: "local-llm-server",
    name: "Local LLM server",
    description:
      "Connect to an OpenAI-compatible server already running on this machine (Ollama, LM Studio, llama-server, vLLM). Models are discovered at setup time.",
    kind: "remote",
    tags: ["remote", "local", "keyless"],
    size_gb: null,
    min_vram_gb: null,
    remote: {
      base_url: "http://localhost:11434/v1",
      model: "",
      authentication: "none",
    },
  },
  {
    id: "trustnest-apim",
    name: "Thales TrustNest APIM",
    description:
      "Connect to the Thales TrustNest AI Models API via Entra ID client credentials. Models are discovered at setup time; a subscription key is required.",
    kind: "remote",
    tags: ["remote", "governed", "apim"],
    size_gb: null,
    min_vram_gb: null,
    remote: {
      base_url: "https://api.thalesdigital.io/ai-models/openai/v1",
      model: "",
      authentication: "apim_client",
      issuer_id: "https://login.microsoftonline.com/common/v2.0",
      audience: "api://c94dc58f-d839-4fdf-b0a4-22442c7baf50",
      scopes: ["api://c94dc58f-d839-4fdf-b0a4-22442c7baf50/.default"],
      token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      client_id: "",
      path_style: "openai",
      api_version: "2024-06-01",
      subscription_key_header: "TrustNest-Apim-Subscription-Key",
    },
  },
];
