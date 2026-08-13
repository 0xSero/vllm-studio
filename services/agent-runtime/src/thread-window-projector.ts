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

type ContextMessages = ReturnType<typeof contextMessages>;

function startsVisibleTurn(event: Record<string, unknown>, messages: ContextMessages): boolean {
  return !isHiddenEntry(event) && messages.some((message) => message.role === "user");
}

function messageTokens(messages: ContextMessages): number {
  return messages.reduce((total, message) => total + estimateTokens(message), 0);
}

export function isVisibleUserEntry(event: Record<string, unknown>): boolean {
  return startsVisibleTurn(event, contextMessages(event));
}

export function entryTokenEstimate(event: Record<string, unknown>): number {
  return messageTokens(contextMessages(event));
}

const UNPROJECTABLE_ENTRY = {
  type: "custom",
  id: "",
  parentId: null,
  timestamp: "",
  customType: "unprojectable",
} as unknown as SessionEntry;

function projectsCleanly(event: Record<string, unknown>): boolean {
  try {
    sessionEntryToContextMessages(event as unknown as SessionEntry);
    return true;
  } catch {
    return false;
  }
}

export function cutPointEntries(events: ReadonlyArray<Record<string, unknown>>): SessionEntry[] {
  return events.map((event) =>
    projectsCleanly(event) ? (event as unknown as SessionEntry) : UNPROJECTABLE_ENTRY,
  );
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
    startsTurn: startsVisibleTurn(event, messages),
    tokenEstimate: messageTokens(messages),
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
  const items = source.events.map(toThreadItem).filter((item): item is ThreadItem => item !== null);
  return {
    threadId: source.threadId,
    found: source.found,
    turns: groupThreadTurns(items),
    cursor: source.cursor,
    activityEventCount: source.events.filter(
      (event) =>
        event.type !== "session" &&
        event.type !== "model_change" &&
        event.type !== "thinking_level_change",
    ).length,
    tokenEstimate: items.reduce((total, item) => total + item.tokenEstimate, 0),
    meta: source.meta,
  };
}
