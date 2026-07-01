/**
 * Per-model quirks for reasoning/thinking content that don't belong in the
 * general-purpose reasoning-extractor (that file handles the universal
 * `<think>`/tool-call-XML shapes; these two are narrow, model-specific
 * workarounds).
 */

/**
 * Trinity's "thinking" variant sometimes returns a response with empty
 * visible `content` but a populated `reasoning`/`reasoning_content` field —
 * callers that only render `content` would see a blank message. Promote the
 * reasoning text into `content` so it's visible, while still keeping it in
 * `reasoning_content` for callers that distinguish the two.
 */
export const exposeReasoningAsContentWhenEmpty = (
  message: Record<string, unknown>,
  model: string
): boolean => {
  const modelLower = model.toLowerCase();
  if (!modelLower.includes("trinity-large-thinking")) return false;

  const content = typeof message["content"] === "string" ? message["content"].trim() : "";
  if (content) return false;

  const reasoning =
    typeof message["reasoning"] === "string"
      ? message["reasoning"].trim()
      : typeof message["reasoning_content"] === "string"
        ? message["reasoning_content"].trim()
        : "";
  if (!reasoning) return false;

  message["content"] = reasoning;
  if (!message["reasoning_content"]) {
    message["reasoning_content"] = reasoning;
  }
  return true;
};

export const shouldBufferImplicitReasoningContent = (
  model: string,
  reasoningParser: string | null | undefined
): boolean => {
  const parser = (reasoningParser ?? "").toLowerCase();
  const modelLower = model.toLowerCase();
  return (
    parser === "deepseek_r1" ||
    parser === "minimax_m2_append_think" ||
    modelLower.includes("deepseek") ||
    modelLower.includes("r1") ||
    modelLower.includes("reasoning") ||
    modelLower.includes("thinking")
  );
};
