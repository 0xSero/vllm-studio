import type { SessionId } from "./types";

type TextDeltaKind = "text" | "thinking";

type ApplyPiEvent = (
  sessionId: SessionId,
  assistantId: string,
  event: Record<string, unknown>,
) => void;

type FrameToken = {
  cancel: () => void;
};

type ScheduleFrame = (callback: () => void) => FrameToken;

export type TextDeltaCoalescer = {
  enqueuePiEvent: (
    sessionId: SessionId,
    assistantId: string,
    event: Record<string, unknown>,
    options?: { flushNow?: boolean },
  ) => boolean;
  flushNow: (sessionId: SessionId) => void;
  flushAll: () => void;
  dispose: () => void;
};

type KindBuffer = {
  assistantId: string;
  delta: string;
  event: Record<string, unknown>;
  firstSeq: number;
};

type SessionBuffer = {
  frame: FrameToken | null;
  thinking?: KindBuffer;
  text?: KindBuffer;
};

type DeltaEvent = {
  delta: string;
  kind: TextDeltaKind;
};

export function createTextDeltaCoalescer({
  applyPiEvent,
  scheduleFrame = defaultScheduleFrame,
}: {
  applyPiEvent: ApplyPiEvent;
  scheduleFrame?: ScheduleFrame;
}): TextDeltaCoalescer {
  const pending = new Map<SessionId, SessionBuffer>();
  let sequence = 0;

  const flushNow = (sessionId: SessionId) => {
    const buffer = pending.get(sessionId);
    if (!buffer) return;
    buffer.frame?.cancel();
    pending.delete(sessionId);

    for (const entry of orderedEntries(buffer)) {
      applyPiEvent(
        sessionId,
        entry.assistantId,
        syntheticDeltaEvent(entry.event, entry.delta, eventTypeForKind(entry)),
      );
    }
  };

  const scheduleSessionFlush = (sessionId: SessionId, buffer: SessionBuffer) => {
    if (buffer.frame) return;
    buffer.frame = scheduleFrame(() => flushNow(sessionId));
  };

  const enqueuePiEvent: TextDeltaCoalescer["enqueuePiEvent"] = (
    sessionId,
    assistantId,
    event,
    options = {},
  ) => {
    const deltaEvent = textDeltaFromPiEvent(event);
    if (!deltaEvent) return false;

    const existing = pending.get(sessionId);
    if (existing && bufferAssistantId(existing) !== assistantId) {
      flushNow(sessionId);
    }

    const buffer = pending.get(sessionId) ?? { frame: null };
    const current = buffer[deltaEvent.kind];
    if (current) {
      current.delta += deltaEvent.delta;
      current.event = event;
    } else {
      buffer[deltaEvent.kind] = {
        assistantId,
        delta: deltaEvent.delta,
        event,
        firstSeq: sequence,
      };
      sequence += 1;
    }
    pending.set(sessionId, buffer);

    if (options.flushNow) {
      flushNow(sessionId);
    } else {
      scheduleSessionFlush(sessionId, buffer);
    }
    return true;
  };

  const flushAll = () => {
    for (const sessionId of Array.from(pending.keys())) flushNow(sessionId);
  };

  return {
    enqueuePiEvent,
    flushNow,
    flushAll,
    dispose: () => {
      for (const buffer of pending.values()) buffer.frame?.cancel();
      pending.clear();
    },
  };
}

export function textDeltaFromPiEvent(event: Record<string, unknown>): DeltaEvent | null {
  if (event.type !== "message_update") return null;
  const assistantMessageEvent = asRecord(event.assistantMessageEvent);
  const delta = assistantMessageEvent?.delta;
  if (typeof delta !== "string" || !delta) return null;
  if (
    assistantMessageEvent.type === "thinking_delta" ||
    assistantMessageEvent.type === "reasoning_delta" ||
    assistantMessageEvent.type === "reasoning_text_delta"
  ) {
    return { kind: "thinking", delta };
  }
  if (assistantMessageEvent.type === "text_delta") {
    return {
      kind: messageUpdateLooksReasoning(assistantMessageEvent, event) ? "thinking" : "text",
      delta,
    };
  }
  return null;
}

function orderedEntries(buffer: SessionBuffer): KindBuffer[] {
  return [buffer.text, buffer.thinking]
    .filter((entry): entry is KindBuffer => Boolean(entry))
    .sort((a, b) => a.firstSeq - b.firstSeq);
}

function bufferAssistantId(buffer: SessionBuffer): string | undefined {
  return buffer.text?.assistantId ?? buffer.thinking?.assistantId;
}

function eventTypeForKind(entry: KindBuffer): "text_delta" | "thinking_delta" {
  return textDeltaFromPiEvent(entry.event)?.kind === "thinking" ? "thinking_delta" : "text_delta";
}

function syntheticDeltaEvent(
  event: Record<string, unknown>,
  delta: string,
  type: "text_delta" | "thinking_delta",
): Record<string, unknown> {
  return {
    ...event,
    type: "message_update",
    assistantMessageEvent: {
      ...asRecord(event.assistantMessageEvent),
      type,
      delta,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function contentPartAt(
  messageLike: unknown,
  contentIndex: unknown,
): Record<string, unknown> | undefined {
  const message = asRecord(messageLike);
  const content = Array.isArray(message?.content) ? message.content : null;
  if (!content) return undefined;
  if (typeof contentIndex === "number") return asRecord(content[contentIndex]);
  return undefined;
}

function contentPartLooksReasoning(part: Record<string, unknown> | undefined): boolean {
  const type = typeof part?.type === "string" ? part.type.toLowerCase() : "";
  return (
    type === "thinking" ||
    type === "reasoning" ||
    typeof part?.thinking === "string" ||
    typeof part?.reasoning === "string" ||
    typeof part?.reasoning_content === "string"
  );
}

function messageUpdateLooksReasoning(
  assistantMessageEvent: Record<string, unknown>,
  event: Record<string, unknown>,
): boolean {
  return (
    contentPartLooksReasoning(contentPartAt(event.message, assistantMessageEvent.contentIndex)) ||
    contentPartLooksReasoning(
      contentPartAt(assistantMessageEvent.partial, assistantMessageEvent.contentIndex),
    )
  );
}

function defaultScheduleFrame(callback: () => void): FrameToken {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const requestAnimationFrame = window.requestAnimationFrame.bind(window);
    const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const frame = requestAnimationFrame(() => callback());
    return { cancel: () => cancelAnimationFrame(frame) };
  }

  const timer = setTimeout(callback, 0);
  return { cancel: () => clearTimeout(timer) };
}
