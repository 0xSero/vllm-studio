import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

type Engine = {
  readonly id: string;
  readonly bin: string;
  readonly ready?: () => boolean;
  readonly args: (wavPath: string) => readonly string[];
  readonly parse: (stdout: string, wavPath: string) => Promise<string> | string;
};

const PARAKEET_MODEL_ENV = "LOCAL_STUDIO_PARAKEET_MODEL";
const WHISPER_MODEL_ENV = "LOCAL_STUDIO_WHISPER_MODEL";
const MLX_WHISPER_MODEL = process.env.LOCAL_STUDIO_MLX_WHISPER_MODEL?.trim() ||
  "mlx-community/whisper-large-v3-turbo";

function stripTimestamps(stdout: string): string {
  return stdout
    .split("\n")
    .map((line) => {
      const match = /^\s*\[[0-9:.\s]+-->[0-9:.\s]+\]\s*(.*)$/.exec(line);
      return match ? (match[1] ?? "") : "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function envModel(variable: string): string | null {
  const value = process.env[variable]?.trim();
  return value && existsSync(value) ? value : null;
}

const ENGINES: readonly Engine[] = [
  {
    id: "parakeet-cli",
    bin: "parakeet-cli",
    ready: () => envModel(PARAKEET_MODEL_ENV) !== null,
    args: (wav) => ["-m", envModel(PARAKEET_MODEL_ENV) ?? "", "-f", wav],
    parse: stripTimestamps,
  },
  {
    id: "whisper-cli",
    bin: "whisper-cli",
    ready: () => envModel(WHISPER_MODEL_ENV) !== null,
    args: (wav) => ["-m", envModel(WHISPER_MODEL_ENV) ?? "", "-f", wav, "-nt"],
    parse: stripTimestamps,
  },
  {
    id: "mlx-whisper",
    bin: "mlx_whisper",
    args: (wav) => [
      wav,
      "--model",
      MLX_WHISPER_MODEL,
      "--output-format",
      "txt",
      "--output-dir",
      path.dirname(wav),
      "--verbose",
      "False",
    ],
    parse: async (_stdout, wav) => {
      const produced = path.join(path.dirname(wav), `${path.parse(wav).name}.txt`);
      return (await readFile(produced, "utf8")).trim();
    },
  },
];

async function binaryOnPath(bin: string): Promise<boolean> {
  try {
    await run("command", ["-v", bin], { shell: "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}

export class LocalTranscriptionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LocalTranscriptionError";
  }
}

async function toWav(input: string, output: string): Promise<void> {
  try {
    await run("ffmpeg", ["-nostdin", "-y", "-i", input, "-ar", "16000", "-ac", "1", output], {
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    throw new LocalTranscriptionError(
      500,
      `ffmpeg could not decode the recording: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export async function transcribeLocally(recording: {
  bytes: Uint8Array;
  filename: string;
}): Promise<{ text: string; engine: string }> {
  if (recording.bytes.byteLength === 0) {
    throw new LocalTranscriptionError(400, "Recording is empty");
  }
  const engine = await pickEngine();
  const directory = await mkdtemp(path.join(tmpdir(), "local-studio-stt-"));
  try {
    const source = path.join(directory, sanitizedName(recording.filename));
    await writeFile(source, recording.bytes);
    const wav = path.join(directory, "audio.wav");
    await toWav(source, wav);

    let stdout: string;
    try {
      ({ stdout } = await run(engine.bin, [...engine.args(wav)], {
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120_000,
      }));
    } catch (error) {
      throw new LocalTranscriptionError(
        500,
        `${engine.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { text: (await engine.parse(stdout, wav)).trim(), engine: engine.id };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

async function pickEngine(): Promise<Engine> {
  for (const engine of ENGINES) {
    if (engine.ready && !engine.ready()) continue;
    if (await binaryOnPath(engine.bin)) return engine;
  }
  throw new LocalTranscriptionError(
    501,
    `No speech-to-text engine found. Install one of: ${ENGINES.map((engine) => engine.bin).join(", ")}.`,
  );
}

function sanitizedName(filename: string): string {
  const extension = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return `recording${extension || ".webm"}`;
}
