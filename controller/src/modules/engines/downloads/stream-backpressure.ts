import type { EventEmitter } from "node:events";
import { Effect } from "effect";

type WriterFailure = {
  dispose: () => void;
  throwIfFailed: () => void;
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/**
 * Resolve on the first `event`, fail on the first `"error"`, and never do both — Node can
 * emit "error" after `start()` throws synchronously, so the settle guard is load-bearing.
 */
export const awaitWriterEvent = (
  writer: EventEmitter,
  event: "drain" | "close",
  start?: () => void,
): Effect.Effect<void, Error> =>
  Effect.callback<void, Error>((resume) => {
    let settled = false;
    const settle = (effect: Effect.Effect<void, Error>): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resume(effect);
    };
    const onEvent = (): void => settle(Effect.void);
    const onError = (error: unknown): void => settle(Effect.fail(toError(error)));
    const cleanup = (): void => {
      writer.removeListener(event, onEvent);
      writer.removeListener("error", onError);
    };
    writer.once(event, onEvent);
    writer.once("error", onError);
    try {
      start?.();
    } catch (cause) {
      onError(cause);
    }
    return Effect.sync(cleanup);
  });

export const trackWriterFailure = (writer: EventEmitter): WriterFailure => {
  let failure: Error | null = null;
  const onError = (error: unknown): void => {
    failure = toError(error);
  };
  writer.on("error", onError);
  return {
    dispose: (): void => {
      writer.removeListener("error", onError);
    },
    throwIfFailed: (): void => {
      if (failure) throw failure;
    },
  };
};
