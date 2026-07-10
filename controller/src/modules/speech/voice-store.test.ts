import { expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoiceProfileError, VoiceStore, VOICE_CONSENT_VERSION } from "./voice-store";

const fixture = (): { directory: string; store: VoiceStore } => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-voice-"));
  return {
    directory,
    store: new VoiceStore(join(directory, "controller.db"), directory),
  };
};

test("stores only opaque metadata and encrypted voice bytes", async () => {
  const { directory, store } = fixture();
  const audio = Buffer.from("private-reference-audio");
  try {
    const profile = await store.create({
      name: "My voice",
      durationMs: 10_000,
      consent: VOICE_CONSENT_VERSION,
      audio,
    });

    expect(profile.id).toMatch(/^voice_[a-f\d]{32}$/);
    expect(store.list()).toEqual([profile]);
    expect(store.consentRecord(profile.id)?.consent_version).toBe(VOICE_CONSENT_VERSION);
    const database = readFileSync(join(directory, "controller.db"));
    const vaultDirectory = join(directory, "speech", "vault");
    const encrypted = readFileSync(join(vaultDirectory, "profiles", `${profile.id}.bin`));
    expect(database.includes(audio)).toBe(false);
    expect(encrypted.includes(audio)).toBe(false);
    expect(readFileSync(join(vaultDirectory, "master.key"))).toHaveLength(32);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("decrypts into a short-lived controller path and deletes profiles", async () => {
  const { directory, store } = fixture();
  try {
    const audio = Buffer.from("normalized-wave");
    const profile = await store.create({
      name: "Local voice",
      durationMs: 9_000,
      consent: VOICE_CONSENT_VERSION,
      audio,
    });
    let plaintextPath = "";
    const value = await store.withPlaintext(profile.id, async (path) => {
      plaintextPath = path;
      expect(readFileSync(path)).toEqual(audio);
      return "used";
    });

    expect(value).toBe("used");
    expect(readdirSync(join(directory, "runtime", "speech", "tmp"))).toEqual([]);
    expect(await store.delete(profile.id)).toBe(true);
    expect(store.get(profile.id)).toBeNull();
    expect(() => readFileSync(plaintextPath)).toThrow();
    await expect(store.withPlaintext(profile.id, async () => undefined)).rejects.toMatchObject({
      code: "voice_not_found",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects missing consent and authenticated ciphertext changes", async () => {
  const { directory, store } = fixture();
  try {
    await expect(
      store.create({ name: "No consent", durationMs: 10_000, consent: "", audio: Buffer.alloc(32) }),
    ).rejects.toBeInstanceOf(VoiceProfileError);
    await expect(
      store.create({
        name: "Too short",
        durationMs: 5_999,
        consent: VOICE_CONSENT_VERSION,
        audio: Buffer.alloc(32),
      }),
    ).rejects.toMatchObject({ code: "voice_duration_invalid" });
    const profile = await store.create({
      name: "Tamper test",
      durationMs: 10_000,
      consent: VOICE_CONSENT_VERSION,
      audio: Buffer.alloc(32, 7),
    });
    const blobPath = join(directory, "speech", "vault", "profiles", `${profile.id}.bin`);
    const blob = readFileSync(blobPath);
    blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 1;
    writeFileSync(blobPath, blob);

    await expect(store.withPlaintext(profile.id, async () => undefined)).rejects.toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
