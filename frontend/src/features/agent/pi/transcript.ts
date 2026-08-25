import type {
  SessionSnapshot,
  TranscriptItem,
  TranscriptProgress,
} from "@earendil-works/pi-protocol";

/**
 * pi's client transcript reducer, vendored verbatim from
 * `@earendil-works/pi-coding-agent@0.84.2` (dist/client/transcript.js) and
 * typed against `@earendil-works/pi-protocol`. Vendored rather than imported
 * because the package's `./client` entry also drags `RemoteSession` — and with
 * it the full agent dependency tree — into the browser bundle, while the
 * reducer itself is a hundred pure lines. Delete this file and import from
 * `pi-coding-agent/client` if that package ever ships a transcript-only entry.
 *
 * Semantics (unchanged from upstream):
 * - state = one authoritative snapshot + an overlay of progress items.
 * - snapshots replace the world; progress items overlay by item id.
 * - `assistant_delta` appends text/thinking/tool-input by content index, with
 *   tool-call input buffered as a raw string until it parses as JSON.
 * - `selectTranscript` = snapshot order, progress overlaid, unseen progress
 *   items appended, queued steer messages last.
 */

export interface TranscriptState {
  readonly snapshot: SessionSnapshot;
  readonly progressItems: ReadonlyMap<string, TranscriptItem>;
  readonly progressOrder: readonly string[];
  readonly toolCallBuffers: ReadonlyMap<string, string>;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value).every(isJsonValue);
}

function parsePartialToolInput(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isJsonValue(parsed)) return parsed;
  } catch {
    // Tool arguments are incomplete while streaming. Preserve their raw prefix
    // until they form valid JSON.
  }
  return value;
}

export function createTranscriptState(snapshot: SessionSnapshot): TranscriptState {
  return {
    snapshot: structuredClone(snapshot),
    progressItems: new Map(),
    progressOrder: [],
    toolCallBuffers: new Map(),
  };
}

// Upstream also ships `applyTranscriptSnapshot` (replace unless same-id and
// lower revision). The controller needs a wider acceptance policy — a
// restarted runtime restarts revisions from zero for the same pi session — so
// snapshot acceptance lives there and this module only folds.

export function applyTranscriptProgress(
  state: TranscriptState,
  progress: TranscriptProgress,
): TranscriptState {
  if (progress.type === "item_started" || progress.type === "item_updated") {
    return setProgressItem(state, progress.item);
  }
  if (progress.type === "item_finished") {
    const toolCallBuffers = new Map(state.toolCallBuffers);
    for (const key of toolCallBuffers.keys()) {
      if (key.startsWith(`${progress.item.id}:`)) toolCallBuffers.delete(key);
    }
    return setProgressItem({ ...state, toolCallBuffers }, progress.item);
  }
  const item =
    state.progressItems.get(progress.messageId) ??
    state.snapshot.transcript.find(({ id }) => id === progress.messageId);
  if (!item || item.role !== "assistant") return state;
  let toolCallBuffers = state.toolCallBuffers;
  const content = item.content.map((part, index) => {
    if (index !== progress.contentIndex) return structuredClone(part);
    if (progress.kind === "text" && part.type === "text")
      return { ...part, text: part.text + progress.delta };
    if (progress.kind === "thinking" && part.type === "thinking") {
      return { ...part, thinking: part.thinking + progress.delta };
    }
    if (progress.kind === "toolCall" && part.type === "toolCall") {
      const key = `${progress.messageId}:${progress.contentIndex}`;
      const existing =
        state.toolCallBuffers.get(key) ?? (typeof part.input === "string" ? part.input : "");
      const buffer = existing + progress.delta;
      toolCallBuffers = new Map(state.toolCallBuffers).set(key, buffer);
      return { ...part, input: parsePartialToolInput(buffer) as typeof part.input };
    }
    return structuredClone(part);
  });
  return setProgressItem({ ...state, toolCallBuffers }, { ...item, content });
}

export function selectTranscript(state: TranscriptState): readonly TranscriptItem[] {
  const transcript = state.snapshot.transcript.map(
    (item) => state.progressItems.get(item.id) ?? item,
  );
  const ids = new Set(transcript.map((item) => item.id));
  for (const id of state.progressOrder) {
    if (ids.has(id)) continue;
    const item = state.progressItems.get(id);
    if (item) {
      transcript.push(item);
      ids.add(id);
    }
  }
  for (const item of state.snapshot.queuedSteer) {
    if (ids.has(item.id)) continue;
    transcript.push(item);
    ids.add(item.id);
  }
  return transcript;
}

function setProgressItem(state: TranscriptState, item: TranscriptItem): TranscriptState {
  const progressItems = new Map(state.progressItems);
  const progressOrder = progressItems.has(item.id)
    ? state.progressOrder
    : [...state.progressOrder, item.id];
  progressItems.set(item.id, structuredClone(item));
  return { ...state, progressItems, progressOrder };
}
