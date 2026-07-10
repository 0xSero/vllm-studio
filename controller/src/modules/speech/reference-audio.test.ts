import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
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

test("normalizes a bounded reference and removes temporary plaintext", async () => {
  const directory = fixture();
  try {
    const result = await normalizeVoiceReference(Buffer.from("input"), directory, {
      ffmpegPath: () => "/fake/ffmpeg",
      transcode: async (_command, _source, output) => {
        await writeFile(output, wave(10_000));
      },
    });

    expect(result.durationMs).toBe(10_000);
    expect(result.audio).toEqual(wave(10_000));
    expect(readdirSync(join(directory, "runtime", "speech", "uploads"))).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects unavailable decoding, oversized input, and invalid duration", async () => {
  const directory = fixture();
  try {
    await expect(
      normalizeVoiceReference(Buffer.from("input"), directory, {
        ffmpegPath: () => null,
        transcode: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "ffmpeg_missing" });
    await expect(
      normalizeVoiceReference(Buffer.alloc(MAX_VOICE_UPLOAD_BYTES + 1), directory),
    ).rejects.toBeInstanceOf(VoiceReferenceError);
    await expect(
      normalizeVoiceReference(Buffer.from("input"), directory, {
        ffmpegPath: () => "/fake/ffmpeg",
        transcode: async (_command, _source, output) => {
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
      normalizeVoiceReference(Buffer.from("input"), directory, {
        ffmpegPath: () => "/fake/ffmpeg",
        transcode: async (_command, _source, output) => {
          await writeFile(output, Buffer.from("not-wave"));
        },
      }),
    ).rejects.toMatchObject({ code: "voice_audio_invalid" });
    expect(readdirSync(join(directory, "runtime", "speech", "uploads"))).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
