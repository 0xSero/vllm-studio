import { getGlobalSingleton } from "../instances";

export type BrowserHistoryEntry = {
  at: string;
  action: string;
  url?: string;
  title?: string;
  detail?: string;
  ok: boolean;
  error?: string;
};

const RING_SIZE = 250;

class BrowserHistory {
  private entries: BrowserHistoryEntry[] = [];
  private lastUrl = "";
  private lastTitle = "";

  record(entry: Omit<BrowserHistoryEntry, "at">): void {
    if (entry.url) this.lastUrl = entry.url;
    if (entry.title) this.lastTitle = entry.title;
    this.entries.push({
      at: new Date().toISOString(),
      ...entry,
      url: entry.url || this.lastUrl || undefined,
      title: entry.title || (entry.url ? undefined : this.lastTitle) || undefined,
    });
    if (this.entries.length > RING_SIZE) {
      this.entries = this.entries.slice(this.entries.length - RING_SIZE);
    }
  }

  list(limit = 50): BrowserHistoryEntry[] {
    const bounded = Number.isFinite(limit)
      ? Math.max(1, Math.min(RING_SIZE, Math.trunc(limit)))
      : 50;
    return this.entries.slice(-bounded);
  }

  visitedUrls(limit = 50): Array<{ url: string; title?: string; at: string }> {
    const seen = new Map<string, { url: string; title?: string; at: string }>();
    for (const entry of this.entries) {
      if (!entry.url) continue;
      seen.set(entry.url, { url: entry.url, title: entry.title, at: entry.at });
    }
    return [...seen.values()].slice(-Math.max(1, limit));
  }
}

export const browserHistory = getGlobalSingleton("browserHistory", () => new BrowserHistory());
