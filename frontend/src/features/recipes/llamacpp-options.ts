export type LlamacppOptionType = "text" | "number" | "boolean" | "select";

export type LlamacppOption = {
  key: string;
  label: string;
  type: LlamacppOptionType;
  tab: "model" | "resources" | "performance" | "features";
  placeholder?: string;
  options?: string[];
  description?: string;
};

type EngineOptionRow = readonly [
  key: string,
  label: string,
  type: LlamacppOptionType,
  tab: LlamacppOption["tab"],
  placeholder?: string | null,
  options?: readonly string[] | null,
  description?: string | null,
];

export const defineEngineOptions = (rows: readonly EngineOptionRow[]): LlamacppOption[] =>
  rows.map(([key, label, type, tab, placeholder, options, description]) => ({
    key,
    label,
    type,
    tab,
    ...(placeholder ? { placeholder } : {}),
    ...(options ? { options: [...options] } : {}),
    ...(description ? { description } : {}),
  }));

export const LLAMACPP_OPTIONS = defineEngineOptions([
  ["model-url", "Model URL", "text", "model", "https://.../model.gguf"],
  ["hf-repo", "HF Repo", "text", "model", "org/model"],
  ["hf-file", "HF File", "text", "model", "model.gguf"],
  ["hf-token", "HF Token", "text", "model", "hf_..."],
  ["hf-cache", "HF Cache Dir", "text", "model", "/models/cache"],
  ["lora", "LoRA", "text", "model", "/path/to/lora.gguf"],
  ["lora-scaled", "LoRA (Scaled)", "text", "model", "/path/to/lora.gguf,scale"],
  ["control-vector", "Control Vector", "text", "model", "/path/to/control-vector.bin"],
  [
    "control-vector-scaled",
    "Control Vector (Scaled)",
    "text",
    "model",
    "/path/to/control-vector.bin,scale",
  ],
  ["control-vector-layer-range", "Control Vector Layers", "text", "model", "start,end"],
  ["chat-template", "Chat Template", "text", "model"],
  ["chat-template-file", "Chat Template File", "text", "model"],
  ["system-prompt", "System Prompt", "text", "model"],
  ["prompt", "Prompt", "text", "model"],
  ["prompt-file", "Prompt File", "text", "model"],
  ["grammar", "Grammar", "text", "model"],
  ["grammar-file", "Grammar File", "text", "model"],
  ["ctx-size", "Context Size Override", "number", "model", "8192"],
  ["rope-scaling", "RoPE Scaling", "select", "model", null, ["none", "linear", "yarn"]],
  ["rope-scale", "RoPE Scale", "number", "model"],
  ["rope-freq-base", "RoPE Freq Base", "number", "model"],
  ["rope-freq-scale", "RoPE Freq Scale", "number", "model"],
  ["yarn-orig-ctx", "YaRN Orig Ctx", "number", "model"],
  ["yarn-ext-factor", "YaRN Ext Factor", "number", "model"],
  ["yarn-attn-factor", "YaRN Attn Factor", "number", "model"],
  ["yarn-beta-fast", "YaRN Beta Fast", "number", "model"],
  ["yarn-beta-slow", "YaRN Beta Slow", "number", "model"],
  ["gpu-layers", "GPU Layers", "number", "resources", "99"],
  ["gpu-layers-draft", "GPU Layers (Draft)", "number", "resources"],
  ["split-mode", "Split Mode", "select", "resources", null, ["none", "layer", "row"]],
  ["tensor-split", "Tensor Split", "text", "resources", "1,1,1,1"],
  ["main-gpu", "Main GPU", "number", "resources"],
  [
    "cache-type-k",
    "KV Cache Type (K)",
    "select",
    "resources",
    null,
    ["f16", "q8_0", "q4_0", "q6_K"],
  ],
  [
    "cache-type-v",
    "KV Cache Type (V)",
    "select",
    "resources",
    null,
    ["f16", "q8_0", "q4_0", "q6_K"],
  ],
  [
    "cache-type-k-draft",
    "KV Cache Type K (Draft)",
    "select",
    "resources",
    null,
    ["f16", "q8_0", "q4_0", "q6_K"],
  ],
  [
    "cache-type-v-draft",
    "KV Cache Type V (Draft)",
    "select",
    "resources",
    null,
    ["f16", "q8_0", "q4_0", "q6_K"],
  ],
  ["no-kv-offload", "Disable KV Offload", "boolean", "resources"],
  ["no-mmap", "Disable mmap", "boolean", "resources"],
  ["mlock", "Lock Memory", "boolean", "resources"],
  ["numa", "NUMA", "boolean", "resources"],
  ["threads", "Threads", "number", "performance"],
  ["threads-batch", "Threads (Batch)", "number", "performance"],
  ["threads-http", "Threads (HTTP)", "number", "performance"],
  ["batch-size", "Batch Size", "number", "performance"],
  ["ubatch-size", "Micro Batch Size", "number", "performance"],
  ["parallel", "Parallel Slots", "number", "performance"],
  ["cpu-mask", "CPU Mask", "text", "performance"],
  ["cpu-range", "CPU Range", "text", "performance"],
  ["prio", "CPU Priority", "number", "performance"],
  ["poll", "Poll", "number", "performance"],
  ["poll-batch", "Poll Batch", "number", "performance"],
  ["samplers", "Samplers", "text", "features", "top-k;top-p;min-p;temp"],
  ["temp", "Temperature", "number", "features"],
  ["top-k", "Top K", "number", "features"],
  ["top-p", "Top P", "number", "features"],
  ["min-p", "Min P", "number", "features"],
  ["typical", "Typical P", "number", "features"],
  ["repeat-last-n", "Repeat Last N", "number", "features"],
  ["repeat-penalty", "Repeat Penalty", "number", "features"],
  ["presence-penalty", "Presence Penalty", "number", "features"],
  ["frequency-penalty", "Frequency Penalty", "number", "features"],
  ["mirostat", "Mirostat", "number", "features"],
  ["mirostat-lr", "Mirostat LR", "number", "features"],
  ["mirostat-ent", "Mirostat Entropy", "number", "features"],
  ["ignore-eos", "Ignore EOS", "boolean", "features"],
  ["logit-bias", "Logit Bias", "text", "features", "token=weight,token=weight"],
  ["n-predict", "Max Tokens", "number", "features"],
  ["n-keep", "Tokens to Keep", "number", "features"],
  ["api-key", "API Key", "text", "features"],
]);

export const LLAMACPP_OPTION_KEYS = LLAMACPP_OPTIONS.map((option) => option.key);
