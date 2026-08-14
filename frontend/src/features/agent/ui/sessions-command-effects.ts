import { Effect } from "effect";
import { safeJson } from "@/features/agent/safe-json";
import type { AggregatedSession } from "@shared/agent/session-summary";

export function loadAggregatedSessions(): Promise<AggregatedSession[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch("/api/agent/sessions/all?since=30d", { cache: "no-store" }),
        catch: () => new Error("Session list request failed"),
      });
      if (!response.ok) {
        return yield* Effect.fail(new Error(`Session list request failed (${response.status})`));
      }
      const payload = yield* Effect.tryPromise({
        try: () => safeJson<{ sessions?: AggregatedSession[] }>(response),
        catch: () => new Error("Session list response was not valid JSON"),
      });
      return payload.sessions ?? [];
    }),
  );
}
