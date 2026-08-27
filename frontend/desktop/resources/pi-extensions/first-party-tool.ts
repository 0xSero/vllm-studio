import { Schema } from "effect";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type ToolResult<
  Details = {
    source: string;
    tool: string;
    data?: Json;
    error?: string;
    failed?: boolean;
  },
> = {
  content: Array<{ type: "text"; text: string }>;
  details: Details;
};

export const JsonSchema: Schema.Codec<Json, Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.mutable(Schema.Array(JsonSchema)),
    Schema.Record(Schema.String, JsonSchema),
  ]),
);
export const JsonObjectSchema = Schema.Record(Schema.String, JsonSchema);
const ErrorSchema = Schema.Struct({ message: Schema.String });
export const decodeJson = Schema.decodeUnknownSync(JsonSchema);

export function text(value: Json): string {
  return Schema.is(Schema.String)(value) ? value : JSON.stringify(value, null, 2);
}

export async function present(
  source: string,
  tool: string,
  operation: Promise<Json>,
): Promise<ToolResult> {
  try {
    const data = await operation;
    return { content: [{ type: "text", text: text(data) }], details: { source, tool, data } };
  } catch (error) {
    const parsed = Schema.decodeUnknownOption(ErrorSchema)(error);
    const message = parsed._tag === "Some" ? parsed.value.message : String(error);
    return {
      content: [{ type: "text", text: `${tool} failed: ${message}` }],
      details: { source, tool, error: message, failed: true },
    };
  }
}

export function result<Details>(text: string, details: Details): ToolResult<Details> {
  return { content: [{ type: "text", text }], details };
}

export async function requestJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { ok: response.ok, status: response.status, body: await response.json() };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
