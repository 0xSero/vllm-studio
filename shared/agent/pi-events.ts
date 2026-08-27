// Pure pi-event predicates shared by the agent runtime package
// (services/agent-runtime) and the frontend's client-side event pipeline.
// Keep this module dependency-free.

import { Schema } from "effect";
import type { UnknownRecord } from "./guards";

export function isAgentEndEvent(event: { type?: unknown } | null | undefined): boolean {
  return event?.type === "agent_end";
}

export function isAgentSettledEvent(event: { type?: unknown } | null | undefined): boolean {
  return event?.type === "agent_settled";
}

const isString = Schema.is(Schema.String);
const CompactionResultSchema = Schema.Struct({ status: Schema.optional(Schema.String) });
const isCompactionResult = Schema.is(CompactionResultSchema);

export function piEventIsSuccessfulCompaction(event: UnknownRecord): boolean {
  const eventType = event["type"];
  const type = isString(eventType) ? eventType.toLowerCase() : "";
  if (!type.includes("compact") && !type.includes("compaction")) return false;
  if (type.includes("start") || type.includes("begin")) return false;
  if (
    event["error"] ||
    event["errorMessage"] ||
    event["aborted"] ||
    event["cancelled"] ||
    event["canceled"] ||
    event["failed"]
  ) {
    return false;
  }
  const eventResult = event["result"];
  if (eventType === "compaction_end" && eventResult == null) return false;
  const eventStatus = event["status"];
  const resultStatus = isCompactionResult(eventResult) ? eventResult.status : "";
  const status = (isString(eventStatus) ? eventStatus : resultStatus) ?? "";
  return !/abort|cancel|error|fail/.test(status.toLowerCase());
}
