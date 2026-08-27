import { Schema } from "effect";
import { records, type Json, type RecordJson } from "./studio-api";

const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);

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
const RuntimeSnapshotSchema = Schema.Struct({
  status: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        eventSeq: Schema.optional(Schema.Number),
      }),
    ),
  ),
  events: Schema.optional(
    Schema.Array(
      Schema.Struct({
        seq: Schema.Number,
        event: JsonRecordSchema,
      }),
    ),
  ),
});
const decodeRuntimeSnapshotOption = Schema.decodeUnknownOption(RuntimeSnapshotSchema, {
  onExcessProperty: "preserve",
});
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
export type RuntimeSnapshot = {
  cursor: number;
  events: Array<{ seq: number; event: RecordJson }>;
};
export function decodeRuntimeSnapshot(value: Json): RuntimeSnapshot {
  const decoded = decodeRuntimeSnapshotOption(value);
  if (decoded._tag === "None") throw new Error("Invalid runtime status response");
  return {
    cursor: decoded.value.status?.eventSeq ?? 0,
    events: records(value, "events").flatMap((entry) => {
      const event = nestedRecord(entry.event);
      return event && isNumber(entry.seq) ? [{ seq: entry.seq, event }] : [];
    }),
  };
}

export type TranscriptBlock = { type: string; text: string; value: Json };
export type FoldedMessage = {
  id: string;
  role: "user" | "assistant" | "event";
  content: string;
  blocks: TranscriptBlock[];
};
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
function blockText(value: Json): string {
  if (isString(value)) return value;
  const block = nestedRecord(value);
  if (!block) return "";
  if (isString(block.text)) return block.text;
  if (isString(block.thinking)) return block.thinking;
  if (isString(block.content)) return block.content;
  return "";
}
function contentBlocks(value: Json | undefined): TranscriptBlock[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.map((part) => {
    const block = nestedRecord(part);
    return {
      type: block && isString(block.type) ? block.type : "text",
      text: blockText(part),
      value: part,
    };
  });
}
function snapshotBlocks(event: RecordJson, message: RecordJson | null): TranscriptBlock[] {
  const direct = contentBlocks(message?.content);
  if (event.type !== "message_update") return direct;
  const update = nestedRecord(event.assistantMessageEvent);
  const partial = nestedRecord(update?.partial);
  const candidate = contentBlocks(partial?.content);
  const directSize = direct.reduce((total, block) => total + block.text.length, 0);
  const candidateSize = candidate.reduce((total, block) => total + block.text.length, 0);
  return candidateSize > directSize ? candidate : direct;
}
function eventMessage(event: RecordJson): Omit<FoldedMessage, "id"> | null {
  const message = nestedRecord(event.message);
  if (
    event.type === "message" ||
    event.type === "message_start" ||
    event.type === "message_update" ||
    event.type === "message_end"
  ) {
    const partial = nestedRecord(nestedRecord(event.assistantMessageEvent)?.partial);
    const roleValue = message?.role ?? partial?.role;
    const role = roleValue === "user" ? "user" : roleValue === "assistant" ? "assistant" : "event";
    const blocks = snapshotBlocks(event, message);
    const content = blocks.map((block) => block.text).join("");
    return content || blocks.length ? { role, content, blocks } : null;
  }
  const direct = event.message ?? event.content ?? event.text;
  if (!isString(direct) && !isString(event.type)) return null;
  const content = isString(direct) ? direct : isString(event.type) ? event.type : "";
  return { role: "event", content, blocks: [{ type: "event", text: content, value: event }] };
}
function messageIdentity(event: RecordJson, identity: string): string {
  const message = nestedRecord(event.message);
  const explicit = event.id ?? message?.id ?? event.toolCallId;
  return isString(explicit) && explicit ? explicit : identity;
}
export function foldSessionEvent(
  folded: FoldedMessage[],
  event: RecordJson,
  identity = `live-${folded.length}`,
): FoldedMessage[] {
  const item = eventMessage(event);
  if (!item) return folded;
  const previous = folded.at(-1);
  const id = messageIdentity(event, identity);
  if (previous?.id === id) return [...folded.slice(0, -1), { id, ...item }];
  const snapshot = event.type === "message_update" || event.type === "message_end";
  if (snapshot && previous?.role === item.role) {
    if (item.content.length < previous.content.length && event.type === "message_update")
      return folded;
    return [...folded.slice(0, -1), { ...item, id: previous.id }];
  }
  if (previous?.role === item.role && previous.content === item.content) return folded;
  return [...folded, { id, ...item }];
}

function eventFingerprint(event: RecordJson): string | null {
  if (event.type !== "message" && event.type !== "message_end") return null;
  const message = nestedRecord(event.message);
  return message ? JSON.stringify(message) : null;
}
export function mergeCanonicalRuntimeEvents(
  canonical: RecordJson[],
  runtime: RuntimeSnapshot["events"],
): RecordJson[] {
  const runtimeEvents = [...runtime].sort((left, right) => left.seq - right.seq);
  const firstSettled = runtimeEvents.find((entry) => eventFingerprint(entry.event));
  if (!firstSettled) return [...canonical, ...runtimeEvents.map((entry) => entry.event)];
  const fingerprint = eventFingerprint(firstSettled.event);
  let overlap = -1;
  for (const [index, wrapper] of canonical.entries()) {
    const event = nestedRecord(wrapper.event) ?? wrapper;
    if (eventFingerprint(event) === fingerprint) overlap = index;
  }
  const prefix = overlap < 0 ? canonical : canonical.slice(0, overlap);
  return [...prefix, ...runtimeEvents.map((entry) => entry.event)];
}

export function foldSessionEvents(events: RecordJson[]): FoldedMessage[] {
  let folded: FoldedMessage[] = [];
  for (const [index, wrapper] of events.entries()) {
    const event = nestedRecord(wrapper.event) ?? wrapper;
    const seq = isNumber(wrapper.seq) ? wrapper.seq : index;
    folded = foldSessionEvent(folded, event, `canonical-${seq}`);
  }
  return folded;
}

export type RuntimeCursor = { received: number; committed: number };
export type RuntimeDecision = { cursor: RuntimeCursor; event: RecordJson | null; identity: string };
export function acceptRuntimePayload(
  cursor: RuntimeCursor,
  payload: RuntimePayload,
): RuntimeDecision {
  if (payload.type !== "pi") return { cursor, event: null, identity: "status" };
  const seq = payload.seq;
  if (seq !== undefined && seq <= cursor.received) {
    return { cursor, event: null, identity: `runtime-${seq}` };
  }
  if (seq === undefined) return { cursor, event: payload.event, identity: "runtime-unsequenced" };
  return {
    cursor: { received: seq, committed: seq },
    event: payload.event,
    identity: `runtime-${seq}`,
  };
}

export type QueuedTurn = { id: string; text: string };
export function reconcileQueueEvent(current: QueuedTurn[], event: RecordJson): QueuedTurn[] {
  if (event.type !== "queue_update" || !Array.isArray(event.followUp)) return current;
  const pending = event.followUp.filter(isString);
  const unused = [...current];
  return pending.map((text, index) => {
    const found = unused.findIndex((item) => item.text === text);
    if (found < 0) return { id: `queue-${index}-${text}`, text };
    const existing = unused[found];
    unused.splice(found, 1);
    return existing;
  });
}
