import { Schema } from "effect";
import type { ApiCore } from "./core";

const ErrorResponseSchema = Schema.Struct({
  code: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const MAX_TRANSCRIPTION_BYTES = 100 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 130_000;

export class SpeechApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "SpeechApiError";
  }
}

function responseError(input: unknown, status: number): Error {
  try {
    const body = Schema.decodeUnknownSync(ErrorResponseSchema)(input);
    return new SpeechApiError(
      status,
      body.code ?? null,
      body.error ?? body.detail ?? body.message ?? `Request failed (${status})`,
    );
  } catch {
    return new SpeechApiError(status, null, `Request failed (${status})`);
  }
}

async function checkedResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => null);
  throw responseError(body, response.status);
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    return await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`${label} timed out`);
    }
    throw error;
  }
}

function multipartHeaders(core: ApiCore): Record<string, string> {
  const headers = core.buildHeaders();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "content-type") delete headers[key];
  }
  return headers;
}

export function createSpeechApi(core: ApiCore) {
  return {
    transcribeAudio: async (input: { recording: File; signal?: AbortSignal }): Promise<string> => {
      if (!input.recording.size) throw new Error("Recording is empty");
      if (input.recording.size > MAX_TRANSCRIPTION_BYTES) {
        throw new Error("Recording must be 100 MB or smaller");
      }
      const form = new FormData();
      form.set("file", input.recording, input.recording.name);
      form.set("mode", "best_effort");
      const response = await checkedResponse(
        await timedFetch(
          core.buildUrl("/v1/audio/transcriptions"),
          {
            method: "POST",
            headers: multipartHeaders(core),
            body: form,
            credentials: "include",
          },
          TRANSCRIPTION_TIMEOUT_MS,
          "Audio transcription",
          input.signal,
        ),
      );
      const payload = (await response.json()) as { text?: unknown };
      if (typeof payload.text !== "string" || !payload.text.trim()) {
        throw new Error("Transcription returned no text");
      }
      return payload.text.trim();
    },
  };
}
