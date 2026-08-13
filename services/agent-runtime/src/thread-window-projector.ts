import { Schema } from "effect";
import {
  estimateTokens,
  sessionEntryToContextMessages,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
  ThreadEntrySchema,
  type ThreadItem,
  type ThreadTurn,
  type ThreadWindow,
  type ThreadWindowMeta,
} from "../../../shared/agent/thread";

export type ThreadWindowSource = {
  threadId: string;
  found: boolean;
  events: ReadonlyArray<Record<string, unknown>>;
  cursor: number | null;
  meta: ThreadWindowMeta | null;
};

const CURSOR_PREFIX = "w1:";

const decodeThreadEntry = Schema.decodeUnknownOption(ThreadEntrySchema);

function contextMessages(event: Record<string, unknown>) {
  try {
    return sessionEntryToContextMessages(event as unknown as SessionEntry);
  } catch {
    return [];
  }
}

function isHiddenEntry(event: Record<string, unknown>): boolean {
  return event.type === "custom_message" && event.display === false;
}

function toThreadItem(event: Record<string, unknown>): ThreadItem | null {
  const decoded = decodeThreadEntry(event);
  if (decoded._tag === "None") return null;
  const entry = decoded.value;
  const messages = contextMessages(event);
  return {
    id: entry.id,
    type: entry.type,
    timestamp: entry.timestamp ?? null,
    parentId: entry.parentId ?? null,
    role: messages[0]?.role ?? null,
    startsTurn: !isHiddenEntry(event) && messages.some((message) => message.role === "user"),
    tokenEstimate: messages.reduce((total, message) => total + estimateTokens(message), 0),
    payload: event,
  };
}

type TurnDraft = {
  id: string;
  startedAt: string | null;
  startsWithUser: boolean;
  items: ThreadItem[];
};

export function groupThreadTurns(items: readonly ThreadItem[]): ThreadTurn[] {
  const drafts: TurnDraft[] = [];
  for (const item of items) {
    const open = drafts[drafts.length - 1];
    if (!open || item.startsTurn) {
      drafts.push({
        id: item.id,
        startedAt: item.timestamp,
        startsWithUser: item.startsTurn,
        items: [item],
      });
      continue;
    }
    open.items.push(item);
  }
  return drafts.map((draft) => ({
    ...draft,
    tokenEstimate: draft.items.reduce((total, item) => total + item.tokenEstimate, 0),
  }));
}

export function encodeThreadCursor(offset: number | null): string | null {
  if (offset === null || !Number.isFinite(offset) || offset < 0) return null;
  return Buffer.from(`${CURSOR_PREFIX}${Math.floor(offset)}`, "utf8").toString("base64url");
}

export function decodeThreadCursor(cursor: string | null | undefined): number | undefined {
  const value = cursor?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  if (!decoded.startsWith(CURSOR_PREFIX)) return undefined;
  const offset = Number.parseInt(decoded.slice(CURSOR_PREFIX.length), 10);
  return Number.isInteger(offset) && offset >= 0 ? offset : undefined;
}

export function projectThreadWindow(source: ThreadWindowSource): ThreadWindow {
  const items = source.events
    .map(toThreadItem)
    .filter((item): item is ThreadItem => item !== null);
  return {
    threadId: source.threadId,
    found: source.found,
    turns: groupThreadTurns(items),
    cursor: encodeThreadCursor(source.cursor),
    tokenEstimate: items.reduce((total, item) => total + item.tokenEstimate, 0),
    meta: source.meta,
  };
}
