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

const decodeActivityOption = Schema.decodeUnknownOption(RuntimeActivityPayloadSchema, {
  onExcessProperty: "preserve",
});

export function decodeRuntimeActivityPayload(raw: unknown): RuntimeActivityPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const option = decodeActivityOption(raw);
  return option._tag === "Some" ? option.value : null;
}

const RuntimeStatusResponseSchema = Schema.Struct({
  status: Schema.optional(Schema.Union([Schema.Null, RuntimeStatusSchema])),
});

export type RuntimeSessionSummary = Schema.Schema.Type<typeof RuntimeSessionSummarySchema>;

const decodeStatusResponseOption = Schema.decodeUnknownOption(RuntimeStatusResponseSchema, {
  onExcessProperty: "preserve",
});

export function decodeRuntimeStatusResponse(raw: unknown): RuntimeStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const option = decodeStatusResponseOption(raw);
  if (option._tag !== "Some" || !option.value.status) return null;
  return option.value.status;
}

export type { RuntimeContextUsage } from "@shared/agent/context-usage";
export type { RuntimeStatus } from "@shared/agent/runtime-status";
