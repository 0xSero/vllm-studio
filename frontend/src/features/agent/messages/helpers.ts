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

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function numberFromRecord(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    const parsed =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
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

export function messageText(
  content: string | Array<Record<string, unknown>> | undefined,
  separator = "\n",
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join(separator);
}

export function runtimeStatusLooksActive(status: { active?: boolean }): boolean {
  return status.active === true;
}

/** Whether a runtime status snapshot says the session can take a steer or a
 *  follow-up right now.
 *
 *  A MISSING status means "we could not tell", not "no". The probe reads
 *  `/api/agent/runtime/status`, and its loader collapses every timeout, 404,
 *  decode miss and network blip into null; treating that as a refusal drops the
 *  message into the fresh-prompt path mid-turn, which the server then converts
 *  back into a steer anyway — so the user sees their queued message vanish into
 *  the transcript instead. The turn API is the real authority and rejects with
 *  409 if the session is not actually controllable, so fail open here. */
export function runtimeStatusAcceptsControl(
  status: { active?: boolean; piSessionId?: string | null } | null,
  piSessionId?: string | null,
): boolean {
  if (!status) return true;
  if (!status.active) return false;
  return !status.piSessionId || !piSessionId || status.piSessionId === piSessionId;
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
