import { Schema } from "effect";
import { RuntimeStatusSchema, type RuntimeStatus } from "@shared/agent/runtime-status";

const RuntimeStatusEventSchema = Schema.Struct({
  type: Schema.Literal("status"),
  phase: Schema.String,
  session: Schema.optional(RuntimeStatusSchema),
});

const RuntimePiEventSchema = Schema.Struct({
  type: Schema.Literal("pi"),
  seq: Schema.optional(Schema.Number),
  event: Schema.Record(Schema.String, Schema.Unknown),
  snapshot: Schema.optional(RuntimeStatusSchema),
});

const RuntimeEventPayloadSchema = Schema.Union([RuntimeStatusEventSchema, RuntimePiEventSchema]);

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
