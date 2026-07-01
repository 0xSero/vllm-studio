import { existsSync } from "node:fs";
import { resolveBinary, runCommandAsync } from "../core/command";

export type TtsMode = "strict" | "best_effort";

export interface TtsSynthesisRequest {
  text: string;
  modelPath: string;
  outputPath: string;
  timeoutMs?: number;
}

export class TtsIntegrationError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  public constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_TIMEOUT_MS = 300_000;

const synthesizeWithPiper = async (request: TtsSynthesisRequest): Promise<void> => {
  const configuredPath = process.env["LOCAL_STUDIO_TTS_CLI"];
  const cliPath = configuredPath ? resolveBinary(configuredPath) : resolveBinary("piper");

  if (!cliPath) {
    throw new TtsIntegrationError(
      503,
      "tts_cli_missing",
      "TTS CLI is not installed. Configure LOCAL_STUDIO_TTS_CLI or install piper.",
      {
        configured_path: configuredPath ?? null,
        expected_binary: "piper",
      }
    );
  }

  const args = ["--model", request.modelPath, "--output_file", request.outputPath];
  const result = await runCommandAsync(cliPath, args, {
    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    stdin: request.text,
  });

  if (result.timedOut) {
    throw new TtsIntegrationError(504, "tts_timeout", "TTS synthesis timed out", {
      timeout_ms: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }

  if (result.status !== 0) {
    throw new TtsIntegrationError(502, "tts_cli_failed", "TTS CLI exited with an error", {
      exit_code: result.status,
      signal: result.signal,
      stderr: result.stderr,
      stdout: result.stdout,
      command: cliPath,
      args,
    });
  }

  if (!existsSync(request.outputPath)) {
    throw new TtsIntegrationError(
      502,
      "tts_output_missing",
      "TTS CLI did not produce an output file",
      {
        output_path: request.outputPath,
        stderr: result.stderr,
        stdout: result.stdout,
      }
    );
  }
};

export const synthesizeSpeech = async (request: TtsSynthesisRequest): Promise<void> => {
  const backend = (process.env["LOCAL_STUDIO_TTS_BACKEND"] ?? "piper").toLowerCase();

  if (backend === "piper") {
    await synthesizeWithPiper(request);
    return;
  }

  throw new TtsIntegrationError(400, "tts_backend_unsupported", "Unsupported TTS backend", {
    backend,
    supported_backends: ["piper"],
  });
};
