import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { createOAuthLoopbackLifecycle } from "../../services/agent-runtime/src/oauth-loopback-lifecycle";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("OAuth loopback starts serialize replacement so every prior listener closes", async () => {
  const lifecycle = createOAuthLoopbackLifecycle();
  const firstEntered = deferred();
  const releaseFirst = deferred();
  const listeners: Array<{ closed: boolean }> = [];
  let active: { closed: boolean } | null = null;
  const start = (hold: boolean) =>
    lifecycle.start(
      Effect.promise(async () => {
        if (active) active.closed = true;
        active = { closed: false };
        listeners.push(active);
        if (hold) {
          firstEntered.resolve();
          await releaseFirst.promise;
        }
      }),
    );

  const first = Effect.runPromise(start(true));
  await firstEntered.promise;
  const second = Effect.runPromise(start(false));
  await Promise.resolve();
  assert.equal(listeners.length, 1);
  releaseFirst.resolve();
  await Promise.all([first, second]);
  assert.equal(listeners.length, 2);
  assert.equal(listeners[0]?.closed, true);
  assert.equal(listeners[1]?.closed, false);
});

test("OAuth loopback cancellation invalidates before joining an in-progress start", async () => {
  const lifecycle = createOAuthLoopbackLifecycle();
  const startEntered = deferred();
  const releaseStart = deferred();
  const events: string[] = [];
  const start = Effect.runPromise(
    lifecycle.start(
      Effect.promise(async () => {
        events.push("start");
        startEntered.resolve();
        await releaseStart.promise;
        events.push("started");
      }),
    ),
  );
  await startEntered.promise;
  const cancellation = Effect.runPromise(
    lifecycle.cancel(
      Effect.sync(() => events.push("invalidated")),
      Effect.sync(() => events.push("closed")),
    ),
  );
  await Promise.resolve();
  assert.deepEqual(events, ["start", "invalidated"]);
  releaseStart.resolve();
  await Promise.all([start, cancellation]);
  assert.deepEqual(events, ["start", "invalidated", "started", "closed", "invalidated"]);
});

test("OAuth loopback cancellation invalidates a replacement already queued ahead of it", async () => {
  const lifecycle = createOAuthLoopbackLifecycle();
  const firstEntered = deferred();
  const releaseFirst = deferred();
  const events: string[] = [];
  const first = Effect.runPromise(
    lifecycle.start(
      Effect.promise(async () => {
        events.push("first");
        firstEntered.resolve();
        await releaseFirst.promise;
        events.push("first-done");
      }),
    ),
  );
  await firstEntered.promise;
  const second = Effect.runPromise(lifecycle.start(Effect.sync(() => events.push("second"))));
  const cancellation = Effect.runPromise(
    lifecycle.cancel(
      Effect.sync(() => events.push("invalidated")),
      Effect.sync(() => events.push("closed")),
    ),
  );
  await Promise.resolve();
  assert.deepEqual(events, ["first", "invalidated"]);
  releaseFirst.resolve();
  await Promise.all([first, second, cancellation]);
  assert.ok(events.lastIndexOf("invalidated") > events.indexOf("second"));
  assert.ok(events.indexOf("closed") > events.indexOf("second"));
});
