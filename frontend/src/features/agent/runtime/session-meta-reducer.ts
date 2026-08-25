import {
  asRecord,
  messageText,
  newId,
  piSessionIdFromEvent,
  usageFromEvent,
  visibleUserTextFromPi,
} from "@/features/agent/messages";
import { piEventIsSuccessfulCompaction } from "@shared/agent/pi-events";
import type { QueuedMessage } from "@/features/agent/messages";
import type { Session } from "@/features/agent/runtime/types";

/**
 * The non-transcript remainder of the old event reducer. Transcript content is
 * snapshot-authoritative now (the pi module's reducer + adapter own it); what
 * a live pi event still carries is session METADATA — queue reconciliation,
 * extension UI prompts, usage counters, error notices, header fields. Each
 * branch here has a named successor stage in docs/agent-state-plan.md and gets
 * deleted when snapshot.phase (Stage B) and the runtime dedup (Stage C) land.
 */
export function reduceSessionMetaEvent(
  session: Session,
  event: Record<string, unknown>,
): Session {
  const afterExtensionUi = reduceExtensionUiRequestEvent(session, event);
  if (afterExtensionUi) return afterExtensionUi;

  if (event.type === "notice" && event.level === "error" && typeof event.message === "string") {
    return { ...session, error: event.message.slice(0, 4_000) };
  }

  if (event.type === "queue_update") {
    return { ...session, queue: reconcileQueueWithPiEvent(session.queue ?? [], event) };
  }

  const afterHeader = reduceSessionHeaderEvent(session, event);
  if (afterHeader) return afterHeader;

  let next = session;
  if (piEventIsSuccessfulCompaction(event)) {
    next = { ...next, contextUsage: null, tokenStats: undefined };
  }

  const usage = usageFromEvent(event);
  if (usage) next = { ...next, tokenStats: usage };

  // A delivered user echo consumes its queued chip (pi is now showing the
  // message to the model); `queue_update` remains the canonical reconciler.
  if (event.type === "message_start" || event.type === "message_end") {
    const message = asRecord(event.message);
    if (message?.role === "user") {
      const text = visibleUserTextFromPi(
        messageText(message.content as string | Record<string, unknown>[] | undefined),
      );
      if (text) {
        const queue = removeDeliveredQueuedMessage(next.queue ?? [], text);
        if (queue !== next.queue) next = { ...next, queue };
      }
    }
    // A genuinely failed call surfaces as the session error banner; the
    // transcript's own error block comes from the projected assistant item.
    if (event.type === "message_end" && message?.role === "assistant") {
      const stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
      if (stopReason === "error") {
        const raw = [message.errorMessage, message.error]
          .find((value): value is string => typeof value === "string" && value.trim().length > 0)
          ?.trim();
        next = { ...next, error: raw || "Assistant turn failed." };
      }
    }
  }

  return next;
}

/** Extension-driven prompts (select/confirm/input/editor). Every field is
 *  length-capped because it comes straight off the wire and lands in the DOM. */
function reduceExtensionUiRequestEvent(
  session: Session,
  event: Record<string, unknown>,
): Session | null {
  if (event.type !== "extension_ui_request") return null;
  const method = event.method;
  const known =
    method === "select" || method === "confirm" || method === "input" || method === "editor";
  if (typeof event.requestId !== "string" || typeof event.title !== "string" || !known) return null;
  return {
    ...session,
    extensionUiRequest: {
      requestId: event.requestId,
      method,
      title: event.title.slice(0, 500),
      ...(typeof event.message === "string" ? { message: event.message.slice(0, 4_000) } : {}),
      ...(typeof event.placeholder === "string"
        ? { placeholder: event.placeholder.slice(0, 500) }
        : {}),
      ...(typeof event.prefill === "string" ? { prefill: event.prefill.slice(0, 32_000) } : {}),
      ...(Array.isArray(event.options)
        ? {
            options: event.options
              .filter((option): option is string => typeof option === "string")
              .slice(0, 100)
              .map((option) => option.slice(0, 1_000)),
          }
        : {}),
    },
  };
}

// Canonical `session` header and `model_change` entries carry session
// metadata, not transcript content.
function reduceSessionHeaderEvent(
  session: Session,
  event: Record<string, unknown>,
): Session | null {
  if (event.type === "session") {
    let next = session;
    if (!next.startedAt && typeof event.timestamp === "string") {
      next = { ...next, startedAt: event.timestamp };
    }
    const modelId = [event.modelId, event.model, event.model_id].find(
      (value): value is string => typeof value === "string",
    );
    if (!next.modelId && modelId) next = { ...next, modelId };
    const piSessionId = piSessionIdFromEvent(event);
    if (!next.piSessionId && piSessionId) next = { ...next, piSessionId };
    return next;
  }
  if (event.type === "model_change") {
    const modelId =
      typeof event.model === "string"
        ? event.model
        : typeof event.modelId === "string"
          ? event.modelId
          : null;
    if (!modelId || session.modelId === modelId) return session;
    return { ...session, modelId };
  }
  return null;
}

/* ── queue reconciliation ─────────────────────────────────────────────────── */

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function queueDisplayText(text: string): string {
  return visibleUserTextFromPi(text) || text.trim();
}

function queueKey(mode: QueuedMessage["mode"], text: string): string {
  return `${mode}:${queueDisplayText(text)}`;
}

function consumePending(
  pending: Map<string, string[]>,
  mode: QueuedMessage["mode"],
  text: string,
): string | null {
  const key = queueKey(mode, text);
  const values = pending.get(key);
  if (!values || values.length === 0) return null;
  const [value, ...remaining] = values;
  if (remaining.length > 0) pending.set(key, remaining);
  else pending.delete(key);
  return value ?? null;
}

function reconcileQueueWithPiEvent(
  queue: QueuedMessage[],
  event: Record<string, unknown>,
): QueuedMessage[] {
  if (event.type !== "queue_update") return queue;
  const pending = new Map<string, string[]>();
  const addPending = (mode: QueuedMessage["mode"], messages: string[]) => {
    for (const text of messages) {
      const key = queueKey(mode, text);
      pending.set(key, [...(pending.get(key) ?? []), text]);
    }
  };
  addPending("follow_up", stringArray(event.followUp));

  const next = queue.flatMap((item) => {
    if (item.mode !== "follow_up") return [];
    const acceptedByPi = consumePending(pending, item.mode, item.text);
    if (acceptedByPi) return [{ ...item, text: queueDisplayText(acceptedByPi), sent: true }];
    return item.sent ? [] : [item];
  });

  for (const [key, messages] of pending) {
    const separator = key.indexOf(":");
    const mode = key.slice(0, separator) as QueuedMessage["mode"];
    for (const text of messages) {
      next.push({ id: newId("queue"), mode, text: queueDisplayText(text), sent: true });
    }
  }
  return next;
}

function removeDeliveredQueuedMessage(
  queue: QueuedMessage[],
  deliveredText: string,
): QueuedMessage[] {
  const delivered = queueDisplayText(deliveredText);
  const index = queue.findIndex((item) => queueDisplayText(item.text) === delivered);
  if (index === -1) return queue;
  return [...queue.slice(0, index), ...queue.slice(index + 1)];
}
