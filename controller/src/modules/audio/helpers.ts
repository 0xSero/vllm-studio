import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, Schema } from "effect";
import type { AppContext } from "../../app-context";
import { resolveBinary, runCommandAsyncEffect } from "../../core/command";
import { SttIntegrationError } from "../../services/stt";
import type { SttMode } from "../../services/stt";
const AUDIO_DEFAULT_MODE = "strict";
const AUDIO_TRANSCODE_TIMEOUT_MS = 60_000;

export const parseField = (value: FormDataEntryValue | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const parseMode = (value: FormDataEntryValue | null): SttMode => {
  const modeValue = (parseField(value) ?? AUDIO_DEFAULT_MODE).toLowerCase();
  if (modeValue === "strict" || modeValue === "best_effort") {
    return modeValue;
  }
  throw new SttIntegrationError(400, "invalid_mode", "mode must be strict or best_effort");
};

export const looksLikeWav = (bytes: Uint8Array): boolean => {
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const wave = String.fromCharCode(...bytes.slice(8, 12));
  return riff === "RIFF" && wave === "WAVE";
};

const STT_MODEL_ENV_VARIABLE = "LOCAL_STUDIO_STT_MODEL";

export const resolveSttModelPath = (
  context: AppContext,
  modelField: FormDataEntryValue | null,
): { requestedModel: string; modelPath: string } => {
  const requestedModel = parseField(modelField) || process.env[STT_MODEL_ENV_VARIABLE]?.trim();
  if (!requestedModel) {
    throw new SttIntegrationError(
      400,
      "model_missing",
      `No STT model provided. Set model field or ${STT_MODEL_ENV_VARIABLE}.`,
    );
  }

  const modelPath = requestedModel.includes("/")
    ? resolve(requestedModel)
    : resolve(context.config.models_dir, "stt", requestedModel);

  if (!existsSync(modelPath)) {
    throw new SttIntegrationError(400, "model_not_found", "STT model path does not exist", {
      requested_model: requestedModel,
      resolved_model_path: modelPath,
    });
  }

  return { requestedModel, modelPath };
};

export const ensureServiceLease = (
  context: AppContext,
  mode: SttMode,
): Effect.Effect<Record<string, unknown> | null, AudioDependencyError> =>
  context.bridge.findInferenceProcess().pipe(
    Effect.mapError(
      (source) =>
        new AudioDependencyError({
          operation: "lease",
          message: `Could not inspect inference lease: ${String(source)}`,
          source,
        }),
    ),
    Effect.map((holder) => {
      if (!holder || mode === "best_effort") return null;
      return {
        code: "gpu_lease_conflict",
        requested_service: { id: "stt" },
        holder_service: { id: "llm" },
        actions: ["best_effort"],
      };
    }),
  );

export class AudioDependencyError extends Schema.TaggedErrorClass<AudioDependencyError>()(
  "AudioDependencyError",
  {
    operation: Schema.Literals(["lease"]),
    message: Schema.String,
    source: Schema.Unknown,
  },
) {}

export const defaultTranscodeToWav = (options: {
  sourcePath: string;
  outputPath: string;
}): Effect.Effect<string, SttIntegrationError> =>
  Effect.gen(function* () {
    const ffmpegPath = resolveBinary(process.env["LOCAL_STUDIO_FFMPEG_CLI"] ?? "ffmpeg");
    if (!ffmpegPath) {
      return yield* Effect.fail(
        new SttIntegrationError(
          503,
          "ffmpeg_missing",
          "ffmpeg is required for non-WAV uploads. Install ffmpeg or upload WAV input.",
        ),
      );
    }

    const result = yield* runCommandAsyncEffect(
      ffmpegPath,
      ["-y", "-i", options.sourcePath, "-ac", "1", "-ar", "16000", "-f", "wav", options.outputPath],
      { timeoutMs: AUDIO_TRANSCODE_TIMEOUT_MS },
    );

    if (result.timedOut) {
      return yield* Effect.fail(
        new SttIntegrationError(504, "audio_transcode_timeout", "Audio transcode timed out", {
          stderr: result.stderr,
          stdout: result.stdout,
        }),
      );
    }

    if (result.status !== 0) {
      return yield* Effect.fail(
        new SttIntegrationError(400, "audio_transcode_failed", "Failed to transcode audio to WAV", {
          exit_code: result.status,
          signal: result.signal,
          stderr: result.stderr,
          stdout: result.stdout,
        }),
      );
    }

    return options.outputPath;
  });
