import type { SessionSnapshot, TranscriptProgress } from "@earendil-works/pi-protocol";

/**
 * Narrowing guards for pi wire payloads. The SSE decoder (runtime-schema.ts)
 * only establishes "a record named snapshot/progress"; these check the fields
 * the reducer and adapter actually dereference, then trust the runtime — both
 * ends of this wire live in this repository and speak pi-protocol 0.84.
 */

export function asSessionSnapshot(value: Record<string, unknown>): SessionSnapshot | null {
  if (
    typeof value.id !== "string" ||
    typeof value.revision !== "number" ||
    !Array.isArray(value.transcript) ||
    !Array.isArray(value.queuedSteer)
  ) {
    return null;
  }
  return value as unknown as SessionSnapshot;
}

export function asTranscriptProgress(value: Record<string, unknown>): TranscriptProgress | null {
  const type = value.type;
  if (type === "item_started" || type === "item_updated" || type === "item_finished") {
    return value.item && typeof value.item === "object"
      ? (value as unknown as TranscriptProgress)
      : null;
  }
  if (type === "assistant_delta") {
    const kind = value.kind;
    return typeof value.messageId === "string" &&
      typeof value.contentIndex === "number" &&
      typeof value.delta === "string" &&
      (kind === "text" || kind === "thinking" || kind === "toolCall")
      ? (value as unknown as TranscriptProgress)
      : null;
  }
  return null;
}
