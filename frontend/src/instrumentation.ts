import { Effect } from "effect";

export function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return Promise.resolve();
  return Effect.runPromise(
    Effect.gen(function* () {
      const net = yield* Effect.tryPromise({
        try: () => import("node:net"),
        catch: (error) => error,
      });
      const setTimeoutFn = (
        net as unknown as {
          setDefaultAutoSelectFamilyAttemptTimeout?: (value: number) => void;
        }
      ).setDefaultAutoSelectFamilyAttemptTimeout;
      if (typeof setTimeoutFn !== "function") return;
      const configured = Number(process.env.LOCAL_STUDIO_AUTOSELECT_FAMILY_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 2000;
      setTimeoutFn(Math.max(timeoutMs, 250));
    }),
  );
}
