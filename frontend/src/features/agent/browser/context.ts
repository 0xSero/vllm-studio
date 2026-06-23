import type { BrowserBackend } from "@/features/agent/tools/types";

type BrowserContextPromptInput = {
  enabled: boolean;
  backend: BrowserBackend;
  url: string;
  modelId: string;
};

const VISION_MODEL_NEEDLES = [
  "4o",
  "vision",
  "vl",
  "qwen2.5-vl",
  "qwen3-vl",
  "gemma-3",
  "llava",
  "pixtral",
];

export function modelLikelySupportsVision(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return VISION_MODEL_NEEDLES.some((needle) => normalized.includes(needle));
}

export function browserContextPrompt({
  enabled,
  backend,
  url,
  modelId,
}: BrowserContextPromptInput): string {
  if (!enabled) return "";
  const activeUrl = url && url !== "about:blank" ? url : "about:blank";
  const vision = modelLikelySupportsVision(modelId);
  return [
    "<browser_context>",
    "The in-app Browser is open for this turn. Browser tools are available only because the Browser panel is open.",
    `Backend: ${backend}.`,
    `Active URL: ${activeUrl}.`,
    "The page body has not been preloaded into this prompt. To inspect it, call browser_get_text or browser_get_html first.",
    vision
      ? "Screenshots are available on demand with browser_screenshot when visual layout matters."
      : "This model may not be vision-capable; prefer browser_get_text/browser_get_html over browser_screenshot.",
    "Use browser_navigate only for intentional navigation.",
    // Counter the narrate-and-stop failure mode: when the browser is open, models
    // tend to emit a one-line plan ("Let me check X, then rebuild Y") with NO
    // tool call and stop — the agent loop ends the turn and nothing happens until
    // the user nudges "go on". Tell the model to ACT in the same turn instead.
    "When you state a plan, carry it out in the SAME turn by calling the tools you described — do not end your turn after only saying what you will do. Keep going until the task is complete, narrating briefly as you act.",
    "</browser_context>",
  ].join("\n");
}
