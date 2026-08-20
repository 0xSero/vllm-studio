import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../../config/env";
import type { Logger } from "../../../core/logger";
import { runEffectWithCleanup } from "../../../http/effect-handler";
import { EventManager } from "../../system/event-manager";
import { EngineOperationError } from "../engine-spec";
import { DownloadManager } from "./download-manager";
import { DownloadStore } from "./download-store";
import { DownloadTargetConflict, DownloadTargetReservations } from "./download-target-reservations";
import type { FetchEffect } from "./huggingface-api";

type Harness = { manager: DownloadManager; root: string; store: DownloadStore };
type FetchLike = (url: string, init?: RequestInit) => Effect.Effect<Response, EngineOperationError>;

const logger = {
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  shutdown: (): Effect.Effect<void> => Effect.void,
} satisfies Logger;

const createHarness = (fetchLike: FetchLike): Effect.Effect<Harness, EngineOperationError> =>
  Effect.gen(function* () {
    const root = mkdtempSync(join(tmpdir(), "local-studio-target-lock-"));
    const config: Config = {
      host: "127.0.0.1",
      port: 8080,
      inference_host: "127.0.0.1",
      inference_port: 8000,
      data_dir: root,
      db_path: join(root, "controller.db"),
      models_dir: join(root, "models"),
      strict_openai_models: false,
      cors_origins: [],
      providers: [],
    };
    const store = yield* DownloadStore.make(config.db_path);
    const manager = yield* DownloadManager.make(
      config,
      store,
      new EventManager(),
      logger,
      fetchLike as FetchEffect,
    );
    return { manager, root, store };
  });

const modelInfo = (size = 4): Response =>
  Response.json({ sha: "abc123", siblings: [{ rfilename: "model.bin", size }] });

const cleanup = (harness: Harness): Effect.Effect<void> =>
  harness.manager.shutdown().pipe(
    Effect.catch(() => Effect.void),
    Effect.andThen(harness.store.close().pipe(Effect.catch(() => Effect.void))),
    Effect.andThen(Effect.sync(() => rmSync(harness.root, { recursive: true, force: true }))),
  );

describe("download target reservations", () => {
  test("canonicalizes physical aliases and ignores stale owner release", () => {
    const root = mkdtempSync(join(tmpdir(), "local-studio-target-key-"));
    const physical = join(root, "physical");
    const alias = join(root, "alias");
    mkdirSync(physical);
    symlinkSync(physical, alias);
    try {
      const reservations = new DownloadTargetReservations({
        caseInsensitive: true,
        unicodeNormalization: "NFC",
      });
      const first = reservations.acquire(join(alias, "Tree"), "first");
      expect(() => reservations.acquire(join(physical, "tree", "child"), "nested")).toThrow(
        DownloadTargetConflict,
      );
      const sibling = reservations.acquire(join(physical, "other"), "sibling");
      reservations.release(first);
      const replacement = reservations.acquire(join(physical, "TREE"), "replacement");
      reservations.release(first);
      expect(() => reservations.acquire(join(alias, "tree"), "stale-release")).toThrow(
        DownloadTargetConflict,
      );
      reservations.release(replacement);
      reservations.release(sibling);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reserves before metadata and permits unrelated targets", () =>
    runEffectWithCleanup(
      Effect.gen(function* () {
        const first = yield* Deferred.make<Response>();
        const second = yield* Deferred.make<Response>();
        const firstStarted = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const pending = [first, second];
        const fetchLike: FetchLike = (url) => {
          if (url.includes("/resolve/")) return Effect.succeed(new Response("done"));
          const response = pending.shift();
          if (!response) {
            return Effect.fail(
              new EngineOperationError({ operation: "test", message: "unexpected metadata" }),
            );
          }
          const started = response === first ? firstStarted : secondStarted;
          return Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(response)),
          );
        };
        const harness = yield* createHarness(fetchLike);
        const active = yield* Effect.forkChild(
          harness.manager.start({ model_id: "org/one", destination_dir: "shared" }),
        );
        yield* Deferred.await(firstStarted);
        const conflict = yield* Effect.exit(
          harness.manager.start({ model_id: "org/two", destination_dir: "shared/." }),
        );
        expect(Exit.isFailure(conflict)).toBe(true);
        const unrelated = yield* Effect.forkChild(
          harness.manager.start({ model_id: "org/three", destination_dir: "unrelated" }),
        );
        yield* Deferred.await(secondStarted);
        yield* Deferred.succeed(first, Response.json({ siblings: [] }));
        yield* Deferred.succeed(second, Response.json({ siblings: [] }));
        expect(Exit.isFailure(yield* Effect.exit(Fiber.join(active)))).toBe(true);
        expect(Exit.isFailure(yield* Effect.exit(Fiber.join(unrelated)))).toBe(true);
        yield* cleanup(harness);
      }),
      Effect.void,
    ));

  test("releases a failed metadata reservation for a later retry", () =>
    runEffectWithCleanup(
      Effect.gen(function* () {
        const failed = yield* Deferred.make<void>();
        let failOnce = true;
        const fetchLike: FetchLike = (url) => {
          if (url.includes("/resolve/")) return Effect.succeed(new Response("done"));
          if (failOnce) {
            failOnce = false;
            return Deferred.succeed(failed, undefined).pipe(
              Effect.andThen(Effect.succeed(new Response("failed", { status: 500 }))),
            );
          }
          return Effect.succeed(modelInfo());
        };
        const harness = yield* createHarness(fetchLike);
        const first = yield* Effect.exit(
          harness.manager.start({ model_id: "org/retry", destination_dir: "same" }),
        );
        yield* Deferred.await(failed);
        expect(Exit.isFailure(first)).toBe(true);
        const retry = yield* harness.manager.start({
          model_id: "org/retry",
          destination_dir: "same",
        });
        expect(retry.target_dir).toContain("same");
        yield* cleanup(harness);
      }),
      Effect.void,
    ));
});
