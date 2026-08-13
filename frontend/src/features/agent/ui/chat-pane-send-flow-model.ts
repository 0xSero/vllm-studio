import type { AbortSessionResult } from "@/features/agent/runtime/api";
import {
  visibleUserTextFromPi,
  type ChatMessage,
  type QueuedMessage,
} from "@/features/agent/messages";
import type { BrowserState } from "@/features/agent/tools/types";
import { DEFAULT_BROWSER_URL } from "@/features/agent/tools/persistence";
import { readSessionView } from "@/features/agent/workspace/session-view-state";

type BrowserViewStorage = Pick<Storage, "getItem" | "setItem">;

export function browserContextUrlForSession(
  browser: BrowserState,
  sessionId: string,
  storage: BrowserViewStorage,
): string {
  if (browser.sessionId === sessionId) return browser.url;
  return (
    readSessionView(storage, { key: sessionId, aliases: [] })?.browser?.url ?? DEFAULT_BROWSER_URL
  );
}

function visibleText(text: string): string {
  return visibleUserTextFromPi(text).trim() || text.trim();
}

function unmatchedRuntimeFollowUps(local: string[], runtime: string[]): string[] {
  const pending = new Map<string, number>();
  for (const text of local) pending.set(text, (pending.get(text) ?? 0) + 1);
  return runtime.flatMap((text) => {
    const normalized = visibleText(text);
    const count = pending.get(normalized) ?? 0;
    if (count > 0) {
      pending.set(normalized, count - 1);
      return [];
    }
    return normalized ? [normalized] : [];
  });
}

export function messagesToResumeAfterAbort(
  queue: QueuedMessage[],
  cleared: AbortSessionResult,
): string[] {
  const steering = cleared.steering.map(visibleText).filter(Boolean);
  const localFollowUps = queue
    .filter((item) => item.mode === "follow_up")
    .map((item) => item.text.trim())
    .filter(Boolean);
  const runtimeFollowUps = cleared.followUp.map(visibleText).filter(Boolean);
  return [
    ...steering,
    ...localFollowUps,
    ...unmatchedRuntimeFollowUps(localFollowUps, runtimeFollowUps),
  ];
}

export function removePendingSteersClearedByAbort(
  messages: ChatMessage[],
  cleared: AbortSessionResult,
): ChatMessage[] {
  const pending = new Map<string, number>();
  for (const text of cleared.steering.map(visibleText).filter(Boolean)) {
    pending.set(text, (pending.get(text) ?? 0) + 1);
  }
  return messages.filter((message) => {
    if (message.role !== "user" || !message.awaitingEcho) return true;
    const text = visibleText(message.text);
    const count = pending.get(text) ?? 0;
    if (count === 0) return true;
    pending.set(text, count - 1);
    return false;
  });
}
