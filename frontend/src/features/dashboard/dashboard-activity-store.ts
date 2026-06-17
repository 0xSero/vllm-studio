// Daily activity store — ZCode-style usage heatmap data.
//
// The realtime-status-store holds only the current GPU/metrics snapshot. For a
// 14-day utilization heatmap we need accumulated per-day history. This module
// is a tiny external store (subscribe/getSnapshot, like the rest of the app —
// no useEffect, no zustand) that:
//
//   1. Receives a utilization sample (avg GPU util % across all GPUs) each time
//      the dashboard polls.
//   2. Buckets it into the current calendar day, keeping a running max.
//   3. Persists the last 14 days to localStorage so the heatmap survives reloads.
//
// It is intentionally a pure module singleton so any number of components can
// subscribe; the dashboard calls `recordActivitySample()` from its data hook.

const STORAGE_KEY = "vllm-studio.dashboardActivity";
const DAY_MS = 86_400_000;
const HISTORY_DAYS = 14;

export interface DayBucket {
  /** Local-date key YYYY-MM-DD. */
  day: string;
  /** Epoch ms for the start of this day (used for sorting/labels). */
  at: number;
  /** Peak utilization percent observed during the day, 0..100. */
  peakUtil: number;
  /** Sample count — how many polls landed in this day. */
  samples: number;
}

export interface ActivitySnapshot {
  days: DayBucket[]; // oldest→newest, length ≤ HISTORY_DAYS
  today: DayBucket | null;
}

const EMPTY: ActivitySnapshot = { days: [], today: null };

const listeners = new Set<() => void>();
let cache: ActivitySnapshot | null = null;

function dayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(epochMs: number): number {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function load(): ActivitySnapshot {
  if (cache) return cache;
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = EMPTY;
      return cache;
    }
    const parsed = JSON.parse(raw) as DayBucket[];
    if (!Array.isArray(parsed)) {
      cache = EMPTY;
      return cache;
    }
    cache = normalize(parsed);
    return cache;
  } catch {
    cache = EMPTY;
    return cache;
  }
}

function normalize(days: DayBucket[]): ActivitySnapshot {
  const cutoff = startOfDay(Date.now()) - (HISTORY_DAYS - 1) * DAY_MS;
  const kept = days
    .filter((d) => d && typeof d.day === "string" && d.at >= cutoff)
    .sort((a, b) => a.at - b.at);
  const today = kept.length > 0 ? kept[kept.length - 1] : null;
  return { days: kept, today };
}

function persist(next: ActivitySnapshot): void {
  cache = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.days));
  } catch {
    /* quota / private mode — keep in-memory only */
  }
  for (const listener of listeners) listener();
}

/** Record one utilization sample (0..100). Called by the dashboard data hook. */
export function recordActivitySample(utilizationPct: number): void {
  const now = Date.now();
  const key = dayKey(now);
  const at = startOfDay(now);
  const clamped = Math.max(0, Math.min(100, Number.isFinite(utilizationPct) ? utilizationPct : 0));
  const current = load();
  const days = [...current.days];
  const todayIdx = days.findIndex((d) => d.day === key);
  let nextToday: DayBucket;
  if (todayIdx >= 0) {
    const existing = days[todayIdx];
    nextToday = {
      day: key,
      at,
      peakUtil: Math.max(existing.peakUtil, clamped),
      samples: existing.samples + 1,
    };
    days[todayIdx] = nextToday;
  } else {
    nextToday = { day: key, at, peakUtil: clamped, samples: 1 };
    days.push(nextToday);
  }
  persist(normalize(days));
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActivitySnapshot(): ActivitySnapshot {
  return load();
}

/** Map a utilization value to a 0..4 heatmap ramp index. */
export function heatLevel(utilizationPct: number): 0 | 1 | 2 | 3 | 4 {
  if (utilizationPct <= 0) return 0;
  if (utilizationPct < 20) return 1;
  if (utilizationPct < 45) return 2;
  if (utilizationPct < 70) return 3;
  return 4;
}
