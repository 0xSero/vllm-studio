import { randomUUID } from "node:crypto";
import { parseJsonWithRepair } from "@earendil-works/pi-ai";
import { Option, Schema } from "effect";

export interface ToolCall {
  index: number;
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export const createToolCallId = (): string => `call_${randomUUID().replace(/-/g, "").slice(0, 9)}`;

const ToolArgumentSchema = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.Unknown),
  Schema.Record(Schema.String, Schema.Unknown),
]);
type ToolArgument = Schema.Schema.Type<typeof ToolArgumentSchema>;
interface ParameterArguments {
  [name: string]: ToolArgument;
}
interface ParsedToolCall {
  name: string;
  args: ToolArgument;
}

const ToolCallPayloadSchema = Schema.Struct({
  tool: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  args: Schema.optional(ToolArgumentSchema),
  arguments: Schema.optional(ToolArgumentSchema),
  parameters: Schema.optional(ToolArgumentSchema),
});

const parseJsonCandidate = (value: string): ToolArgument | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const decoded = parseJsonWithRepair<ToolArgument>(trimmed);
    return Option.getOrNull(Schema.decodeUnknownOption(ToolArgumentSchema)(decoded));
  } catch {
    return null;
  }
};

const coerceArguments = (value: ToolArgument | undefined): string => {
  if (Schema.is(Schema.String)(value)) return value.trim();
  if (value === undefined || value === null) return "{}";
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
};

const toolCallRecordFromParsed = (parsed: ToolArgument | null): ParsedToolCall | null => {
  const payload = Option.getOrNull(Schema.decodeUnknownOption(ToolCallPayloadSchema)(parsed));
  if (!payload) return null;
  const name = (payload.tool ?? payload.name ?? "").trim();
  if (!name) return null;
  return {
    name,
    args: payload.args ?? payload.arguments ?? payload.parameters ?? {},
  };
};

const parseParameterBlocks = (block: string): ParameterArguments | null => {
  const args: ParameterArguments = {};
  const parameterPattern = /<parameter(?:\s+name=|=)([^>\s]+)>([\s\S]*?)<\/parameter>/gi;
  let found = false;
  for (const match of block.matchAll(parameterPattern)) {
    const name = String(match[1] ?? "")
      .replace(/["']/g, "")
      .trim();
    if (!name) continue;
    found = true;
    const rawValue = String(match[2] ?? "").trim();
    const parsed =
      rawValue && (rawValue.startsWith("{") || rawValue.startsWith("["))
        ? parseJsonCandidate(rawValue)
        : null;
    args[name] = parsed ?? rawValue;
  }
  return found ? args : null;
};

const parseInvokeToolCalls = (content: string, startIndex: number): ToolCall[] => {
  const toolCalls: ToolCall[] = [];
  const invokePattern = /<invoke\s+name=(["']?)([^"'\s>]+)\1[^>]*>([\s\S]*?)<\/invoke>/gi;
  for (const match of content.matchAll(invokePattern)) {
    const name = String(match[2] ?? "").trim();
    if (!name) continue;
    const args = parseParameterBlocks(String(match[3] ?? "")) ?? {};
    toolCalls.push(buildToolCall(name, args, startIndex + toolCalls.length));
  }
  return toolCalls;
};

const extractQuotedValue = (input: string, start: number): string | null => {
  let escaping = false;
  for (let cursor = start + 1; cursor < input.length; cursor += 1) {
    const char = input[cursor];
    if (escaping) {
      escaping = false;
    } else if (char === "\\") {
      escaping = true;
    } else if (char === '"') {
      return input.slice(start, cursor + 1);
    }
  }
  return null;
};

const extractContainerValue = (
  input: string,
  start: number,
  open: "{" | "[",
  close: "}" | "]",
): string | null => {
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let cursor = start; cursor < input.length; cursor += 1) {
    const char = input[cursor];
    if (inString) {
      if (escaping) escaping = false;
      else if (char === "\\") escaping = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return input.slice(start, cursor + 1);
    }
  }
  return null;
};

const extractBalancedValue = (input: string, start: number): string | null => {
  let index = start;
  while (index < input.length && /\s/.test(input[index] ?? "")) index += 1;
  const open = input[index];
  if (open === '"') return extractQuotedValue(input, index);
  if (open === "{") return extractContainerValue(input, index, open, "}");
  if (open === "[") return extractContainerValue(input, index, open, "]");
  return null;
};

const parseJsonToolCalls = (content: string, startIndex: number): ToolCall[] => {
  const toolCalls: ToolCall[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const objectStart = content.indexOf("{", cursor);
    if (objectStart < 0) break;
    const raw = extractBalancedValue(content, objectStart);
    if (!raw) {
      cursor = objectStart + 1;
      continue;
    }
    const parsed = parseJsonCandidate(raw);
    const record = toolCallRecordFromParsed(parsed);
    if (record) {
      toolCalls.push(buildToolCall(record.name, record.args, startIndex + toolCalls.length));
    }
    cursor = objectStart + raw.length;
  }
  return toolCalls;
};

export const stripToolCallsFromContent = (content: string): string => {
  if (!content) return "";
  let cleaned = content;
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  cleaned = cleaned.replace(/<invoke\s+name=(["']?)[^"'\s>]+\1[^>]*>[\s\S]*?<\/invoke>/gi, "");
  cleaned = cleaned.replace(/<?use_mcp[\s_]*tool>[\s\S]*?<\/use_mcp[\s_]*tool>/gi, "");
  cleaned = cleaned.replace(/(^|\n)[^\n]*\{[^\n]*\}[^\n]*(?=\n|$)/g, (line) => {
    return parseJsonToolCalls(line, 0).length > 0 ? (line.startsWith("\n") ? "\n" : "") : line;
  });
  // A tool call that opened but never closed (split across stream deltas, or
  // truncated) — drop the dangling block from the opening tag to the end so its
  // half-written arguments don't leak into the answer/reasoning.
  cleaned = cleaned.replace(/<tool_call>[\s\S]*$/i, "");
  // Final pass: remove ORPHAN tool-call structural tags. The <parameter>/
  // <arg_value> dialect, or a fragment whose opening tag arrived in an earlier
  // delta, can leave a stray tag (e.g. a lone "</arg_value>") that the patterns
  // above don't match — which then leaks into the visible answer or the
  // reasoning bubble. These tags never occur in real prose.
  cleaned = cleaned.replace(
    /<\/?(?:tool_call|arguments|arg_value|arg_key|invoke|function|parameter)(?:[=\s][^>]*)?>/gi,
    "",
  );
  return cleaned;
};

const buildToolCall = (name: string, args: ToolArgument, index: number): ToolCall => ({
  index,
  id: createToolCallId(),
  type: "function",
  function: { name, arguments: coerceArguments(args) },
});

const parseTaggedToolCalls = (content: string): ToolCall[] => {
  const toolCalls: ToolCall[] = [];
  const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  for (const match of content.matchAll(toolCallPattern)) {
    const block = String(match[1] ?? "");
    const functionMatch = block.match(/<function(?:=|\s+name=)([^>\s]+)[^>]*>/i);
    const toolName = functionMatch ? String(functionMatch[1]).replace(/["']/g, "").trim() : "";
    const argsMatch = block.match(/<arguments>([\s\S]*?)<\/arguments>/i);
    const rawArguments = argsMatch ? String(argsMatch[1] ?? "").trim() : "";
    const args = rawArguments
      ? (parseJsonCandidate(rawArguments) ?? rawArguments)
      : (parseParameterBlocks(block) ?? {});
    if (toolName) {
      toolCalls.push(buildToolCall(toolName, args, toolCalls.length));
      continue;
    }
    const jsonCandidate = block.match(/\{[\s\S]*\}/);
    const record = toolCallRecordFromParsed(
      jsonCandidate ? parseJsonCandidate(jsonCandidate[0]) : null,
    );
    if (record) toolCalls.push(buildToolCall(record.name, record.args, toolCalls.length));
  }
  return toolCalls;
};

const parseEmbeddedArgumentCalls = (content: string): ToolCall[] => {
  const toolCalls: ToolCall[] = [];
  const jsonPattern = /"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*/g;
  for (const match of content.matchAll(jsonPattern)) {
    const name = String(match[1] ?? "").trim();
    const argsStart = (match.index ?? 0) + match[0].length;
    const argsRaw = extractBalancedValue(content.slice(argsStart), 0) ?? "";
    const parsedArguments = argsRaw ? (parseJsonCandidate(argsRaw) ?? argsRaw) : {};
    if (name) toolCalls.push(buildToolCall(name, parsedArguments, toolCalls.length));
  }
  return toolCalls;
};

export const parseToolCallsFromContent = (content: string): ToolCall[] => {
  if (!content) return [];
  const tagged = parseTaggedToolCalls(content);
  if (tagged.length > 0) return tagged;
  const invoked = parseInvokeToolCalls(content, 0);
  if (invoked.length > 0) return invoked;
  const objects = parseJsonToolCalls(content, 0);
  return objects.length > 0 ? objects : parseEmbeddedArgumentCalls(content);
};
