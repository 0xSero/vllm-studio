import { Option, Schema } from "effect";
import type { UnparsedValue } from "@shared/agent/guards";

const ErrorBodySchema = Schema.Struct({
  detail: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
  message: Schema.optional(Schema.String),
});
const DetailItemSchema = Schema.Struct({
  msg: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  loc: Schema.optional(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
});
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBodySchema);
const decodeDetailItem = Schema.decodeUnknownOption(DetailItemSchema);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeDetailList = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const isObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

export function isRetryableError(error: UnparsedValue, status?: number): boolean {
  if (status && status >= 500) return true;
  if (status === 429) return true;
  if (status === 408) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === "AbortError") return false;
  return false;
}

function renderDetailItem(item: UnparsedValue): string {
  const text = Option.getOrNull(decodeString(item));
  if (text !== null) return text.trim();
  const structured = Option.getOrNull(decodeDetailItem(item));
  if (structured) {
    const message = (structured.msg ?? structured.message ?? "").trim();
    if (message) {
      const location = structured.loc?.join(".") ?? "";
      return location ? `${location}: ${message}` : message;
    }
  }
  try {
    return JSON.stringify(item);
  } catch {
    return String(item);
  }
}

/** Normalize FastAPI / generic JSON error bodies into a single string for `Error.message`. */
export function formatHttpErrorMessage(status: number, body: UnparsedValue): string {
  const fallback = `HTTP ${status}`;
  if (body == null) return fallback;
  const directText = Option.getOrNull(decodeString(body));
  if (directText !== null) return directText.trim() || fallback;

  const parsed = Option.getOrNull(decodeErrorBody(body));
  if (!parsed) return fallback;
  const detailText = Option.getOrNull(decodeString(parsed.detail));
  if (detailText !== null) return detailText.trim() || fallback;

  const detailList = Option.getOrNull(decodeDetailList(parsed.detail));
  if (detailList) {
    const joined = detailList.map(renderDetailItem).filter(Boolean).join("; ");
    return joined || fallback;
  }
  if (parsed.detail && isObject(parsed.detail)) {
    try {
      return JSON.stringify(parsed.detail);
    } catch {
      return fallback;
    }
  }
  const nestedMessage = parsed.error?.message?.trim();
  if (nestedMessage) return nestedMessage;
  return parsed.message?.trim() || fallback;
}
