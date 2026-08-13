import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import type { Scope } from "effect";
import type { AppContext } from "../../app-context";
import { boundedFormData, RequestBodyTooLargeError } from "../../http/bounded-body";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, mergeRoutes, type ControllerRouteApp } from "../../http/route-registrar";
import { SttIntegrationError, transcribeAudio } from "../../services/stt";
import type { AudioRouteDependencies } from "./interfaces";
import {
  defaultTranscodeToWav,
  ensureServiceLease,
  looksLikeWav,
  parseField,
  parseMode,
  resolveSttModelPath,
} from "./helpers";

const AUDIO_TEMP_PATH_SEGMENTS = ["tmp", "audio"];
const MAX_STT_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_STT_REQUEST_BYTES = MAX_STT_UPLOAD_BYTES + 1024 * 1024;

class AudioFileError extends Schema.TaggedErrorClass<AudioFileError>()("AudioFileError", {
  operation: Schema.Literals(["mkdir", "read", "write"]),
  message: Schema.String,
  source: Schema.optional(Schema.Unknown),
}) {}

const temporaryPath = (path: string): Effect.Effect<string, never, Scope.Scope> =>
  Effect.acquireRelease(Effect.succeed(path), (target) =>
    Effect.tryPromise({ try: () => unlink(target), catch: () => null }).pipe(Effect.ignore),
  );

const audioErrorResponse = (context: AppContext, error: unknown): Response => {
  if (error instanceof RequestBodyTooLargeError) {
    return Response.json(
      {
        code: "file_too_large",
        error: `Audio upload exceeds the ${Math.round(MAX_STT_UPLOAD_BYTES / (1024 * 1024))} MB limit`,
      },
      { status: 413 },
    );
  }
  if (error instanceof SttIntegrationError) {
    return Response.json(
      { code: error.code, error: error.message, ...error.details },
      { status: error.status },
    );
  }
  context.logger.error("audio stt route failed", { error: String(error) });
  return Response.json(
    {
      code: "stt_internal_error",
      error: "Internal STT error",
      details: String(error),
    },
    { status: 500 },
  );
};

export const registerAudioRoutes = (
  app: ControllerRouteApp,
  context: AppContext,
  dependencies: AudioRouteDependencies = {},
): ControllerRouteApp => {
  const transcribe = dependencies.transcribe ?? transcribeAudio;
  const transcodeToWav = dependencies.transcodeToWav ?? defaultTranscodeToWav;

  return mergeRoutes(
    app.post(
      "/v1/audio/transcriptions",
      documentRoute,
      effectHandler((ctx) =>
        Effect.scoped(
          Effect.gen(function* () {
            const formData = yield* boundedFormData(ctx.req.raw, MAX_STT_REQUEST_BYTES).pipe(
              Effect.mapError((error) =>
                error instanceof RequestBodyTooLargeError
                  ? error
                  : new SttIntegrationError(
                      400,
                      "invalid_multipart",
                      "Request body must be multipart/form-data",
                    ),
              ),
            );
            const file = formData.get("file");
            if (!(file instanceof File)) {
              return yield* Effect.fail(
                new SttIntegrationError(400, "file_missing", "Multipart field 'file' is required"),
              );
            }
            if (file.size > MAX_STT_UPLOAD_BYTES) {
              return yield* Effect.fail(
                new SttIntegrationError(
                  413,
                  "file_too_large",
                  `Audio upload exceeds the ${Math.round(MAX_STT_UPLOAD_BYTES / (1024 * 1024))} MB limit`,
                ),
              );
            }
            const mode = yield* Effect.try({
              try: () => parseMode(formData.get("mode")),
              catch: (error) => error,
            });
            const language = parseField(formData.get("language"));
            const { modelPath } = yield* Effect.try({
              try: () => resolveSttModelPath(context, formData.get("model")),
              catch: (error) => error,
            });
            const conflict = yield* ensureServiceLease(context, mode);
            if (conflict) return ctx.json(conflict, { status: 409 });
            const directory = join(context.config.data_dir, ...AUDIO_TEMP_PATH_SEGMENTS);
            yield* Effect.tryPromise({
              try: () => mkdir(directory, { recursive: true }),
              catch: (source) =>
                new AudioFileError({
                  operation: "mkdir",
                  message: "Could not prepare audio storage",
                  source,
                }),
            });
            const uploadBuffer = yield* Effect.tryPromise({
              try: () => file.arrayBuffer(),
              catch: (source) =>
                new AudioFileError({ operation: "read", message: "Could not read upload", source }),
            }).pipe(Effect.map((bytes) => new Uint8Array(bytes)));
            const uploadPath = yield* temporaryPath(
              join(directory, `${randomUUID()}${extname(file.name || "") || ".bin"}`),
            );
            yield* Effect.tryPromise({
              try: () => writeFile(uploadPath, uploadBuffer),
              catch: (source) =>
                new AudioFileError({
                  operation: "write",
                  message: "Could not save upload",
                  source,
                }),
            });
            const audioPath = looksLikeWav(uploadBuffer)
              ? uploadPath
              : yield* Effect.gen(function* () {
                  const wavPath = yield* temporaryPath(join(directory, `${randomUUID()}.wav`));
                  return yield* transcodeToWav({ sourcePath: uploadPath, outputPath: wavPath });
                });
            const transcription = yield* transcribe({
              audioPath,
              modelPath,
              ...(language ? { language } : {}),
            });
            if (!transcription.text.trim()) {
              return yield* Effect.fail(
                new SttIntegrationError(
                  502,
                  "stt_empty_result",
                  "STT completed but returned an empty transcript",
                ),
              );
            }
            return ctx.json({ text: transcription.text });
          }),
        ).pipe(Effect.catch((error) => Effect.succeed(audioErrorResponse(context, error)))),
      ),
    ),
  );
};
