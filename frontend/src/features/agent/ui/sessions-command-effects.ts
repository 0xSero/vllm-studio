import { Effect } from "effect";
import { safeJson } from "@/features/agent/safe-json";
import type { AggregatedSession } from "@shared/agent/session-summary";

export function loadAggregatedSessionsOptional(
  since: string | null = "30d",
): Promise<AggregatedSession[] | null> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`/api/agent/sessions/all${since ? `?since=${encodeURIComponent(since)}` : ""}`, {
            cache: "no-store",
          }),
        catch: (error) => error,
      });
      if (!response.ok) return yield* Effect.fail(new Error("Failed to load sessions"));
      const payload = yield* Effect.tryPromise({
        try: () => safeJson<{ sessions?: AggregatedSession[] }>(response),
        catch: (error) => error,
      });
      return payload.sessions ?? [];
    }).pipe(Effect.catch(() => Effect.succeed(null))),
  );
}

export async function loadAggregatedSessions(
  since: string | null = "30d",
): Promise<AggregatedSession[]> {
  return (await loadAggregatedSessionsOptional(since)) ?? [];
}
