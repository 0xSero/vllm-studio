import { Schema } from "effect";

export const RuntimeContextUsageSchema = Schema.Struct({
  tokens: Schema.Union([Schema.Null, Schema.Number]),
  contextWindow: Schema.Number,
  percent: Schema.Union([Schema.Null, Schema.Number]),
  shouldCompact: Schema.Boolean,
});

const RuntimeLoggedEventSchema = Schema.Struct({
  seq: Schema.Number,
  event: Schema.Record(Schema.String, Schema.Unknown),
  timestamp: Schema.optional(Schema.String),
});

export const RuntimeStatusSchema = Schema.Struct({
  phase: Schema.optional(Schema.String),
  active: Schema.optional(Schema.Boolean),
  running: Schema.optional(Schema.Boolean),
  harness: Schema.optional(Schema.String),
  harnessVersion: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
  nativeSessionId: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  piSessionId: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  modelId: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  eventSeq: Schema.optional(Schema.Number),
  lastError: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  events: Schema.optional(Schema.Array(RuntimeLoggedEventSchema)),
  contextUsage: Schema.optional(Schema.Union([Schema.Null, RuntimeContextUsageSchema])),
});

export type RuntimeStatus = Schema.Schema.Type<typeof RuntimeStatusSchema>;

const RuntimeStatusEventSchema = Schema.Struct({
  type: Schema.Literal("status"),
  phase: Schema.String,
  session: Schema.optional(RuntimeStatusSchema),
});

const RuntimeHarnessEventSchema = Schema.Struct({
  type: Schema.Union([Schema.Literal("pi"), Schema.Literal("harness")]),
  harness: Schema.optional(Schema.String),
  seq: Schema.optional(Schema.Number),
  normalized: Schema.optional(
    Schema.Union([
      Schema.Null,
      Schema.Struct({
        type: Schema.String,
        harness: Schema.String,
        nativeType: Schema.String,
      }),
    ]),
  ),
  event: Schema.Record(Schema.String, Schema.Unknown),
  native: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const RuntimeEventPayloadSchema = Schema.Union([
  RuntimeStatusEventSchema,
  RuntimeHarnessEventSchema,
]);

export type RuntimeEventPayload = Schema.Schema.Type<typeof RuntimeEventPayloadSchema>;

const decodePayloadOption = Schema.decodeUnknownOption(RuntimeEventPayloadSchema, {
  onExcessProperty: "preserve",
});

export function decodeRuntimeEventPayload(raw: unknown): RuntimeEventPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const option = decodePayloadOption(raw);
  return option._tag === "Some" ? option.value : null;
}

const RuntimeStatusResponseSchema = Schema.Struct({
  status: Schema.optional(Schema.Union([Schema.Null, RuntimeStatusSchema])),
  events: Schema.optional(Schema.Array(RuntimeLoggedEventSchema)),
});

const RuntimeSessionsResponseSchema = Schema.Struct({
  sessions: Schema.optional(
    Schema.Array(Schema.Struct({ sessionId: Schema.String, status: RuntimeStatusSchema })),
  ),
});

export type RuntimeSessionSummary = Schema.Schema.Type<
  typeof RuntimeSessionsResponseSchema
>["sessions"] extends readonly (infer T)[] | undefined
  ? T
  : never;

const decodeStatusResponseOption = Schema.decodeUnknownOption(RuntimeStatusResponseSchema, {
  onExcessProperty: "preserve",
});

const decodeSessionsResponseOption = Schema.decodeUnknownOption(RuntimeSessionsResponseSchema, {
  onExcessProperty: "preserve",
});

export function decodeRuntimeStatusResponse(
  raw: unknown,
): { status: RuntimeStatus; events: RuntimeStatus["events"] } | null {
  if (!raw || typeof raw !== "object") return null;
  const option = decodeStatusResponseOption(raw);
  if (option._tag !== "Some" || !option.value.status) return null;
  return { status: option.value.status, events: option.value.events ?? [] };
}

export function decodeRuntimeSessions(raw: unknown): RuntimeSessionSummary[] {
  if (!raw || typeof raw !== "object") return [];
  const option = decodeSessionsResponseOption(raw);
  return option._tag === "Some" ? [...(option.value.sessions ?? [])] : [];
}

// Canonical type lives in shared/agent/context-usage.ts (shared with the agent
// runtime package); RuntimeContextUsageSchema above must stay in sync with it.
export type { RuntimeContextUsage } from "@shared/agent/context-usage";
