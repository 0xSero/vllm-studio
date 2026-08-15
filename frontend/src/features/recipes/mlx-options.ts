import { defineEngineOptions } from "./llamacpp-options";

export const MLX_OPTIONS = defineEngineOptions([
  [
    "adapter-path",
    "Adapter Path",
    "text",
    "model",
    "/path/to/adapters",
    null,
    "Optional LoRA/QLoRA adapter directory.",
  ],
  ["chat-template", "Chat Template", "text", "model", "Jinja template or name"],
  ["use-default-chat-template", "Use Default Chat Template", "boolean", "model"],
  ["chat-template-args", "Chat Template Args (JSON)", "text", "model", '{"enable_thinking": true}'],
  ["temp", "Temperature", "number", "features", "0.0"],
  ["top-p", "Top P", "number", "features"],
  ["top-k", "Top K", "number", "features"],
  ["min-p", "Min P", "number", "features"],
  ["max-tokens", "Max Tokens", "number", "features", "Default"],
]);

export const MLX_OPTION_KEYS = MLX_OPTIONS.map((option) => option.key);
