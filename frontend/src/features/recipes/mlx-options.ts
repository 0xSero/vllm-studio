import type { LlamacppOption } from "./llamacpp-options";

/**
 * MLX (`mlx_lm.server`) options surfaced in the editor. Everything else can be
 * supplied through Extra CLI Arguments. Keys map 1:1 to `mlx_lm.server` flags.
 */
export const MLX_OPTIONS: LlamacppOption[] = [
  {
    key: "adapter-path",
    label: "Adapter Path",
    type: "text",
    tab: "model",
    placeholder: "/path/to/adapters",
    description: "Optional LoRA/QLoRA adapter directory.",
  },
  {
    key: "chat-template",
    label: "Chat Template",
    type: "text",
    tab: "model",
    placeholder: "Jinja template or name",
  },
  {
    key: "use-default-chat-template",
    label: "Use Default Chat Template",
    type: "boolean",
    tab: "model",
  },
  {
    key: "chat-template-args",
    label: "Chat Template Args (JSON)",
    type: "text",
    tab: "model",
    placeholder: '{"enable_thinking": true}',
  },
  {
    key: "temp",
    label: "Temperature",
    type: "number",
    tab: "features",
    placeholder: "0.0",
  },
  {
    key: "top-p",
    label: "Top P",
    type: "number",
    tab: "features",
  },
  {
    key: "top-k",
    label: "Top K",
    type: "number",
    tab: "features",
  },
  {
    key: "min-p",
    label: "Min P",
    type: "number",
    tab: "features",
  },
  {
    key: "max-tokens",
    label: "Max Tokens",
    type: "number",
    tab: "features",
    placeholder: "Default",
  },
];

export const MLX_OPTION_KEYS = MLX_OPTIONS.map((option) => option.key);
