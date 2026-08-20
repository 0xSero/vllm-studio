import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineJobSchema } from "@local-studio/contracts/system";
import { Effect, Schedule, Schema } from "effect";
import { type AppContext, AppContextService } from "../../app-context";
import { createControllerRuntime, type ControllerRuntime } from "../../core/effect-runtime";
import { createApp } from "../../http/app";
import { runControllerEffect, runEffectWithCleanup } from "../../http/effect-handler";

const environmentKeys = [
  "HOME",
  "PI_CODING_AGENT_DIR",
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DB_PATH",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_HOST",
  "LOCAL_STUDIO_PORT",
  "LOCAL_STUDIO_INFERENCE_PORT",
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_DISABLE_METRICS",
  "LOCAL_STUDIO_RUNTIME_SKIP_DOCKER",
  "LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM",
  "LOCAL_STUDIO_VLLM_UPGRADE_CMD",
  "LOCAL_STUDIO_SGLANG_UPGRADE_CMD",
  "LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD",
  "LOCAL_STUDIO_MLX_PYTHON",
  "LOCAL_STUDIO_CUDA_UPGRADE_CMD",
  "LOCAL_STUDIO_ROCM_UPGRADE_CMD",
] as const;

const dispatchEnvironmentKeys = [
  "LOCAL_STUDIO_VLLM_UPGRADE_CMD",
  "LOCAL_STUDIO_SGLANG_UPGRADE_CMD",
  "LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD",
  "LOCAL_STUDIO_CUDA_UPGRADE_CMD",
  "LOCAL_STUDIO_ROCM_UPGRADE_CMD",
] as const;

const previousEnvironment = new Map<string, string | undefined>();
const terminalJobSchedule = Schedule.spaced(20).pipe(Schedule.both(Schedule.recurs(250)));
const EngineJobResponseSchema = Schema.Struct({ job: EngineJobSchema });
const EngineJobsResponseSchema = Schema.Struct({ jobs: Schema.Array(EngineJobSchema) });
const ErrorResponseSchema = Schema.Struct({ detail: Schema.String });
type DecodedEngineJob = Schema.Schema.Type<typeof EngineJobSchema>;
const terminalStatuses = new Set<DecodedEngineJob["status"]>(["success", "error", "cancelled"]);

let temporaryDirectory = "";
let mlxMarker = { command: "", marker: "" };
let runtime: ControllerRuntime;
let context: AppContext;
let app: ReturnType<typeof createApp>;

const writeMarkerCommand = (name: string): { command: string; marker: string } => {
  const command = join(temporaryDirectory, `${name}.sh`);
  const marker = `${command}.invoked`;
  writeFileSync(command, '#!/usr/bin/env sh\nprintf invoked > "$0.invoked"\n', "utf8");
  chmodSync(command, 0o755);
  return { command, marker };
};

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

const listJobs = (): Effect.Effect<readonly DecodedEngineJob[], Error> =>
  request("/runtime/jobs").pipe(
    Effect.flatMap((response) => {
      expect(response.status).toBe(200);
      return responseJson(response).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(EngineJobsResponseSchema)),
        Effect.map(({ jobs }) => jobs),
      );
    }),
  );

const awaitTerminalJob = (id: string): Effect.Effect<DecodedEngineJob, Error> =>
  request(`/runtime/jobs/${id}`).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? responseJson(response).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(EngineJobResponseSchema)),
            Effect.map(({ job }) => job),
          )
        : Effect.fail(new Error(`Runtime job ${id} was not found`)),
    ),
    Effect.flatMap((job) =>
      terminalStatuses.has(job.status)
        ? Effect.succeed(job)
        : Effect.fail(new Error(`Runtime job ${id} did not reach a terminal state`)),
    ),
    Effect.retry(terminalJobSchedule),
  );

const postRuntimeJob = (
  payload: Record<string, unknown>,
): Effect.Effect<
  { response: Response; body: Schema.Schema.Type<typeof EngineJobResponseSchema> },
  Error
> =>
  request("/runtime/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).pipe(
    Effect.flatMap((response) =>
      responseJson(response).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(EngineJobResponseSchema)),
        Effect.map((body) => ({ response, body })),
      ),
    ),
  );

beforeAll(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "local-studio-runtime-boundary-"));
  for (const key of environmentKeys) previousEnvironment.set(key, process.env[key]);
  process.env["HOME"] = join(temporaryDirectory, "home");
  process.env["PI_CODING_AGENT_DIR"] = join(temporaryDirectory, "pi");
  process.env["LOCAL_STUDIO_DATA_DIR"] = join(temporaryDirectory, "data");
  process.env["LOCAL_STUDIO_DB_PATH"] = join(temporaryDirectory, "controller.db");
  process.env["LOCAL_STUDIO_MODELS_DIR"] = join(temporaryDirectory, "models");
  process.env["LOCAL_STUDIO_HOST"] = "127.0.0.1";
  process.env["LOCAL_STUDIO_PORT"] = "18080";
  process.env["LOCAL_STUDIO_INFERENCE_PORT"] = "65534";
  process.env["LOCAL_STUDIO_DISABLE_METRICS"] = "true";
  process.env["LOCAL_STUDIO_RUNTIME_SKIP_DOCKER"] = "1";
  process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] = "1";
  delete process.env["LOCAL_STUDIO_API_KEY"];
  mlxMarker = writeMarkerCommand("mlx-decoy");
  process.env["LOCAL_STUDIO_MLX_PYTHON"] = mlxMarker.command;
  for (const key of dispatchEnvironmentKeys) delete process.env[key];
  runtime = createControllerRuntime();
  return runControllerEffect(
    runtime,
    Effect.gen(function* () {
      context = yield* AppContextService;
      app = createApp(context, runtime);
    }),
  );
});

beforeEach(() => {
  for (const key of dispatchEnvironmentKeys) delete process.env[key];
});

afterEach(() => {
  for (const key of dispatchEnvironmentKeys) delete process.env[key];
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

describe("runtime job action boundary", () => {
  const unsupportedTypes = ["inspect", "download"] as const;
  const backends = ["vllm", "sglang", "llamacpp", "mlx", "cuda", "rocm"] as const;
  const rejectedPayloads = [
    { label: "command", payload: { backend: "llamacpp", command: "unsafe-command" } },
    { label: "args", payload: { backend: "llamacpp", args: ["--unsafe"] } },
    {
      label: "command and args",
      payload: { backend: "llamacpp", command: "unsafe-command", args: ["--unsafe"] },
    },
  ] as const;

  for (const type of unsupportedTypes) {
    for (const backend of backends) {
      test(`rejects ${type} for ${backend} before queueing or dispatch`, () =>
        runControllerEffect(
          runtime,
          Effect.gen(function* () {
            const marker = writeMarkerCommand(`${backend}-${type}`);
            for (const key of dispatchEnvironmentKeys) process.env[key] = marker.command;
            const jobsBefore = yield* listJobs();

            const response = yield* request("/runtime/jobs", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ backend, type }),
            });

            expect(response.status).toBe(400);
            expect(
              yield* responseJson(response).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(ErrorResponseSchema)),
              ),
            ).toEqual({ detail: "Invalid payload" });
            expect(yield* listJobs()).toEqual(jobsBefore);
            expect(existsSync(marker.marker)).toBe(false);
            expect(existsSync(mlxMarker.marker)).toBe(false);
          }),
        ));
    }
  }

  for (const { label, payload } of rejectedPayloads) {
    test(`rejects ${label} before queueing or dispatch`, () =>
      runControllerEffect(
        runtime,
        Effect.gen(function* () {
          const marker = writeMarkerCommand(`llamacpp-${label.replaceAll(" ", "-")}`);
          process.env["LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD"] = marker.command;
          const jobsBefore = yield* listJobs();

          const response = yield* request("/runtime/jobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });

          expect(response.status).toBe(400);
          expect(
            yield* responseJson(response).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(ErrorResponseSchema)),
            ),
          ).toEqual({ detail: "Invalid payload" });
          expect(yield* listJobs()).toEqual(jobsBefore);
          expect(existsSync(marker.marker)).toBe(false);
        }),
      ));
  }

  for (const type of ["install", "update"] as const) {
    test(`dispatches llama.cpp ${type} only to its engine handler`, () =>
      runControllerEffect(
        runtime,
        Effect.gen(function* () {
          const engine = writeMarkerCommand(`llamacpp-${type}`);
          const platform = writeMarkerCommand(`cuda-decoy-${type}`);
          process.env["LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD"] = engine.command;
          process.env["LOCAL_STUDIO_CUDA_UPGRADE_CMD"] = platform.command;

          const { response, body } = yield* postRuntimeJob({ backend: "llamacpp", type });
          const job = yield* awaitTerminalJob(body.job.id);

          expect(response.status).toBe(200);
          expect(job).toMatchObject({
            backend: "llamacpp",
            type,
            status: "success",
            command: engine.command,
          });
          expect(existsSync(engine.marker)).toBe(true);
          expect(existsSync(platform.marker)).toBe(false);
        }),
      ));
  }

  for (const backend of ["cuda", "rocm"] as const) {
    test(`rejects ${backend} install without invoking its update handler`, () =>
      runControllerEffect(
        runtime,
        Effect.gen(function* () {
          const platform = writeMarkerCommand(`${backend}-install`);
          process.env[
            backend === "cuda" ? "LOCAL_STUDIO_CUDA_UPGRADE_CMD" : "LOCAL_STUDIO_ROCM_UPGRADE_CMD"
          ] = platform.command;

          const { response, body } = yield* postRuntimeJob({ backend, type: "install" });
          const job = yield* awaitTerminalJob(body.job.id);

          expect(response.status).toBe(200);
          expect(job).toMatchObject({
            type: "install",
            status: "error",
            error: `${backend.toUpperCase()} supports update jobs only.`,
          });
          expect(existsSync(platform.marker)).toBe(false);
        }),
      ));

    test(`dispatches ${backend} update only to its platform handler`, () =>
      runControllerEffect(
        runtime,
        Effect.gen(function* () {
          const platform = writeMarkerCommand(`${backend}-update`);
          const engine = writeMarkerCommand(`llamacpp-decoy-${backend}`);
          process.env[
            backend === "cuda" ? "LOCAL_STUDIO_CUDA_UPGRADE_CMD" : "LOCAL_STUDIO_ROCM_UPGRADE_CMD"
          ] = platform.command;
          process.env["LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD"] = engine.command;

          const { response, body } = yield* postRuntimeJob({ backend, type: "update" });
          const job = yield* awaitTerminalJob(body.job.id);

          expect(response.status).toBe(200);
          expect(job).toMatchObject({ type: "update", status: "success", command: platform.command });
          expect(existsSync(platform.marker)).toBe(true);
          expect(existsSync(engine.marker)).toBe(false);
        }),
      ));
  }

  test("defaults an omitted type to update", () =>
    runControllerEffect(
      runtime,
      Effect.gen(function* () {
        const platform = writeMarkerCommand("cuda-default-update");
        process.env["LOCAL_STUDIO_CUDA_UPGRADE_CMD"] = platform.command;

        const { response, body } = yield* postRuntimeJob({ backend: "cuda" });
        const job = yield* awaitTerminalJob(body.job.id);

        expect(response.status).toBe(200);
        expect(job).toMatchObject({ type: "update", status: "success", command: platform.command });
        expect(existsSync(platform.marker)).toBe(true);
      }),
    ));

  test("maps explicit upgrade routes to update", () =>
    runControllerEffect(
      runtime,
      Effect.gen(function* () {
        const engine = writeMarkerCommand("llamacpp-upgrade-route");
        process.env["LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD"] = engine.command;

        const response = yield* request("/runtime/llamacpp/upgrade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "install" }),
        });
        const body = yield* responseJson(response).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(EngineJobResponseSchema)),
        );
        const job = yield* awaitTerminalJob(body.job.id);

        expect(response.status).toBe(200);
        expect(job).toMatchObject({ type: "update", status: "success", command: engine.command });
        expect(existsSync(engine.marker)).toBe(true);
      }),
    ));
});
