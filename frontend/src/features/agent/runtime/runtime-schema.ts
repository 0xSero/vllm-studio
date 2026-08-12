import { Schema } from "effect";
import { RuntimeStatusSchema, type RuntimeStatus } from "@shared/agent/runtime-status";

const RuntimeStatusEventSchema = Schema.Struct({
  type: Schema.Literal("status"),
  sessionId: Schema.String,
  phase: Schema.Literals(["running", "idle"]),
  session: RuntimeStatusSchema,
});

const RuntimePiEventSchema = Schema.Struct({
  type: Schema.Literal("pi"),
  sessionId: Schema.String,
  seq: Schema.Number,
  event: Schema.Record(Schema.String, Schema.Unknown),
  snapshot: RuntimeStatusSchema,
});

const RuntimeSessionSummarySchema = Schema.Struct({
  sessionId: Schema.String,
  status: RuntimeStatusSchema,
});

const RuntimeSessionsEventSchema = Schema.Struct({
  type: Schema.Literal("sessions"),
  sessions: Schema.Array(RuntimeSessionSummarySchema),
});

const RuntimeActivityPayloadSchema = Schema.Union([
  RuntimeSessionsEventSchema,
  RuntimeStatusEventSchema,
  RuntimePiEventSchema,
]);

export type RuntimeActivityPayload = Schema.Schema.Type<typeof RuntimeActivityPayloadSchema>;

const RuntimeEventPayloadSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("status"),
    phase: Schema.String,
    session: Schema.optional(RuntimeStatusSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("pi"),
    seq: Schema.optional(Schema.Number),
    event: Schema.Record(Schema.String, Schema.Unknown),
    snapshot: Schema.optional(RuntimeStatusSchema),
  }),
]);

export type RuntimeEventPayload = Schema.Schema.Type<typeof RuntimeEventPayloadSchema>;

const decodeActivityOption = Schema.decodeUnknownOption(RuntimeActivityPayloadSchema, {
  onExcessProperty: "preserve",
});

const decodePayloadOption = Schema.decodeUnknownOption(RuntimeEventPayloadSchema, {
  onExcessProperty: "preserve",
});

export function decodeRuntimeActivityPayload(raw: unknown): RuntimeActivityPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const option = decodeActivityOption(raw);
  return option._tag === "Some" ? option.value : null;
}

export function decodeRuntimeEventPayload(raw: unknown): RuntimeEventPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const option = decodePayloadOption(raw);
  return option._tag === "Some" ? option.value : null;
}

const RuntimeStatusResponseSchema = Schema.Struct({
  status: Schema.optional(Schema.Union([Schema.Null, RuntimeStatusSchema])),
});

const RuntimeSessionsResponseSchema = Schema.Struct({
  sessions: Schema.optional(Schema.Array(RuntimeSessionSummarySchema)),
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

export function decodeRuntimeStatusResponse(raw: unknown): RuntimeStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const option = decodeStatusResponseOption(raw);
  if (option._tag !== "Some" || !option.value.status) return null;
  return option.value.status;
}

export function decodeRuntimeSessions(raw: unknown): RuntimeSessionSummary[] {
  if (!raw || typeof raw !== "object") return [];
  const option = decodeSessionsResponseOption(raw);
  return option._tag === "Some" ? [...(option.value.sessions ?? [])] : [];
}

export type { RuntimeContextUsage } from "@shared/agent/context-usage";
export type { RuntimeStatus } from "@shared/agent/runtime-status";
