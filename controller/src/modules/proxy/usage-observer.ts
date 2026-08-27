import type { InferenceUsageInput } from "./inference-accounting";

/**
 * Usage extraction for the three passthrough dialects. The controller never
 * rewrites what an engine says — these helpers only read token counts out of
 * response payloads (and SSE frames) so requests can be recorded.
 */
export type ProxyDialect = "chat" | "responses" | "messages";

export type ProxyValue = string | number | boolean | null | ProxyPayload | ProxyValue[];

interface TokenDetails {
  [key: string]: number;
  cached_tokens: number;
  reasoning_tokens: number;
}

export interface ProxyPayload {
  [key: string]: ProxyValue | undefined;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  chat_id?: ProxyValue;
  completion_tokens?: number;
  completion_tokens_details?: TokenDetails;
  input_tokens?: number;
  input_tokens_details?: TokenDetails;
  message?: ProxyPayload;
  metadata?: ProxyPayload;
  model?: ProxyValue;
  output_tokens?: number;
  output_tokens_details?: TokenDetails;
  prompt_tokens?: number;
  prompt_tokens_details?: TokenDetails;
  response?: ProxyPayload;
  sessionId?: ProxyValue;
  session_id?: ProxyValue;
  stream?: ProxyValue;
  stream_options?: ProxyPayload;
  usage?: ProxyPayload;
}

export const stringFromProxyValue = (value: ProxyValue | undefined): string | null =>
  Object.prototype.toString.call(value) === "[object String]"
    ? String.prototype.valueOf.call(value)
    : null;

export const isProxyObject = (value: ProxyValue | undefined): value is ProxyPayload =>
  value !== null && value !== undefined && Object.getPrototypeOf(value) === Object.prototype;

const asCount = (value: number | undefined): number | undefined =>
  Number.isFinite(value) && value !== undefined && value >= 0 ? value : undefined;

type CountField =
  | "prompt_tokens"
  | "completion_tokens"
  | "reasoning_tokens"
  | "cache_read_tokens"
  | "cache_write_tokens";

const setCount = (
  target: InferenceUsageInput,
  field: CountField,
  value: number | undefined,
): void => {
  const count = asCount(value);
  if (count !== undefined) target[field] = count;
};

const chatUsage = (usage: ProxyPayload): InferenceUsageInput => {
  const result: InferenceUsageInput = {};
  setCount(result, "prompt_tokens", usage.prompt_tokens);
  setCount(result, "completion_tokens", usage.completion_tokens);
  if (isProxyObject(usage.prompt_tokens_details)) {
    result.prompt_tokens_details = usage.prompt_tokens_details;
  }
  if (isProxyObject(usage.completion_tokens_details)) {
    result.completion_tokens_details = usage.completion_tokens_details;
  }
  return result;
};

const responsesUsage = (usage: ProxyPayload): InferenceUsageInput => {
  const result: InferenceUsageInput = {};
  setCount(result, "prompt_tokens", usage.input_tokens);
  setCount(result, "completion_tokens", usage.output_tokens);
  setCount(result, "reasoning_tokens", usage.output_tokens_details?.reasoning_tokens);
  setCount(result, "cache_read_tokens", usage.input_tokens_details?.cached_tokens);
  return result;
};

const messagesUsage = (usage: ProxyPayload): InferenceUsageInput => {
  const result: InferenceUsageInput = {};
  setCount(result, "prompt_tokens", usage.input_tokens);
  setCount(result, "completion_tokens", usage.output_tokens);
  setCount(result, "cache_read_tokens", usage.cache_read_input_tokens);
  setCount(result, "cache_write_tokens", usage.cache_creation_input_tokens);
  return result;
};

/** Usage out of one payload: a non-streaming body, or one parsed SSE data frame. */
export const usageFromPayload = (
  dialect: ProxyDialect,
  payload: ProxyPayload,
): InferenceUsageInput | null => {
  const envelope =
    dialect === "responses" && isProxyObject(payload.response)
      ? payload.response
      : dialect === "messages" && isProxyObject(payload.message)
        ? payload.message
        : payload;
  const usage = envelope.usage;
  if (!isProxyObject(usage)) return null;
  const extracted =
    dialect === "chat"
      ? chatUsage(usage)
      : dialect === "responses"
        ? responsesUsage(usage)
        : messagesUsage(usage);
  return Object.keys(extracted).length > 0 ? extracted : null;
};

export interface UsageObserverCallbacks {
  onUsage: (usage: InferenceUsageInput) => void;
  onFirstFrame: () => void;
}

export const createUsageObserver = (
  dialect: ProxyDialect,
  callbacks: UsageObserverCallbacks,
): TransformStream<Uint8Array, Uint8Array> => {
  const decoder = new TextDecoder();
  let buffer = "";
  let sawFrame = false;

  const observeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    if (!sawFrame) {
      sawFrame = true;
      callbacks.onFirstFrame();
    }
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") return;
    try {
      const parsed: ProxyPayload = Object(JSON.parse(data));
      const usage = usageFromPayload(dialect, parsed);
      if (usage) callbacks.onUsage(usage);
    } catch {
      // Partial or non-JSON frame: recording is best-effort, forwarding is not.
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller): void {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) observeLine(line);
    },
    flush(): void {
      buffer += decoder.decode();
      if (buffer) observeLine(buffer);
    },
  });
};
