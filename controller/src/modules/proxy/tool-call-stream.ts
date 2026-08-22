import { randomUUID } from "node:crypto";
import {
  parseToolCallsFromContent,
  stripToolCallsFromContent,
  type ToolCall,
} from "./tool-call-parser";
import {
  REASONING_FIELDS,
  firstReasoningField,
  createThinkRewriter,
  stripDeepSeekControlTokens,
  thinkingTagPrefixIsPartial,
} from "./reasoning";
import type { InferenceUsageInput } from "./inference-accounting";

export interface ToolCallStreamOptions {
  bufferImplicitReasoningContent?: boolean;
}

type TextHistory = Map<string, { text: string; snapshot: boolean }>;

export const createToolCallStream = (
  source: ReadableStream<Uint8Array>,
  onUsage?: (usage: InferenceUsageInput) => void,
  onFirstToken?: () => void,
  options: ToolCallStreamOptions = {},
): ReadableStream<Uint8Array> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let pendingEventLines: string[] = [];
  let visibleContentBuffer = "";
  let toolCallsFound = false;
  let usageTracked = false;
  let firstTokenTracked = false;
  const contentHistory: TextHistory = new Map();
  const reasoningHistory: TextHistory = new Map();
  const replayCursors = new Map<string, number>();
  const stripToolXmlDelta = (text: string): string =>
    stripToolCallsFromContent(stripDeepSeekControlTokens(text));

  const normalizeTextDelta = (
    history: TextHistory,
    key: string,
    text: string,
    forceSnapshot = false,
  ): string => {
    if (!text) return text;
    const previous = history.get(key) ?? { text: "", snapshot: forceSnapshot };
    const replayCursor = replayCursors.get(key);
    if (replayCursor !== undefined) {
      const expected = previous.text.slice(replayCursor, replayCursor + text.length);
      if (expected === text) {
        const nextCursor = replayCursor + text.length;
        if (nextCursor >= previous.text.length) replayCursors.delete(key);
        else replayCursors.set(key, nextCursor);
        return "";
      }
      replayCursors.delete(key);
      const resurrected = previous.text.slice(0, replayCursor);
      const merged = resurrected + text;
      history.set(key, { text: previous.text + merged, snapshot: false });
      return merged;
    }
    const isCumulative =
      previous.text.length > 0 &&
      text.length > previous.text.length &&
      text.startsWith(previous.text);
    const shouldSlice = forceSnapshot || previous.snapshot || isCumulative;

    if (shouldSlice) {
      history.set(key, { text, snapshot: true });
      return isCumulative ? text.slice(previous.text.length) : text;
    }

    if (
      text.trim() !== "" &&
      previous.text.length > text.length &&
      previous.text.startsWith(text)
    ) {
      replayCursors.set(key, text.length);
      return "";
    }

    history.set(key, { text: previous.text + text, snapshot: false });
    return text;
  };

  const contentThink = createThinkRewriter({
    bufferImplicitReasoningContent: Boolean(options.bufferImplicitReasoningContent),
  });
  const reasoningThink = createThinkRewriter();

  const enqueueLine = (
    controller: TransformStreamDefaultController<Uint8Array>,
    line: string,
  ): void => {
    controller.enqueue(encoder.encode(`${line}\n`));
  };
  const enqueueLines = (
    controller: TransformStreamDefaultController<Uint8Array>,
    lines: string[],
  ): void => {
    for (const line of lines) enqueueLine(controller, line);
  };
  const enqueueDataEvent = (
    controller: TransformStreamDefaultController<Uint8Array>,
    dataLine: string,
  ): void => {
    enqueueLine(controller, dataLine);
    enqueueLine(controller, "");
  };

  const chunkId = (): string => `chatcmpl-${randomUUID().slice(0, 8)}`;

  const buildToolCallChunk = (toolCalls: ToolCall[]): string =>
    `data: ${JSON.stringify({
      id: chunkId(),
      choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: "tool_calls" }],
    })}`;

  const buildFlushChunk = (payload: {
    content?: string;
    reasoning_content?: string;
  }): string | null => {
    const content = payload.content ?? "";
    const reasoning = payload.reasoning_content ?? "";
    if (!content && !reasoning) return null;
    const delta: Record<string, string> = {};
    if (content) delta["content"] = content;
    if (reasoning) delta["reasoning_content"] = reasoning;
    return `data: ${JSON.stringify({ id: chunkId(), choices: [{ index: 0, delta }] })}`;
  };

  const emitVisibleContent = (
    controller: TransformStreamDefaultController<Uint8Array>,
    content: string,
  ): void => {
    if (!content) return;
    const controlTokensStripped = stripDeepSeekControlTokens(content);
    visibleContentBuffer += controlTokensStripped;
    const cleaned = stripToolXmlDelta(controlTokensStripped);
    const chunk = buildFlushChunk({ content: cleaned });
    if (chunk) enqueueDataEvent(controller, chunk);
  };

  const flushThinkCarry = (controller: TransformStreamDefaultController<Uint8Array>): void => {
    emitVisibleContent(controller, contentThink.drainPendingContent());
    const tail = contentThink.drainCarry();
    if (!tail) return;
    const cleaned = stripToolXmlDelta(tail);
    const chunk = buildFlushChunk(
      contentThink.inThink() || thinkingTagPrefixIsPartial(tail.trim())
        ? { reasoning_content: cleaned }
        : { content: cleaned },
    );
    if (chunk) enqueueDataEvent(controller, chunk);
  };

  const parseUsage = (data: Record<string, unknown>): void => {
    if (usageTracked || !onUsage) return;
    const usage = data["usage"] as InferenceUsageInput | undefined;
    if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
      onUsage(usage);
      usageTracked = true;
    }
  };

  const trackFirstToken = (): void => {
    if (firstTokenTracked) return;
    firstTokenTracked = true;
    onFirstToken?.();
  };

  const maybeInjectToolCalls = (controller: TransformStreamDefaultController<Uint8Array>): void => {
    if (toolCallsFound || !visibleContentBuffer) return;
    const parsed = parseToolCallsFromContent(visibleContentBuffer);
    if (parsed.length > 0) {
      enqueueDataEvent(controller, buildToolCallChunk(parsed));
      toolCallsFound = true;
    }
  };

  const flushEvent = (
    controller: TransformStreamDefaultController<Uint8Array>,
    lines: string[],
  ): void => {
    if (lines.length === 0) return;

    const dataLines: string[] = [];
    const otherLines: string[] = [];
    for (const rawLine of lines) {
      const trimmedStart = rawLine.trimStart();
      if (trimmedStart.startsWith("data:")) {
        dataLines.push(trimmedStart.slice("data:".length).trimStart());
      } else if (rawLine.length > 0) {
        otherLines.push(rawLine);
      }
    }

    if (dataLines.length === 0) {
      enqueueLines(controller, lines);
      return;
    }

    const data = dataLines.join("\n").trim();
    if (data === "[DONE]") {
      flushThinkCarry(controller);
      maybeInjectToolCalls(controller);
      enqueueLines(controller, otherLines);
      enqueueDataEvent(controller, "data: [DONE]");
      return;
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    if (!parsed) {
      enqueueLines(controller, lines);
      return;
    }

    parseUsage(parsed);
    const choices = parsed["choices"];
    if (Array.isArray(choices)) {
      for (const [choiceIndex, choice] of choices.entries()) {
        const choiceRecord = choice as Record<string, unknown>;
        const hasDelta = choiceRecord["delta"] && typeof choiceRecord["delta"] === "object";
        const delta = (hasDelta ? choiceRecord["delta"] : choiceRecord["message"]) as
          | Record<string, unknown>
          | undefined;
        if (!delta) continue;
        const toolCalls = delta["tool_calls"];
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          toolCallsFound = true;
          trackFirstToken();
        }
        const normalize = (history: TextHistory, field: string, text: string): string =>
          normalizeTextDelta(history, `${choiceIndex}:${field}`, text, !hasDelta);
        const rawContent = typeof delta["content"] === "string" ? String(delta["content"]) : "";
        const content = normalize(contentHistory, "content", rawContent);
        const rawReasoning = firstReasoningField(delta);
        const reasoningRaw = rawReasoning
          ? normalize(reasoningHistory, "reasoning", rawReasoning)
          : "";
        if (rawReasoning)
          emitVisibleContent(controller, contentThink.resolveImplicitPrefixAsContent());
        if (content || reasoningRaw) trackFirstToken();
        let reasoningFromContent = "";
        if (content) {
          const rewritten = contentThink.rewrite(content, false);
          const controlTokensStripped = stripDeepSeekControlTokens(rewritten.content);
          visibleContentBuffer += controlTokensStripped;
          const cleanedContent = stripToolXmlDelta(controlTokensStripped);
          if (cleanedContent) {
            delta["content"] = cleanedContent;
          } else if ("content" in delta) {
            delete delta["content"];
          }
          reasoningFromContent = rewritten.reasoningAppend;
        } else if (rawContent && "content" in delta) {
          delete delta["content"];
        }

        const reasoning =
          (reasoningRaw ? reasoningThink.rewrite(reasoningRaw, true).reasoningAppend : "") +
          reasoningFromContent;

        if (reasoning) {
          delta["reasoning_content"] = stripToolXmlDelta(reasoning);
        } else if (REASONING_FIELDS.some((field) => field in delta)) {
          delete delta["reasoning_content"];
        }
        delete delta["reasoning"];
        delete delta["reasoning_text"];
      }
    }

    enqueueLines(controller, otherLines);
    enqueueDataEvent(controller, `data: ${JSON.stringify(parsed)}`);
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller): void {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (normalized === "") {
          flushEvent(controller, pendingEventLines);
          pendingEventLines = [];
          enqueueLine(controller, "");
        } else {
          pendingEventLines.push(normalized);
        }
      }
    },
    flush(controller): void {
      buffer += decoder.decode();
      if (buffer) {
        const trailing = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
        if (trailing) pendingEventLines.push(trailing);
        buffer = "";
      }
      if (pendingEventLines.length > 0) {
        flushEvent(controller, pendingEventLines);
        pendingEventLines = [];
      }
      flushThinkCarry(controller);
      maybeInjectToolCalls(controller);
    },
  });
  return source.pipeThrough(transform);
};
