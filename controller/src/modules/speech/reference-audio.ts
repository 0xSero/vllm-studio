import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveBinary, runCommandAsync } from "../../core/command";

export const MAX_VOICE_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_NORMALIZED_BYTES = 1_100_000;
const TRANSCODE_TIMEOUT_MS = 60_000;

export class VoiceReferenceError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface NormalizedVoiceReference {
  audio: Uint8Array;
  durationMs: number;
}

interface VoiceReferenceDependencies {
  ffmpegPath: () => string | null;
  transcode: (command: string, source: string, output: string) => Promise<void>;
}

const defaultDependencies: VoiceReferenceDependencies = {
  ffmpegPath: () => resolveBinary(process.env["LOCAL_STUDIO_FFMPEG_CLI"] ?? "ffmpeg"),
  transcode: async (command, source, output) => {
    const result = await runCommandAsync(
      command,
      [
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-i",
        source,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "24000",
        "-c:a",
        "pcm_s16le",
        "-t",
        "20.1",
        output,
      ],
      { timeoutMs: TRANSCODE_TIMEOUT_MS },
    );
    if (result.timedOut) {
      throw new VoiceReferenceError(504, "voice_decode_timeout", "Voice reference decode timed out");
    }
    if (result.status !== 0) {
      throw new VoiceReferenceError(400, "voice_audio_invalid", "Voice reference could not be decoded");
    }
  },
};

const ascii = (bytes: Buffer, offset: number): string => bytes.subarray(offset, offset + 4).toString("ascii");

const wavDuration = (audio: Uint8Array): number => {
  const bytes = Buffer.from(audio);
  if (bytes.length < 44 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") {
    throw new VoiceReferenceError(400, "voice_audio_invalid", "Voice reference is not valid audio");
  }
  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = ascii(bytes, offset);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) break;
    if (id === "fmt " && size >= 16) {
      const pcm = bytes.readUInt16LE(start) === 1;
      const mono = bytes.readUInt16LE(start + 2) === 1;
      const sampleRate = bytes.readUInt32LE(start + 4);
      byteRate = bytes.readUInt32LE(start + 8);
      const bits = bytes.readUInt16LE(start + 14);
      if (!pcm || !mono || sampleRate !== 24_000 || bits !== 16) byteRate = 0;
    }
    if (id === "data") dataBytes = size;
    offset = end + (size % 2);
  }
  if (!byteRate || !dataBytes) {
    throw new VoiceReferenceError(400, "voice_audio_invalid", "Voice reference is not valid audio");
  }
  return Math.round((dataBytes / byteRate) * 1000);
};

export const normalizeVoiceReference = async (
  input: Uint8Array,
  dataDirectory: string,
  dependencies: VoiceReferenceDependencies = defaultDependencies,
): Promise<NormalizedVoiceReference> => {
  if (!input.length) {
    throw new VoiceReferenceError(400, "voice_audio_invalid", "Voice reference is empty");
  }
  if (input.length > MAX_VOICE_UPLOAD_BYTES) {
    throw new VoiceReferenceError(
      413,
      "voice_audio_too_large",
      `Voice reference must be smaller than ${MAX_VOICE_UPLOAD_BYTES / 1024 / 1024} MB`,
    );
  }
  const ffmpeg = dependencies.ffmpegPath();
  if (!ffmpeg) {
    throw new VoiceReferenceError(
      503,
      "ffmpeg_missing",
      "FFmpeg is required to create a voice profile",
    );
  }
  const directory = join(dataDirectory, "runtime", "speech", "uploads");
  const source = join(directory, `${randomUUID()}.input`);
  const output = join(directory, `${randomUUID()}.wav`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(source, input, { mode: 0o600 });
    await dependencies.transcode(ffmpeg, source, output);
    const audio = await readFile(output);
    if (audio.length > MAX_NORMALIZED_BYTES) {
      throw new VoiceReferenceError(400, "voice_audio_invalid", "Voice reference is too long");
    }
    const durationMs = wavDuration(audio);
    if (durationMs < 6_000 || durationMs > 20_000) {
      throw new VoiceReferenceError(
        400,
        "voice_duration_invalid",
        "Voice reference must be 6 to 20 seconds",
      );
    }
    return { audio, durationMs };
  } finally {
    await Promise.all([unlink(source).catch(() => undefined), unlink(output).catch(() => undefined)]);
  }
};
