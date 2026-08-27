import { Schema } from "effect";
import type { BrowserState } from "@/features/agent/tools/types";

export const SESSION_VIEW_STATE_KEY = "local-studio.agent.sessionViewState.v1";
const MAX_SESSION_VIEWS = 100;

type ViewStorage = Pick<Storage, "getItem" | "setItem">;

export type SessionViewIdentity = {
  key: string;
  aliases: string[];
};

export type SessionBrowserState = BrowserState;

export type SessionViewState = {
  scrollTop: number;
  stickToBottom: boolean;
  browser?: SessionBrowserState;
};

const SessionBrowserStateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  backend: Schema.String,
  url: Schema.String,
  input: Schema.String,
});

const SessionViewStateSchema = Schema.Struct({
  scrollTop: Schema.Number,
  stickToBottom: Schema.Boolean,
  browser: Schema.optional(SessionBrowserStateSchema),
});

const SessionViewStoreSchema = Schema.Struct({
  version: Schema.Literal(1),
  views: Schema.Record(Schema.String, SessionViewStateSchema),
});

const decodeSessionViews = Schema.decodeUnknownOption(SessionViewStoreSchema);

function normalizeView(value: typeof SessionViewStateSchema.Type): SessionViewState {
  const browser: SessionBrowserState | undefined = value.browser
    ? {
        enabled: value.browser.enabled,
        backend: value.browser.backend === "chrome" ? "chrome" : "embedded",
        url: value.browser.url.slice(0, 8192),
        input: value.browser.input.slice(0, 8192),
      }
    : undefined;
  return {
    scrollTop: Math.max(0, value.scrollTop),
    stickToBottom: value.stickToBottom,
    ...(browser ? { browser } : {}),
  };
}

function loadSessionViews(storage: ViewStorage): Map<string, SessionViewState> {
  try {
    const decoded = decodeSessionViews(
      JSON.parse(storage.getItem(SESSION_VIEW_STATE_KEY) ?? "null"),
    );
    if (decoded._tag === "None") return new Map();
    return new Map(
      Object.entries(decoded.value.views).map(([key, value]) => [key, normalizeView(value)]),
    );
  } catch {
    return new Map();
  }
}

function writeSessionViews(
  storage: ViewStorage,
  views: ReadonlyMap<string, SessionViewState>,
): void {
  const entries = [...views].slice(-MAX_SESSION_VIEWS);
  try {
    storage.setItem(
      SESSION_VIEW_STATE_KEY,
      JSON.stringify({ version: 1, views: Object.fromEntries(entries) }),
    );
  } catch {}
}

export function readSessionView(
  storage: ViewStorage,
  identity: SessionViewIdentity,
): SessionViewState | null {
  const views = loadSessionViews(storage);
  return (
    views.get(identity.key) ?? identity.aliases.map((key) => views.get(key)).find(Boolean) ?? null
  );
}

export function patchSessionView(
  storage: ViewStorage,
  identity: SessionViewIdentity,
  patch: Partial<SessionViewState>,
): SessionViewState {
  const views = loadSessionViews(storage);
  const current = views.get(identity.key) ??
    identity.aliases.map((key) => views.get(key)).find(Boolean) ?? {
      scrollTop: 0,
      stickToBottom: true,
    };
  const next = normalizeView({ ...current, ...patch });
  for (const alias of identity.aliases) views.delete(alias);
  views.delete(identity.key);
  views.set(identity.key, next);
  writeSessionViews(storage, views);
  return next;
}

export function browserSessionView(browser: BrowserState): SessionBrowserState {
  return browser;
}
