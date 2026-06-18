// Effect-TS schemas for the agent session runtime wire types.
//
// These validate the JSON payloads that cross the SSE/HTTP boundary to the Pi
// coding-agent runtime. Using @effect/schema here means malformed payloads are
// rejected at the edge instead of silently producing undefined fields deep in
// the reducer. The Pi event body is intentionally loose (Schema.Unknown) — the
// full Pi event taxonomy is large and additive, and the pure reducer handles it.

import * as Schema from "@effect/schema/Schema";

/** Context-usage telemetry attached to a runtime status frame. */
export const RuntimeContextUsageSchema = Schema.Struct({
  tokens: Schema.Union(Schema.Null, Schema.Number),
  contextWindow: Schema.Number,
  percent: Schema.Union(Schema.Null, Schema.Number),
  shouldCompact: Schema.Boolean,
});

/** A logged event surfaced by the runtime status endpoint. */
const RuntimeLoggedEventSchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  seq: Schema.optional(Schema.Number),
  data: Schema.optional(Schema.Unknown),
});

/** Status frame for one session, returned by `/runtime/status` and `/runtime/sessions`. */
export const RuntimeStatusSchema = Schema.Struct({
  active: Schema.optional(Schema.Boolean),
  running: Schema.optional(Schema.Boolean),
  piSessionId: Schema.optional(Schema.Union(Schema.Null, Schema.String)),
  modelId: Schema.optional(Schema.Union(Schema.Null, Schema.String)),
  eventSeq: Schema.optional(Schema.Number),
  events: Schema.optional(Schema.Array(RuntimeLoggedEventSchema)),
  contextUsage: Schema.optional(Schema.Union(Schema.Null, RuntimeContextUsageSchema)),
});

/**
 * A single SSE payload on the runtime events channel. The server multiplexes
 * status frames and Pi events on one unnamed channel; `type` discriminates.
 * The Pi event body is intentionally opaque (Schema.Unknown) — it is reduced by
 * the pure pi-event-applier, which handles the full taxonomy.
 */
const RuntimeEventPayloadSchema = Schema.Struct({
  type: Schema.Literal("status", "pi"),
  // Present when `type === "pi"`.
  seq: Schema.optional(Schema.Number),
  // The raw Pi event object (for `type === "pi"`).
  event: Schema.optional(Schema.Unknown),
  // Present when `type === "status"`.
  phase: Schema.optional(Schema.String),
  session: Schema.optional(RuntimeStatusSchema),
});

export type DecodedRuntimeEventPayload = Schema.Schema.Type<typeof RuntimeEventPayloadSchema>;

/**
 * Decode an unknown SSE `data` blob into a validated payload, or return null if
 * it is not a recognized frame. Extra keys are preserved so the reducer still
 * sees the full body.
 */
export function decodeRuntimeEventPayload(raw: unknown): DecodedRuntimeEventPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const decoded = Schema.decodeUnknownEither(RuntimeEventPayloadSchema, {
    onExcessProperty: "preserve",
  })(raw);
  return decoded._tag === "Right" ? decoded.right : null;
}

/** Canonical RuntimeContextUsage — derived from the schema (single source). */
export type RuntimeContextUsage = Schema.Schema.Type<typeof RuntimeContextUsageSchema>;
