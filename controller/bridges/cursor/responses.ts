import { randomUUID } from "node:crypto";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  Message,
  Model,
  MutableModels,
  ProviderStreams,
  TextContent,
  ThinkingLevel,
  Tool,
  ToolCall,
} from "@earendil-works/pi-ai";
import { Effect } from "effect";
type HeadProviderCompletion = {
  response: Record<string, unknown>;
  status: number;
};

type HeadProviderResponse = {
  response: Response;
  completion: Promise<HeadProviderCompletion | null>;
};

const encoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const emptyUsage = (): AssistantMessage["usage"] => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const imageFromUrl = (value: unknown): ImageContent | null => {
  if (typeof value !== "string") return null;
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { type: "image", mimeType: match[1], data: match[2] };
};

const contentParts = (value: unknown): (TextContent | ImageContent)[] => {
  if (typeof value === "string") return value ? [{ type: "text", text: value }] : [];
  if (!Array.isArray(value)) return [];
  const content: (TextContent | ImageContent)[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const type = entry["type"];
    if (["input_text", "output_text", "text", "summary_text"].includes(String(type))) {
      if (typeof entry["text"] === "string") content.push({ type: "text", text: entry["text"] });
      continue;
    }
    if (type === "input_image" || type === "image") {
      const image = imageFromUrl(entry["image_url"] ?? entry["url"]);
      if (image) content.push(image);
    }
  }
  return content;
};

const contentText = (value: unknown): string =>
  contentParts(value)
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");

const assistantMessage = (
  model: Model<Api>,
  content: AssistantMessage["content"],
): AssistantMessage => ({
  role: "assistant",
  content,
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: emptyUsage(),
  stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
  timestamp: Date.now(),
});

const parseArguments = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const appendAssistantBlock = (
  messages: Message[],
  model: Model<Api>,
  block: AssistantMessage["content"][number],
): void => {
  const previous = messages[messages.length - 1];
  if (previous?.role === "assistant") {
    previous.content.push(block);
    previous.stopReason = previous.content.some((part) => part.type === "toolCall")
      ? "toolUse"
      : "stop";
    return;
  }
  messages.push(assistantMessage(model, [block]));
};

const requestContext = (model: Model<Api>, request: Record<string, unknown>): Context => {
  const messages: Message[] = [];
  const system: string[] = [];
  const toolCalls = new Map<string, { id: string; name: string }>();
  if (typeof request["instructions"] === "string" && request["instructions"]) {
    system.push(request["instructions"]);
  }
  const input = request["input"];
  const entries = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      messages.push({ role: "user", content: entry, timestamp: Date.now() });
      continue;
    }
    if (!isRecord(entry)) continue;
    const role = entry["role"];
    const type = entry["type"];
    if (role === "system" || role === "developer") {
      const text = contentText(entry["content"]);
      if (text) system.push(text);
      continue;
    }
    if (role === "user") {
      const content = contentParts(entry["content"]);
      if (content.length > 0) messages.push({ role: "user", content, timestamp: Date.now() });
      continue;
    }
    if (role === "assistant" || (type === "message" && role === "assistant")) {
      const text = contentText(entry["content"]);
      if (text) appendAssistantBlock(messages, model, { type: "text", text });
      continue;
    }
    if (type === "function_call" || type === "custom_tool_call") {
      const callId = typeof entry["call_id"] === "string" ? entry["call_id"] : randomUUID();
      const itemId = typeof entry["id"] === "string" ? entry["id"] : `fc_${randomUUID()}`;
      const name = typeof entry["name"] === "string" ? entry["name"] : "tool";
      const toolCallId = `${callId}|${itemId}`;
      toolCalls.set(callId, { id: toolCallId, name });
      appendAssistantBlock(messages, model, {
        type: "toolCall",
        id: toolCallId,
        name,
        arguments: parseArguments(entry["arguments"] ?? entry["input"]),
      });
      continue;
    }
    if (type === "function_call_output" || type === "custom_tool_call_output") {
      const callId = typeof entry["call_id"] === "string" ? entry["call_id"] : randomUUID();
      const output = contentParts(entry["output"]);
      const toolCall = toolCalls.get(callId);
      messages.push({
        role: "toolResult",
        toolCallId: toolCall?.id ?? callId,
        toolName: toolCall?.name ?? "tool",
        content: output.length > 0 ? output : [{ type: "text", text: "(no tool output)" }],
        isError: false,
        timestamp: Date.now(),
      });
    }
  }
  const tools: Tool[] = [];
  if (Array.isArray(request["tools"])) {
    for (const entry of request["tools"]) {
      if (!isRecord(entry) || entry["type"] !== "function" || typeof entry["name"] !== "string") {
        continue;
      }
      tools.push({
        name: entry["name"],
        description: typeof entry["description"] === "string" ? entry["description"] : "",
        parameters: (isRecord(entry["parameters"])
          ? entry["parameters"]
          : { type: "object", properties: {} }) as Tool["parameters"],
      });
    }
  }
  return {
    ...(system.length > 0 ? { systemPrompt: system.join("\n\n") } : {}),
    messages,
    ...(tools.length > 0 ? { tools } : {}),
  };
};

const reasoningLevel = (request: Record<string, unknown>): ThinkingLevel | undefined => {
  const reasoning = request["reasoning"];
  if (!isRecord(reasoning) || typeof reasoning["effort"] !== "string") return undefined;
  const effort = reasoning["effort"];
  if (effort === "none") return undefined;
  if (["minimal", "low", "medium", "high", "xhigh"].includes(effort)) {
    return effort === "xhigh" ? "high" : (effort as ThinkingLevel);
  }
  return undefined;
};

type ResponseOutputItem = Record<string, unknown>;

type OutputSlot = {
  id: string;
  outputIndex: number;
  item: ResponseOutputItem;
  text: string;
};

const responseUsage = (message: AssistantMessage): Record<string, unknown> => ({
  input_tokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
  input_tokens_details: {
    cached_tokens: message.usage.cacheRead,
    cache_write_tokens: message.usage.cacheWrite,
  },
  output_tokens: message.usage.output,
  output_tokens_details: { reasoning_tokens: message.usage.reasoning ?? 0 },
  total_tokens: message.usage.totalTokens,
});

const responseBase = (
  responseId: string,
  modelId: string,
  status: "in_progress" | "completed" | "failed",
  output: ResponseOutputItem[],
  usage: Record<string, unknown> | null,
): Record<string, unknown> => ({
  id: responseId,
  object: "response",
  created_at: Math.floor(Date.now() / 1000),
  status,
  model: modelId,
  output,
  parallel_tool_calls: true,
  tool_choice: "auto",
  tools: [],
  usage,
});

const asSse = (event: Record<string, unknown>): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

const terminalOutput = (slots: Map<number, OutputSlot>): ResponseOutputItem[] =>
  [...slots.values()]
    .sort((left, right) => left.outputIndex - right.outputIndex)
    .map((slot) => slot.item);

const createEventPump = (input: {
  stream: AsyncIterable<AssistantMessageEvent>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  responseId: string;
  modelId: string;
  signal: AbortSignal;
  resolve: (completion: HeadProviderCompletion | null) => void;
}): Promise<Record<string, unknown> | null> => {
  const slots = new Map<number, OutputSlot>();
  let sequence = 0;
  let settled = false;
  const emit = (event: Record<string, unknown>): void => {
    sequence += 1;
    input.controller.enqueue(asSse({ ...event, sequence_number: sequence }));
  };
  const ensureSlot = (
    contentIndex: number,
    kind: "reasoning" | "message" | "function_call",
    toolCall?: ToolCall,
  ): OutputSlot => {
    const existing = slots.get(contentIndex);
    if (existing) return existing;
    const id =
      kind === "reasoning"
        ? `rs_${randomUUID()}`
        : kind === "message"
          ? `msg_${randomUUID()}`
          : `fc_${randomUUID()}`;
    const item: ResponseOutputItem =
      kind === "reasoning"
        ? { id, type: "reasoning", status: "in_progress", summary: [] }
        : kind === "message"
          ? { id, type: "message", status: "in_progress", role: "assistant", content: [] }
          : {
              id,
              type: "function_call",
              status: "in_progress",
              call_id: toolCall?.id ?? randomUUID(),
              name: toolCall?.name ?? "tool",
              arguments: "",
            };
    const slot = { id, outputIndex: contentIndex, item, text: "" };
    slots.set(contentIndex, slot);
    emit({ type: "response.output_item.added", output_index: contentIndex, item });
    return slot;
  };
  const finish = (completion: HeadProviderCompletion | null): void => {
    if (settled) return;
    settled = true;
    input.resolve(completion);
  };
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        try {
          emit({
            type: "response.created",
            response: responseBase(input.responseId, input.modelId, "in_progress", [], null),
          });
          let finalResponse: Record<string, unknown> | null = null;
          for await (const event of input.stream) {
            if (event.type === "thinking_start") {
              ensureSlot(event.contentIndex, "reasoning");
            } else if (event.type === "thinking_delta") {
              const slot = ensureSlot(event.contentIndex, "reasoning");
              slot.text += event.delta;
              emit({
                type: "response.reasoning_summary_text.delta",
                item_id: slot.id,
                output_index: slot.outputIndex,
                summary_index: 0,
                delta: event.delta,
              });
            } else if (event.type === "thinking_end") {
              const slot = ensureSlot(event.contentIndex, "reasoning");
              slot.text = event.content;
              slot.item = {
                id: slot.id,
                type: "reasoning",
                status: "completed",
                summary: [{ type: "summary_text", text: slot.text }],
              };
              emit({
                type: "response.output_item.done",
                output_index: slot.outputIndex,
                item: slot.item,
              });
            } else if (event.type === "text_start") {
              ensureSlot(event.contentIndex, "message");
            } else if (event.type === "text_delta") {
              const slot = ensureSlot(event.contentIndex, "message");
              slot.text += event.delta;
              emit({
                type: "response.output_text.delta",
                item_id: slot.id,
                output_index: slot.outputIndex,
                content_index: 0,
                delta: event.delta,
              });
            } else if (event.type === "text_end") {
              const slot = ensureSlot(event.contentIndex, "message");
              slot.text = event.content;
              slot.item = {
                id: slot.id,
                type: "message",
                status: "completed",
                role: "assistant",
                content: [{ type: "output_text", text: slot.text, annotations: [] }],
              };
              emit({
                type: "response.output_item.done",
                output_index: slot.outputIndex,
                item: slot.item,
              });
            } else if (event.type === "toolcall_start") {
              const block = event.partial.content[event.contentIndex];
              ensureSlot(
                event.contentIndex,
                "function_call",
                block?.type === "toolCall" ? block : undefined,
              );
            } else if (event.type === "toolcall_delta") {
              const block = event.partial.content[event.contentIndex];
              const slot = ensureSlot(
                event.contentIndex,
                "function_call",
                block?.type === "toolCall" ? block : undefined,
              );
              slot.text += event.delta;
              emit({
                type: "response.function_call_arguments.delta",
                item_id: slot.id,
                output_index: slot.outputIndex,
                delta: event.delta,
              });
            } else if (event.type === "toolcall_end") {
              const slot = ensureSlot(event.contentIndex, "function_call", event.toolCall);
              const argumentsJson = JSON.stringify(event.toolCall.arguments);
              slot.text = argumentsJson;
              slot.item = {
                id: slot.id,
                type: "function_call",
                status: "completed",
                call_id: event.toolCall.id,
                name: event.toolCall.name,
                arguments: argumentsJson,
              };
              emit({
                type: "response.function_call_arguments.done",
                item_id: slot.id,
                output_index: slot.outputIndex,
                arguments: argumentsJson,
              });
              emit({
                type: "response.output_item.done",
                output_index: slot.outputIndex,
                item: slot.item,
              });
            } else if (event.type === "done") {
              const output = terminalOutput(slots);
              finalResponse = responseBase(
                input.responseId,
                input.modelId,
                "completed",
                output,
                responseUsage(event.message),
              );
              emit({ type: "response.completed", response: finalResponse });
              finish({ response: finalResponse, status: 200 });
            } else if (event.type === "error") {
              const response = {
                ...responseBase(
                  input.responseId,
                  input.modelId,
                  "failed",
                  terminalOutput(slots),
                  null,
                ),
                error: {
                  code: "cursor_error",
                  message: event.error.errorMessage ?? "Cursor request failed",
                },
              };
              emit({ type: "response.failed", response });
              finish(null);
            }
          }
          input.controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          input.controller.close();
          if (!settled) finish(null);
          return finalResponse;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!input.signal.aborted) {
            emit({ type: "error", code: "cursor_proxy_error", message });
            input.controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          input.controller.close();
          finish(null);
          return null;
        }
      },
      catch: (source) => source,
    }),
  );
};

export function createCursorResponses(
  models: MutableModels,
  model: Model<Api>,
  request: Record<string, unknown>,
  signal: AbortSignal,
): Promise<HeadProviderResponse> {
  return models.getAuth(model).then((auth) => {
    if (!auth) throw new Error("Cursor is not connected on this controller");
    return createCursorResponsesFromStream(
      models.streamSimple.bind(models),
      model,
      request,
      signal,
    );
  });
}

export function createCursorResponsesFromStream(
  streamSimple: ProviderStreams["streamSimple"],
  model: Model<Api>,
  request: Record<string, unknown>,
  signal: AbortSignal,
): Promise<HeadProviderResponse> {
  const context = requestContext(model, request);
  const responseId = `resp_${randomUUID()}`;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const readable = new ReadableStream<Uint8Array>({
    start(controller): void {
      streamController = controller;
    },
  });
  if (!streamController) throw new Error("Cursor response stream failed to initialize");
  let resolveCompletion: (completion: HeadProviderCompletion | null) => void = () => undefined;
  const completion = new Promise<HeadProviderCompletion | null>((resolve) => {
    resolveCompletion = resolve;
  });
  const reasoning = reasoningLevel(request);
  const upstream = streamSimple(model, context, {
    signal,
    ...(typeof request["prompt_cache_key"] === "string"
      ? { sessionId: request["prompt_cache_key"] }
      : {}),
    ...(reasoning ? { reasoning } : {}),
  });
  const pumping = createEventPump({
    stream: upstream,
    controller: streamController,
    responseId,
    modelId: model.id,
    signal,
    resolve: resolveCompletion,
  });
  if (request["stream"] === true) {
    return Promise.resolve({
      response: new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      }),
      completion,
    });
  }
  return new Response(readable)
    .text()
    .then(() => pumping)
    .then((response) => ({
      response: response
        ? Response.json(response)
        : Response.json({ error: { message: "Cursor request failed" } }, { status: 502 }),
      completion,
    }));
}
