import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_VOICE_UPLOAD_BYTES,
  normalizeVoiceReference,
  VoiceReferenceError,
} from "./reference-audio";

const wave = (durationMs: number): Buffer => {
  const dataBytes = Math.round(48_000 * (durationMs / 1000));
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
};

const fixture = (): string => mkdtempSync(join(tmpdir(), "local-studio-reference-"));
const input = (): Buffer => {
  const bytes = Buffer.alloc(12);
  bytes.write("RIFF", 0);
  bytes.write("WAVE", 8);
  return bytes;
};

test("normalizes a bounded reference and removes temporary plaintext", async () => {
  const directory = fixture();
  try {
    let receivedFormat = "";
    let plaintextMode = 0;
    const result = await normalizeVoiceReference(input(), directory, {
      ffmpegPath: () => "/fake/ffmpeg",
      transcode: async (_command, _input, format, output) => {
        receivedFormat = format;
        await writeFile(output, wave(10_000), { mode: 0o666 });
        plaintextMode = statSync(output).mode & 0o777;
      },
    });

    expect(result.durationMs).toBe(10_000);
    expect(result.audio).toEqual(wave(10_000));
    expect(receivedFormat).toBe("wav");
    expect(plaintextMode).toBe(0o600);
    expect(readdirSync(join(directory, "runtime", "speech", "uploads"))).toEqual([]);
    expect(statSync(join(directory, "runtime", "speech", "uploads")).mode & 0o777).toBe(0o700);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects unavailable decoding, oversized input, and invalid duration", async () => {
  const directory = fixture();
  try {
    await expect(
      normalizeVoiceReference(input(), directory, {
        ffmpegPath: () => null,
        transcode: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "ffmpeg_missing" });
    await expect(
      normalizeVoiceReference(Buffer.alloc(MAX_VOICE_UPLOAD_BYTES + 1), directory),
    ).rejects.toBeInstanceOf(VoiceReferenceError);
    await expect(
      normalizeVoiceReference(input(), directory, {
        ffmpegPath: () => "/fake/ffmpeg",
        transcode: async (_command, _input, _format, output) => {
          await writeFile(output, wave(5_999));
        },
      }),
    ).rejects.toMatchObject({ code: "voice_duration_invalid" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects malformed normalized output and still removes it", async () => {
  const directory = fixture();
  try {
    await expect(
      normalizeVoiceReference(input(), directory, {
        ffmpegPath: () => "/fake/ffmpeg",
        transcode: async (_command, _input, _format, output) => {
          await writeFile(output, Buffer.from("not-wave"));
        },
      }),
    ).rejects.toMatchObject({ code: "voice_audio_invalid" });
    expect(readdirSync(join(directory, "runtime", "speech", "uploads"))).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects playlists and indirection before invoking FFmpeg", async () => {
  const directory = fixture();
  let invoked = false;
  try {
    await expect(
      normalizeVoiceReference(Buffer.from("#EXTM3U\nhttps://example.com/voice.wav\n"), directory, {
        ffmpegPath: () => "/fake/ffmpeg",
        transcode: async () => {
          invoked = true;
        },
      }),
    ).rejects.toMatchObject({ code: "voice_audio_invalid" });
    await expect(
      normalizeVoiceReference(
        Buffer.from("ffconcat version 1.0\nfile '/etc/passwd'\n"),
        directory,
        {
          ffmpegPath: () => "/fake/ffmpeg",
          transcode: async () => {
            invoked = true;
          },
        },
      ),
    ).rejects.toMatchObject({ code: "voice_audio_invalid" });
    expect(invoked).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
