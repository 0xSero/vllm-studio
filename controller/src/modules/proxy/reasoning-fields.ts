// Reasoning text can arrive under different keys depending on the upstream
// OpenAI-compatible server: vLLM/SGLang emit `reasoning_content`, while some
// endpoints use `reasoning` or `reasoning_text`. This mirrors how the pi SDK
// resolves reasoning (see @earendil-works/pi-ai openai-completions): take the
// first non-empty field so the same text is never counted twice.
export const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;

/** Return the first non-empty reasoning field on a delta/message record. */
export const firstReasoningField = (record: Record<string, unknown>): string => {
  for (const field of REASONING_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
};
