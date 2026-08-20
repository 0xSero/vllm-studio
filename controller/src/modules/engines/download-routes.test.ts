import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppContextService, type AppContext } from "../../app-context";
import { createControllerRuntime, type ControllerRuntime } from "../../core/effect-runtime";
import { createApp } from "../../http/app";
import { runControllerEffect, runEffectWithCleanup } from "../../http/effect-handler";
import { DownloadTargetConflict } from "./downloads/download-target-reservations";

const apiKey = "download-route-test-key";
const environmentKeys = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_API_KEY",
] as const;
type EnvironmentKey = (typeof environmentKeys)[number];

const previousEnvironment = new Map<EnvironmentKey, string | undefined>();
let temporaryDirectory = "";
let runtime: ControllerRuntime;
let context: AppContext;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "local-studio-download-route-test-"));
  for (const key of environmentKeys) previousEnvironment.set(key, process.env[key]);
  process.env["LOCAL_STUDIO_DATA_DIR"] = join(temporaryDirectory, "data");
  process.env["LOCAL_STUDIO_MODELS_DIR"] = join(temporaryDirectory, "models");
  process.env["LOCAL_STUDIO_API_KEY"] = apiKey;
  runtime = createControllerRuntime();
  return runControllerEffect(
    runtime,
    Effect.gen(function* () {
      context = yield* AppContextService;
      app = createApp(context, runtime);
    }),
  );
});

afterAll(() =>
  runEffectWithCleanup(
    runtime.disposeEffect,
    Effect.sync(() => {
      for (const key of environmentKeys) {
        const value = previousEnvironment.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }),
  ),
);

const request = (path: string, init?: RequestInit): Effect.Effect<Response, Error> =>
  Effect.sync(() => app.request(path, init)).pipe(
    Effect.flatMap((response) =>
      response instanceof Response
        ? Effect.succeed(response)
        : Effect.tryPromise({
            try: () => response,
            catch: (error) => Error(String(error)),
          }),
    ),
  );

describe("download target conflict route", () => {
  test("returns only the typed 409 conflict detail", () =>
    runControllerEffect(
      runtime,
      Effect.gen(function* () {
        const originalStart = context.downloadManager.start;
        context.downloadManager.start = (() =>
          Effect.fail(
            new DownloadTargetConflict("active-download", "/models/shared"),
          )) as AppContext["downloadManager"]["start"];
        try {
          const response = yield* request("/studio/downloads", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": apiKey },
            body: JSON.stringify({ model_id: "org/model", hf_token: "secret-token" }),
          });
          expect(response.status).toBe(409);
          expect(yield* Effect.tryPromise(() => response.json())).toEqual({
            detail:
              'Download target "/models/shared" is reserved by active download active-download',
          });
        } finally {
          context.downloadManager.start = originalStart;
        }
      }),
    ));
});
