import { visibleUserTextFromPi } from "@/features/agent/messages/helpers";
import type { ChatMessage, QueuedMessage } from "@/features/agent/messages/types";

const sameMessage = (left: ChatMessage, right: ChatMessage): boolean =>
  left.role === right.role && left.text.trim() === right.text.trim();

export function mergeLiveTranscript(
  current: readonly ChatMessage[],
  live: readonly ChatMessage[],
): ChatMessage[] {
  if (live.length === 0) return [...current];
  let currentStart = -1;
  let liveStart = -1;
  for (let right = live.length - 1; right >= 0 && currentStart < 0; right -= 1) {
    if (live[right].role !== "user") continue;
    for (let left = current.length - 1; left >= 0; left -= 1) {
      if (sameMessage(current[left], live[right])) {
        currentStart = left;
        liveStart = right;
        break;
      }
    }
  }
  const merged =
    currentStart < 0
      ? [...current, ...live]
      : [...current.slice(0, currentStart), ...live.slice(liveStart)];
  for (const message of current) {
    if (
      message.role === "user" &&
      (message.pending || message.awaitingEcho) &&
      !merged.some((candidate) => sameMessage(candidate, message))
    ) {
      merged.push(message);
    }
  }
  return merged;
}

export function projectQueue(
  followUp: readonly string[],
  current: readonly QueuedMessage[] = [],
): QueuedMessage[] {
  return followUp.map((raw, index) => {
    const text = visibleUserTextFromPi(raw) || raw.trim();
    const prior = current.find((message) => message.mode === "follow_up" && message.text === text);
    return prior ?? { id: `queue-${index}-${text}`, mode: "follow_up", text, sent: true };
  });
}

export function settleOptimisticMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((message) =>
    message.pending || message.awaitingEcho
      ? { ...message, pending: false, awaitingEcho: false }
      : message,
  );
}
