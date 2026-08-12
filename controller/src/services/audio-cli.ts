import { existsSync } from "node:fs";
import { Effect, Schema } from "effect";
import { resolveBinary, runCommandAsyncEffect, type AsyncCommandResult } from "../core/command";

export type AudioMode = "strict" | "best_effort";

export const SttTranscriptionRequestSchema = Schema.Struct({
  audioPath: Schema.String,
  modelPath: Schema.String,
  language: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
});

export type SttTranscriptionRequest = typeof SttTranscriptionRequestSchema.Type;

export interface SttTranscriptionResult {
  text: string;
  stdout: string;
  stderr: string;
}

export const TtsSynthesisRequestSchema = Schema.Struct({
  text: Schema.String,
  modelPath: Schema.String,
  outputPath: Schema.String,
  timeoutMs: Schema.optional(Schema.Number),
});

export type TtsSynthesisRequest = typeof TtsSynthesisRequestSchema.Type;

export class AudioIntegrationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AudioIntegrationError";
  }
}

const STT_TIMEOUT_MS = 180_000;
const TTS_TIMEOUT_MS = 300_000;

const parseWhisperOutput = (stdout: string, stderr: string): string =>
  `${stdout}\n${stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, ""))
    .filter((line) => {
      const lower = line.toLowerCase();
      if (lower.startsWith("main:")) return false;
      if (lower.startsWith("whisper_")) return false;
      if (lower.startsWith("system_info:")) return false;
      if (lower.startsWith("output ")) return false;
      if (lower.includes("samples, ") && lower.includes("thread")) return false;
      if (lower.includes("processing samples")) return false;
      if (lower.includes("failed to")) return false;
      return true;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const configuredCli = (environmentKey: string, fallback: string): string | null => {
  const configured = process.env[environmentKey];
  return configured ? resolveBinary(configured) : resolveBinary(fallback);
};

const commandFailure = (
  service: "stt" | "tts",
  result: AsyncCommandResult,
  command: string,
  args: string[],
  timeoutMs: number,
): AudioIntegrationError | null => {
  if (result.timedOut) {
    return new AudioIntegrationError(
      504,
      `${service}_timeout`,
      `${service.toUpperCase()} ${service === "stt" ? "transcription" : "synthesis"} timed out`,
      { timeout_ms: timeoutMs, stderr: result.stderr, stdout: result.stdout },
    );
  }
  return result.status === 0
    ? null
    : new AudioIntegrationError(
        502,
        `${service}_cli_failed`,
        `${service.toUpperCase()} CLI exited with an error`,
        {
          exit_code: result.status,
          signal: result.signal,
          stderr: result.stderr,
          stdout: result.stdout,
          command,
          args,
        },
      );
};

const transcribeWithWhisperCpp = (
  request: SttTranscriptionRequest,
): Effect.Effect<SttTranscriptionResult, AudioIntegrationError> =>
  Effect.gen(function* () {
    const cliPath = configuredCli("LOCAL_STUDIO_STT_CLI", "whisper-cli");
    if (!cliPath) {
      return yield* Effect.fail(
        new AudioIntegrationError(
          503,
          "stt_cli_missing",
          "STT CLI is not installed. Configure LOCAL_STUDIO_STT_CLI or install whisper-cli.",
          {
            configured_path: process.env["LOCAL_STUDIO_STT_CLI"] ?? null,
            expected_binary: "whisper-cli",
          },
        ),
      );
    }
    const args = ["-m", request.modelPath, "-f", request.audioPath, "-nt"];
    if (request.language && request.language.trim().length > 0) {
      args.push("--language", request.language.trim());
    }
    const timeoutMs = request.timeoutMs ?? STT_TIMEOUT_MS;
    const result = yield* runCommandAsyncEffect(cliPath, args, { timeoutMs });
    const failure = commandFailure("stt", result, cliPath, args, timeoutMs);
    if (failure) return yield* Effect.fail(failure);
    const text = parseWhisperOutput(result.stdout, result.stderr);
    if (!text) {
      return yield* Effect.fail(
        new AudioIntegrationError(502, "stt_empty_result", "STT CLI returned empty transcript", {
          stderr: result.stderr,
          stdout: result.stdout,
        }),
      );
    }
    return { text, stdout: result.stdout, stderr: result.stderr };
  });

export const transcribeAudio = (
  input: SttTranscriptionRequest,
): Effect.Effect<SttTranscriptionResult, AudioIntegrationError> =>
  Schema.decodeUnknownEffect(SttTranscriptionRequestSchema)(input).pipe(
    Effect.mapError(
      (source) =>
        new AudioIntegrationError(400, "stt_request_invalid", "Invalid STT request", { source }),
    ),
    Effect.flatMap((request) => {
      const backend = (process.env["LOCAL_STUDIO_STT_BACKEND"] ?? "whispercpp").toLowerCase();
      if (backend === "whispercpp" || backend === "whisper.cpp") {
        return transcribeWithWhisperCpp(request);
      }
      return Effect.fail(
        new AudioIntegrationError(400, "stt_backend_unsupported", "Unsupported STT backend", {
          backend,
          supported_backends: ["whispercpp"],
        }),
      );
    }),
  );

const synthesizeWithPiper = (
  request: TtsSynthesisRequest,
): Effect.Effect<void, AudioIntegrationError> =>
  Effect.gen(function* () {
    const cliPath = configuredCli("LOCAL_STUDIO_TTS_CLI", "piper");
    if (!cliPath) {
      return yield* Effect.fail(
        new AudioIntegrationError(
          503,
          "tts_cli_missing",
          "TTS CLI is not installed. Configure LOCAL_STUDIO_TTS_CLI or install piper.",
          {
            configured_path: process.env["LOCAL_STUDIO_TTS_CLI"] ?? null,
            expected_binary: "piper",
          },
        ),
      );
    }
    const args = ["--model", request.modelPath, "--output_file", request.outputPath];
    const timeoutMs = request.timeoutMs ?? TTS_TIMEOUT_MS;
    const result = yield* runCommandAsyncEffect(cliPath, args, {
      timeoutMs,
      stdin: request.text,
    });
    const failure = commandFailure("tts", result, cliPath, args, timeoutMs);
    if (failure) return yield* Effect.fail(failure);
    if (!existsSync(request.outputPath)) {
      return yield* Effect.fail(
        new AudioIntegrationError(
          502,
          "tts_output_missing",
          "TTS CLI did not produce an output file",
          {
            output_path: request.outputPath,
            stderr: result.stderr,
            stdout: result.stdout,
          },
        ),
      );
    }
  });

export const synthesizeSpeech = (
  input: TtsSynthesisRequest,
): Effect.Effect<void, AudioIntegrationError> =>
  Schema.decodeUnknownEffect(TtsSynthesisRequestSchema)(input).pipe(
    Effect.mapError(
      (source) =>
        new AudioIntegrationError(400, "tts_request_invalid", "Invalid TTS request", { source }),
    ),
    Effect.flatMap((request) => {
      const backend = (process.env["LOCAL_STUDIO_TTS_BACKEND"] ?? "piper").toLowerCase();
      return backend === "piper"
        ? synthesizeWithPiper(request)
        : Effect.fail(
            new AudioIntegrationError(400, "tts_backend_unsupported", "Unsupported TTS backend", {
              backend,
              supported_backends: ["piper"],
            }),
          );
    }),
  );
