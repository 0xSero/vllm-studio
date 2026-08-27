import { Schema } from "effect";
import { records, type Json, type RecordJson } from "./studio-core";

const isString = Schema.is(Schema.String);

const JsonRecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const CanonicalMetaSchema = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  modelId: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  piSessionId: Schema.optional(Schema.NullOr(Schema.String)),
});
const CanonicalSessionSchema = Schema.Struct({
  events: Schema.optional(Schema.Array(JsonRecordSchema)),
  cursor: Schema.optional(Schema.NullOr(Schema.Number)),
  meta: Schema.optional(Schema.NullOr(CanonicalMetaSchema)),
});
const RuntimePayloadSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pi"),
    seq: Schema.optional(Schema.Number),
    event: JsonRecordSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("status"),
    phase: Schema.String,
    session: Schema.optional(JsonRecordSchema),
  }),
]);
const decodeCanonicalSessionOption = Schema.decodeUnknownOption(CanonicalSessionSchema, {
  onExcessProperty: "preserve",
});
const decodeRuntimePayloadOption = Schema.decodeUnknownOption(RuntimePayloadSchema, {
  onExcessProperty: "preserve",
});

export type CanonicalSession = {
  events: RecordJson[];
  cursor: number | null;
  meta: {
    title: string | null;
    modelId: string | null;
    startedAt: string | null;
    piSessionId: string | null;
  } | null;
};
export type FoldedMessage = { id: string; role: "user" | "assistant" | "event"; content: string };
export type RuntimePayload =
  | { type: "pi"; seq?: number; event: RecordJson }
  | { type: "status"; phase: string; session?: RecordJson };

export function decodeCanonicalSession(value: Json): CanonicalSession {
  const decoded = decodeCanonicalSessionOption(value);
  if (decoded._tag === "None") throw new Error("Invalid canonical session response");
  const meta = decoded.value.meta;
  return {
    events: records(value, "events"),
    cursor: decoded.value.cursor ?? null,
    meta: meta
      ? {
          title: meta.title ?? null,
          modelId: meta.modelId ?? null,
          startedAt: meta.startedAt ?? null,
          piSessionId: meta.piSessionId ?? null,
        }
      : null,
  };
}
export function decodeRuntimePayload(value: Json): RuntimePayload | null {
  const decoded = decodeRuntimePayloadOption(value);
  if (decoded._tag === "None") return null;
  const source = records([value], "value")[0];
  if (!source) return null;
  if (decoded.value.type === "status") {
    const session = nestedRecord(source.session);
    const payload: RuntimePayload = { type: "status", phase: decoded.value.phase };
    if (session) payload.session = session;
    return payload;
  }
  const event = nestedRecord(source.event);
  if (!event) return null;
  const payload: RuntimePayload = { type: "pi", event };
  if (decoded.value.seq !== undefined) payload.seq = decoded.value.seq;
  return payload;
}

function nestedRecord(value: Json | undefined): RecordJson | null {
  if (value === undefined) return null;
  return records({ value }, "value")[0] ?? null;
}
function textFromContent(value: Json | undefined): string {
  if (isString(value)) return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      const row = nestedRecord(part);
      return isString(row?.text) ? row.text : "";
    })
    .join("");
}
function eventText(
  event: RecordJson,
): { role: FoldedMessage["role"]; text: string; append: boolean } | null {
  const message = nestedRecord(event.message);
  if (event.type === "message_start" || event.type === "message_end") {
    const role = message?.role === "user" ? "user" : "assistant";
    const text = textFromContent(message?.content);
    return text ? { role, text, append: false } : null;
  }
  if (event.type === "message_update") {
    const update = nestedRecord(event.assistantMessageEvent);
    const delta = update?.delta;
    return isString(delta) ? { role: "assistant", text: delta, append: true } : null;
  }
  const direct = event.message ?? event.content ?? event.text;
  if (isString(direct)) return { role: "event", text: direct, append: false };
  if (isString(event.type)) return { role: "event", text: event.type, append: false };
  return null;
}
export function foldSessionEvent(folded: FoldedMessage[], event: RecordJson): FoldedMessage[] {
  const item = eventText(event);
  if (!item) return folded;
  const previous = folded.at(-1);
  if (item.append && previous?.role === item.role) {
    return [...folded.slice(0, -1), { ...previous, content: previous.content + item.text }];
  }
  if (!item.append && event.type === "message_end" && previous?.role === item.role) {
    return [...folded.slice(0, -1), { ...previous, content: item.text }];
  }
  if (previous?.role === "event" && previous.content === item.text) return folded;
  return [...folded, { id: crypto.randomUUID(), role: item.role, content: item.text }];
}

export function foldSessionEvents(events: RecordJson[]): FoldedMessage[] {
  let folded: FoldedMessage[] = [];
  for (const wrapper of events)
    folded = foldSessionEvent(folded, nestedRecord(wrapper.event) ?? wrapper);
  return folded;
}

export type RuntimeCursor = { received: number; committed: number };
export type RuntimeDecision = { cursor: RuntimeCursor; event: RecordJson | null };
export function acceptRuntimePayload(
  cursor: RuntimeCursor,
  payload: RuntimePayload,
): RuntimeDecision {
  if (payload.type !== "pi") return { cursor, event: null };
  const seq = payload.seq ?? 0;
  if (seq > 0 && seq <= cursor.received) return { cursor, event: null };
  const next = seq > 0 ? Math.max(cursor.received, seq) : cursor.received;
  return { cursor: { received: next, committed: next }, event: payload.event };
}
