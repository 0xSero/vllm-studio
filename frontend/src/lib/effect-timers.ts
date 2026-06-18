// Effect-TS timer helpers — thin wrappers around Effect fibers for the
// setInterval/setTimeout/EventSource patterns used across the app. Each returns
// an interruptible handle so callers can clean up on unmount without touching
// raw timer IDs.
//
// The codebase bans useEffect; these are used inside useSyncExternalStore
// subscribe functions and module-level lifecycles, not in render.

import { Effect, Fiber, Schedule } from "effect";

/** A cancellable handle returned by all Effect timer helpers. */
export interface EffectTimer {
  /** Interrupt the underlying fiber. Safe to call multiple times. */
  cancel(): void;
}

/**
 * Run `fn` every `intervalMs` milliseconds on an Effect fiber. Replaces
 * `setInterval(fn, intervalMs)`. The fiber is interruptible via the returned
 * handle.
 */
export function effectInterval(fn: () => void, intervalMs: number): EffectTimer {
  const fiber = Effect.runFork(
    Effect.sync(fn).pipe(Effect.repeat(Schedule.spaced(intervalMs))),
  ) as Fiber.RuntimeFiber<void, unknown>;
  return {
    cancel: () => {
      void Promise.resolve(Fiber.interrupt(fiber as never));
    },
  };
}

/**
 * Run `fn` after `delayMs` milliseconds on an Effect fiber. Replaces
 * `setTimeout(fn, delayMs)`. The fiber is interruptible via the returned
 * handle.
 */
export function effectTimeout(fn: () => void, delayMs: number): EffectTimer {
  const fiber = Effect.runFork(
    Effect.gen(function* () {
      yield* Effect.sleep(delayMs);
      fn();
    }),
  ) as Fiber.RuntimeFiber<void, unknown>;
  return {
    cancel: () => {
      void Promise.resolve(Fiber.interrupt(fiber as never));
    },
  };
}

/**
 * Debounce `fn` by `delayMs` — calls cancel any pending invocation. Replaces
 * the `clearTimeout(timer); timer = setTimeout(fn, delay)` pattern. Returns a
 * function that triggers the debounce and a cancel handle.
 */
export function effectDebounce(delayMs: number): {
  trigger: (fn: () => void) => void;
  cancel: () => void;
} {
  let current: Fiber.RuntimeFiber<void, unknown> | null = null;
  return {
    trigger(fn: () => void) {
      if (current) void Promise.resolve(Fiber.interrupt(current as never));
      current = Effect.runFork(
        Effect.gen(function* () {
          yield* Effect.sleep(delayMs);
          fn();
        }),
      ) as Fiber.RuntimeFiber<void, unknown>;
    },
    cancel() {
      if (current) void Promise.resolve(Fiber.interrupt(current as never));
      current = null;
    },
  };
}
