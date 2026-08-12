import {
  cleanSessionTitle,
  isPlaceholderSessionTitle,
  sessionTitleFromUserPrompt,
} from "@shared/agent/session-title";

export { cleanSessionTitle, isPlaceholderSessionTitle };
import type { QueuedMessage, SessionTab } from "@/features/agent/messages/types";

export function randomIdSegment(length: number): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, length);
  }
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomIdSegment(8)}`;
}

export function newPaneId(): string {
  return `p-${Date.now().toString(36)}-${randomIdSegment(6)}`;
}

export function nowLabel(): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(),
  );
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(Math.max(0, Math.round(tokens)));
}

export function sessionTitleFromPrompt(text: string): string {
  return cleanSessionTitle(sessionTitleFromUserPrompt(text).slice(0, 48)) || "New session";
}

export function visibleUserTextFromPi(text: string): string {
  const marker = "\n\nUser prompt:\n";
  const idx = text.lastIndexOf(marker);
  const body = idx === -1 ? text : text.slice(idx + marker.length);
  return stripAttachmentPromptText(stripBrowserContextText(body)).trim();
}

// The Browser panel prepends a <browser_context>…</browser_context> block to
// the prompt (browser/context.ts). It is machine context, never the user's
// words — drop a leading block so echoed/replayed user turns show only what was
// typed, and so the echoed text still matches the optimistic user bubble.
function stripBrowserContextText(text: string): string {
  return text.replace(/^\s*<browser_context>[\s\S]*?<\/browser_context>\s*/i, "");
}

function stripAttachmentPromptText(text: string): string {
  const attachmentStart = text.search(/(?:^|\n\n)Attachment \d+:/);
  if (attachmentStart === -1) return text;
  return text.slice(0, attachmentStart).trim();
}

/** Every item still in the queue is pending delivery, so all of them show.
 *
 * This used to hide `sent` items, which meant EVERY follow-up — they are
 * marked sent the moment pi accepts them — so the drawer stack was always
 * empty and queueing looked broken. Items leave the queue when pi actually
 * delivers them (the user echo) or contradicts us (`queue_update`). */
export function visibleQueuedMessages(queue: QueuedMessage[]): QueuedMessage[] {
  return queue;
}

export function makeFreshTab(): SessionTab {
  return {
    // The session id doubles as the opaque runtime key the client sends to the
    // server (ids are opaque server-side). Sessions persisted under a legacy
    // rt-* runtime key reattach via the controller's connection-key seed.
    id: newId("tab"),
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
}
