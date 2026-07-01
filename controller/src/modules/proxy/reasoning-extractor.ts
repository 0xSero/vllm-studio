import { parseToolCallsFromContent, stripToolCallsFromContent } from "./tool-call-parser";
import { createThinkRewriter } from "./think-rewriter";
import { firstReasoningField } from "./reasoning-fields";

const stripToolCallXmlBlocks = (text: string): string => {
  if (!text) return "";
  let cleaned = stripToolCallsFromContent(text);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  return cleaned.trim();
};

const collapseRepeatedVisibleContent = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length < 80) return text;
  for (let separatorLength = 0; separatorLength <= 4; separatorLength += 1) {
    const contentLength = trimmed.length - separatorLength;
    if (contentLength <= 0 || contentLength % 2 !== 0) continue;
    const midpoint = contentLength / 2;
    const first = trimmed.slice(0, midpoint).trimEnd();
    const second = trimmed.slice(midpoint + separatorLength).trimStart();
    if (first.length >= 40 && first === second) return first;
  }
  return text;
};

const extractThinkBlocks = (text: string): { cleaned: string; extracted: string } => {
  if (!text) return { cleaned: "", extracted: "" };

  const rewriter = createThinkRewriter();
  const { content, reasoningAppend } = rewriter.rewrite(String(text));
  const carry = rewriter.drainCarry();
  const cleaned = rewriter.inThink() ? content : content + carry;
  const extracted = rewriter.inThink() ? reasoningAppend + carry : reasoningAppend;

  return { cleaned: cleaned.trim(), extracted: extracted.trim() };
};

export const normalizeReasoningAndContentInMessage = (message: Record<string, unknown>): void => {
  const contentRaw = typeof message["content"] === "string" ? String(message["content"]) : "";
  const reasoningRaw = firstReasoningField(message);

  const contentThink = extractThinkBlocks(contentRaw);
  const reasoningThink = extractThinkBlocks(reasoningRaw);

  const nextReasoning = [reasoningThink.cleaned, contentThink.extracted, reasoningThink.extracted]
    .filter((v) => v.trim().length > 0)
    .join("\n");
  const nextContent = contentThink.cleaned;

  if (nextContent !== contentRaw) message["content"] = nextContent;
  if (message["reasoning_content"] !== nextReasoning) message["reasoning_content"] = nextReasoning;

  const strippedContent = stripToolCallXmlBlocks(
    typeof message["content"] === "string" ? String(message["content"]) : ""
  );
  const strippedReasoning = stripToolCallXmlBlocks(
    typeof message["reasoning_content"] === "string" ? String(message["reasoning_content"]) : ""
  );
  message["content"] = collapseRepeatedVisibleContent(strippedContent);
  if (strippedReasoning) {
    message["reasoning_content"] = strippedReasoning;
  } else {
    delete message["reasoning_content"];
  }
  delete message["reasoning"];
  delete message["reasoning_text"];
};

export const normalizeToolCallsInMessage = (message: Record<string, unknown>): boolean => {
  const existing = message["tool_calls"];
  const hasToolCalls = Array.isArray(existing) && existing.length > 0;
  if (hasToolCalls) {
    return false;
  }
  const content = typeof message["content"] === "string" ? String(message["content"]) : "";
  const parsed = parseToolCallsFromContent(content);
  if (parsed.length > 0) {
    message["tool_calls"] = parsed;
    return true;
  }
  return false;
};
