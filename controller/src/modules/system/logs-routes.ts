import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { Effect, Schema, Stream } from "effect";
import { defineRoutes, effectRoute, mergeRoutes } from "../../http/route-registrar";
import { badRequest, notFound } from "../../core/errors";
import { findObservedInferenceProcess } from "../../core/function-observability";
import {
  abortEffect,
  buildSseHeaders,
  toReadableByteStream,
  withSseHeartbeat,
} from "../../http/sse";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import { Event } from "./event-manager";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import {
  cleanupLogFiles,
  fallbackLogPathFor,
  getLogCleanupDefaultsFromEnvironment,
  listLogFiles,
  primaryLogPathFor,
  resolveExistingLogPath,
  sanitizeLogSessionId,
  tailFileLines,
} from "../../core/log-files";
import { redactLogLine } from "../../core/log-redaction";
import { runCommandAsyncEffect } from "../../core/command";

const boundedLineCount = (minimum: number): Schema.Codec<number, string> =>
  Schema.FiniteFromString.pipe(
    Schema.check(Schema.isInt(), Schema.isBetween({ minimum, maximum: 20_000 })),
  );
const LogLimitSchema = boundedLineCount(1);
const LogTailSchema = boundedLineCount(0);

/** Decode an optional numeric query parameter, keeping `undefined` when it is absent. */
const decodeLineCount = (
  schema: Schema.Codec<number, string>,
  raw: string | undefined,
  message: string,
): Effect.Effect<number | undefined, ReturnType<typeof badRequest>> =>
  raw === undefined
    ? Effect.succeed(undefined)
    : Schema.decodeUnknownEffect(schema)(raw).pipe(Effect.mapError(() => badRequest(message)));

const waitForChildExit = (child: ReturnType<typeof spawn>): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void);
      return;
    }
    const exited = (): void => resume(Effect.void);
    child.once("close", exited);
    return Effect.sync(() => child.removeListener("close", exited));
  });

/** Run a throwing thunk, surfacing whatever it threw on the error channel. */
const attempt = <A>(thunk: () => A): Effect.Effect<A, unknown> =>
  Effect.try({ try: thunk, catch: (error) => error });

const signalChild = (
  child: ReturnType<typeof spawn>,
  signal: "SIGTERM" | "SIGKILL",
): Effect.Effect<void> => attempt(() => child.kill(signal)).pipe(Effect.catch(() => Effect.void));

const terminateChild = (child: ReturnType<typeof spawn>): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (child.exitCode !== null || child.signalCode !== null) return;
    yield* signalChild(child, "SIGTERM");
    const exited = yield* Effect.raceFirst(
      waitForChildExit(child).pipe(Effect.as(true)),
      Effect.sleep(1_000).pipe(Effect.as(false)),
    );
    if (exited || child.exitCode !== null || child.signalCode !== null) return;
    yield* signalChild(child, "SIGKILL");
    yield* Effect.raceFirst(waitForChildExit(child), Effect.sleep(1_000));
  });

export const registerLogsRoutes = defineRoutes((app, context) => {
  let lastCleanupAt = 0;

  const maybeCleanup = (): void => {
    const now = Date.now();
    if (now - lastCleanupAt < 60_000) return;
    lastCleanupAt = now;
    cleanupLogFiles(context.config.data_dir, getLogCleanupDefaultsFromEnvironment());
  };

  const decodeSessionId = (
    sessionId: string,
  ): Effect.Effect<string, ReturnType<typeof badRequest>> => {
    const safe = sanitizeLogSessionId(sessionId);
    return safe ? Effect.succeed(safe) : Effect.fail(badRequest("Invalid log session id"));
  };

  const getDockerContainerForSession = (sessionId: string): Effect.Effect<string | null, unknown> =>
    context.stores.recipeStore.get(sessionId).pipe(
      Effect.map((recipe) => {
        const extraArguments = recipe?.extra_args ?? {};
        const value =
          extraArguments["docker-container"] ??
          extraArguments["docker_container"] ??
          extraArguments["container-name"] ??
          extraArguments["container_name"];
        if (typeof value !== "string") return null;
        const container = value.trim();
        return /^[a-zA-Z0-9_.-]+$/.test(container) ? container : null;
      }),
    );

  const readDockerLogLines = (container: string, limit: number): Effect.Effect<string[]> =>
    runCommandAsyncEffect("docker", ["logs", "--tail", String(limit), container], {
      timeoutMs: 30_000,
      maxOutputBytes: 10 * 1024 * 1024,
    }).pipe(
      Effect.map((result) => {
        if (result.status !== 0 || result.timedOut) return [];
        const output = `${result.stdout || ""}${result.stderr || ""}`;
        if (!output.trim()) return [];
        const lines = output.split(/\r?\n/);
        if (lines.length > 0 && lines.at(-1) === "") lines.pop();
        return lines.slice(Math.max(0, lines.length - limit));
      }),
    );

  const dockerContainerExists = (container: string): Effect.Effect<boolean> =>
    runCommandAsyncEffect("docker", ["inspect", "--type", "container", container], {
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024,
    }).pipe(Effect.map((result) => result.status === 0 && !result.timedOut));

  const streamDockerLogLines = (
    container: string,
    replayLimit: number,
    signal: AbortSignal,
  ): Stream.Stream<string, unknown> =>
    Stream.scoped(
      Stream.unwrap(
        Effect.acquireRelease(
          attempt(() => {
            const child = spawn(
              "docker",
              ["logs", "--tail", String(replayLimit), "--follow", container],
              { stdio: ["ignore", "pipe", "pipe"] },
            );
            const output = new PassThrough();
            const onError = (cause: Error): void => {
              output.destroy(cause);
            };
            const readers: Array<{
              readonly readable: NonNullable<typeof child.stdout>;
              readonly end: () => void;
            }> = [];
            let openStreams = 0;
            for (const readable of [child.stdout, child.stderr]) {
              if (!readable) continue;
              openStreams += 1;
              readable.pipe(output, { end: false });
              const end = (): void => {
                openStreams -= 1;
                if (openStreams === 0) output.end();
              };
              readable.once("end", end);
              readable.once("error", onError);
              readers.push({ readable, end });
            }
            if (openStreams === 0) output.end();
            child.once("error", onError);
            const lines = createInterface({ input: output, crlfDelay: Infinity });
            return { child, onError, lines, output, readers };
          }),
          ({ child, onError, lines, output, readers }) =>
            Effect.gen(function* () {
              lines.close();
              for (const { readable, end } of readers) {
                readable.removeListener("end", end);
                readable.removeListener("error", onError);
                readable.unpipe(output);
              }
              output.destroy();
              yield* terminateChild(child);
              child.removeListener("error", onError);
            }),
        ).pipe(Effect.map(({ lines }) => Stream.fromAsyncIterable(lines, (error) => error))),
      ),
    ).pipe(Stream.interruptWhen(abortEffect(signal)));

  return mergeRoutes(
    effectRoute(app.get, "/logs", (ctx) =>
      Effect.gen(function* () {
        yield* Effect.sync(maybeCleanup);
        const current = yield* findObservedInferenceProcess(context, "logs");
        const entries = yield* attempt(() => listLogFiles(context.config.data_dir));
        const rows = yield* Effect.forEach(entries, (entry) =>
          context.stores.recipeStore.get(entry.sessionId).pipe(
            Effect.map((recipe) => ({
              id: entry.sessionId,
              recipe_id: recipe?.id ?? entry.sessionId,
              recipe_name: recipe?.name ?? null,
              model_path: recipe?.model_path ?? null,
              model: recipe ? (recipe.served_model_name ?? recipe.name) : entry.sessionId,
              backend: recipe?.backend ?? null,
              created_at: new Date(entry.mtimeMs).toISOString(),
              status:
                current &&
                recipe &&
                isRecipeRunning(recipe, current, { allowCurrentContainsRecipePath: true })
                  ? "running"
                  : "stopped",
            })),
          ),
        );
        // The controller's own log always sorts last.
        const isController = (row: { id: string }): boolean => row.id === "controller";
        return ctx.json({
          sessions: [...rows.filter((row) => !isController(row)), ...rows.filter(isController)],
        });
      }),
    ),

    effectRoute(app.get, "/logs/:sessionId", (ctx) =>
      Effect.gen(function* () {
        const sessionId = yield* decodeSessionId(ctx.req.param("sessionId") ?? "");
        const limit =
          (yield* decodeLineCount(LogLimitSchema, ctx.req.query("limit"), "Invalid log limit")) ??
          2000;
        const body = (logs: string[]): Response =>
          ctx.json({ id: sessionId, logs, content: logs.join("\n") });
        const dockerContainer = yield* getDockerContainerForSession(sessionId);
        if (dockerContainer) {
          const dockerLines = (yield* readDockerLogLines(dockerContainer, limit)).map(
            redactLogLine,
          );
          if (dockerLines.length > 0) return body(dockerLines);
        }
        const path = resolveExistingLogPath(context.config.data_dir, sessionId);
        if (!path) return yield* Effect.fail(notFound("Log not found"));
        const lines = (yield* attempt(() => tailFileLines(path, limit)))
          .map((line) => line.replace(/\n$/, ""))
          .map(redactLogLine);
        return body(lines);
      }),
    ),

    effectRoute(app.delete, "/logs/:sessionId", (ctx) =>
      Effect.gen(function* () {
        const sessionId = yield* decodeSessionId(ctx.req.param("sessionId") ?? "");
        if (sessionId === "controller") {
          return yield* Effect.fail(badRequest("controller logs cannot be deleted via API"));
        }
        const primary = primaryLogPathFor(context.config.data_dir, sessionId);
        const fallback = fallbackLogPathFor(sessionId);
        const removals = yield* Effect.forEach([primary, fallback], (path) =>
          Effect.tryPromise({ try: () => unlink(path), catch: (error) => error }).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false)),
          ),
        );
        const deleted = removals.some(Boolean);
        if (!deleted) return yield* Effect.fail(notFound("Log not found"));
        return ctx.json({ success: true });
      }),
    ),

    effectRoute(app.get, "/events", (ctx) =>
      Effect.sync(() => {
        const signal = ctx.req.raw.signal;
        const frames = context.eventManager
          .subscribe("default", signal)
          .pipe(Stream.map((event) => event.toSse()));
        return new Response(toReadableByteStream(withSseHeartbeat(frames, 15_000, signal)), {
          headers: buildSseHeaders(),
        });
      }),
    ),

    effectRoute(app.get, "/logs/:sessionId/stream", (ctx) =>
      Effect.gen(function* () {
        const sessionId = yield* decodeSessionId(ctx.req.param("sessionId") ?? "");
        const replayLimit =
          (yield* decodeLineCount(LogTailSchema, ctx.req.query("tail"), "Invalid log tail")) ??
          2000;
        const path = resolveExistingLogPath(context.config.data_dir, sessionId);
        const configuredDockerContainer = yield* getDockerContainerForSession(sessionId);
        const dockerContainer =
          configuredDockerContainer && (yield* dockerContainerExists(configuredDockerContainer))
            ? configuredDockerContainer
            : null;
        const signal = ctx.req.raw.signal;
        const frameForLine = (line: string): string =>
          new Event(CONTROLLER_EVENTS.LOG, {
            session_id: sessionId,
            line: redactLogLine(line),
          }).toSse();
        const replay = dockerContainer
          ? streamDockerLogLines(dockerContainer, replayLimit, signal).pipe(
              Stream.map(frameForLine),
            )
          : path && replayLimit > 0
            ? Stream.fromEffect(attempt(() => tailFileLines(path, replayLimit))).pipe(
                Stream.flatMap(Stream.fromIterable),
                Stream.filter((line) => line.length > 0),
                Stream.map(frameForLine),
              )
            : Stream.empty;
        const live = dockerContainer
          ? Stream.empty
          : context.eventManager.subscribe(`logs:${sessionId}`, signal).pipe(
              Stream.map((event) => {
                if (
                  event.type === CONTROLLER_EVENTS.LOG &&
                  typeof event.data["line"] === "string"
                ) {
                  return new Event(CONTROLLER_EVENTS.LOG, {
                    ...event.data,
                    line: redactLogLine(event.data["line"]),
                  }).toSse();
                }
                return event.toSse();
              }),
            );
        const frames = replay.pipe(
          Stream.concat(live),
          Stream.catch((error) =>
            Stream.succeed(frameForLine(`Log stream failed: ${String(error)}`)),
          ),
        );
        return new Response(toReadableByteStream(withSseHeartbeat(frames, 15_000, signal)), {
          headers: buildSseHeaders({
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          }),
        });
      }),
    ),
  );
});
