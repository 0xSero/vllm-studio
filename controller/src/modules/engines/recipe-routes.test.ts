import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppContextService } from "../../app-context";
import { createControllerRuntime, type ControllerRuntime } from "../../core/effect-runtime";
import { createApp } from "../../http/app";
import { runControllerEffect, runEffectWithCleanup } from "../../http/effect-handler";
import { Effect, Exit } from "effect";

const apiKey = "recipe-route-test-key";
const environmentKeys = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE",
] as const;
type EnvironmentKey = (typeof environmentKeys)[number];

const previousEnvironment = new Map<EnvironmentKey, string | undefined>();
let temporaryDirectory = "";
let runtime: ControllerRuntime;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "local-studio-recipe-route-test-"));
  for (const key of environmentKeys) previousEnvironment.set(key, process.env[key]);
  process.env["LOCAL_STUDIO_DATA_DIR"] = join(temporaryDirectory, "data");
  process.env["LOCAL_STUDIO_MODELS_DIR"] = join(temporaryDirectory, "models");
  process.env["LOCAL_STUDIO_API_KEY"] = apiKey;
  delete process.env["LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE"];
  runtime = createControllerRuntime();
  return runControllerEffect(
    runtime,
    Effect.gen(function* () {
      const context = yield* AppContextService;
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

const responseJson = (response: Response): Effect.Effect<unknown, Error> =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: (error) => Error(String(error)),
  });

describe("recipe boolean route validation", () => {
  test("rejects invalid flags without persistence", () =>
    runControllerEffect(
      runtime,
      Effect.gen(function* () {
        const fields = ["trust_remote_code", "enable_auto_tool_choice"] as const;
        const invalidValues: ReadonlyArray<unknown> = [null, "true", "false", 0, 1, [], {}];

        for (const field of fields) {
          for (const [index, value] of invalidValues.entries()) {
            const id = `invalid-${field}-${index}`;
            const response = yield* request("/recipes", {
              method: "POST",
              headers: { "content-type": "application/json", "x-api-key": apiKey },
              body: JSON.stringify({
                id,
                name: "Invalid Boolean Recipe",
                model_path: join(temporaryDirectory, "models", id),
                [field]: value,
              }),
            });

            expect(response.status).toBe(400);
            expect(yield* responseJson(response)).toEqual({ detail: `Error: Invalid ${field}` });

            const persisted = yield* request(`/recipes/${id}`, {
              headers: { "x-api-key": apiKey },
            });
            expect(persisted.status).toBe(404);
          }
        }
      }),
    ));

  test("applies defaults and preserves explicit false through PUT", () =>
    runControllerEffect(
      runtime,
      Effect.gen(function* () {
        const id = "recipe-defaults-and-update";
        const modelPath = join(temporaryDirectory, "models", id);
        const createResponse = yield* request("/recipes", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify({ id, name: "Recipe", model_path: modelPath }),
        });

        expect(createResponse.status).toBe(200);
        const created = yield* request(`/recipes/${id}`, {
          headers: { "x-api-key": apiKey },
        });
        expect(yield* responseJson(created)).toMatchObject({
          trust_remote_code: true,
          enable_auto_tool_choice: false,
        });

        const updateResponse = yield* request(`/recipes/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify({
            name: "Updated Recipe",
            model_path: modelPath,
            trust_remote_code: false,
            enable_auto_tool_choice: false,
          }),
        });

        expect(updateResponse.status).toBe(200);
        const updated = yield* request(`/recipes/${id}`, {
          headers: { "x-api-key": apiKey },
        });
        expect(yield* responseJson(updated)).toMatchObject({
          name: "Updated Recipe",
          trust_remote_code: false,
          enable_auto_tool_choice: false,
        });
      }),
    ));

  test("runs cleanup after disposal, including when disposal fails", () =>
    runControllerEffect(
      runtime,
      Effect.gen(function* () {
        const events: string[] = [];
        const successful = yield* Effect.tryPromise({
          try: () =>
            runEffectWithCleanup(
              Effect.sync(() => {
                events.push("dispose");
              }),
              Effect.sync(() => {
                events.push("cleanup");
              }),
            ),
          catch: (source) => source,
        });
        expect(successful).toBeUndefined();
        expect(events).toEqual(["dispose", "cleanup"]);

        events.length = 0;
        const failed = yield* Effect.exit(
          Effect.tryPromise({
            try: () =>
              runEffectWithCleanup(
                Effect.fail(new Error("dispose failed")),
                Effect.sync(() => {
                  events.push("cleanup");
                }),
              ),
            catch: (source) => source,
          }),
        );
        expect(Exit.isFailure(failed)).toBe(true);
        expect(events).toEqual(["cleanup"]);
      }),
    ));
});
