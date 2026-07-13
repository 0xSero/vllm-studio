import { useCallback, useRef, useSyncExternalStore } from "react";
import { effectInterval } from "@/lib/effect-timers";

function useNowTicker(active: boolean): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!active) return () => undefined;
      const timer = effectInterval(onStoreChange, 1_000);
      return () => timer.cancel();
    },
    [active],
  );
  return useSyncExternalStore(
    subscribe,
    () => (active ? Math.floor(Date.now() / 1_000) : 0),
    () => 0,
  );
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

/* ── Turn status divider ──────────────────────────────────────────────────
   Codex separates agent activity from the final response with a labeled rule:
   "Working for 1m 23s" while streaming, frozen to "Worked for 1m 23s" once the
   response begins. Durations only exist for turns observed live in this mount —
   history reloads render without the divider, matching Codex's own fallback. */
export function WorkedForDivider({
  working,
  hasActivity,
}: {
  working: boolean;
  hasActivity: boolean;
}) {
  // Refs (not state) so the start/end capture never triggers extra renders;
  // both are write-once per mount.
  const startRef = useRef<number | null>(null);
  const endRef = useRef<number | null>(null);
  if (working && startRef.current === null) startRef.current = Date.now();
  if (!working && startRef.current !== null && endRef.current === null) {
    endRef.current = Date.now();
  }
  useNowTicker(working);

  if (startRef.current === null) return null;
  const elapsedMs = (endRef.current ?? Date.now()) - startRef.current;
  if (!hasActivity && elapsedMs < 2_000) return null;
  const label = working
    ? `Working for ${formatElapsed(elapsedMs)}`
    : `Worked for ${formatElapsed(elapsedMs)}`;

  return (
    <div className="flex items-center gap-3 py-1 text-[length:var(--fs-sm)] text-(--fg)/35">
      <span className="h-px flex-1 bg-(--separator)" />
      <span className={working ? "codex-shimmer-text" : undefined}>{label}</span>
      <span className="h-px flex-1 bg-(--separator)" />
    </div>
  );
}
