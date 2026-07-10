import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { Effect, Semaphore } from "effect";
import { openSqliteDatabase } from "../../stores/sqlite";
import { VoiceVault } from "./voice-vault";

export const VOICE_CONSENT_VERSION = "self_voice_v1";
const VOICE_ID_PATTERN = /^voice_[a-f\d]{32}$/;

export interface VoiceProfile {
  id: string;
  name: string;
  duration_ms: number;
  created_at: string;
}

type VoiceProfileRow = VoiceProfile & {
  consent_version: string;
  consented_at: string;
};

export class VoiceProfileError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const voiceId = (): string => `voice_${randomUUID().replaceAll("-", "")}`;

const validId = (id: string): string => {
  if (!VOICE_ID_PATTERN.test(id)) throw new VoiceProfileError(404, "voice_not_found", "Voice profile not found");
  return id;
};

const validName = (name: string): string => {
  const value = name.trim();
  if (!value || value.length > 80) {
    throw new VoiceProfileError(400, "voice_name_invalid", "Voice name must be 1 to 80 characters");
  }
  return value;
};

const validDuration = (durationMs: number): number => {
  if (!Number.isInteger(durationMs) || durationMs < 6_000 || durationMs > 20_000) {
    throw new VoiceProfileError(
      400,
      "voice_duration_invalid",
      "Voice reference must be 6 to 20 seconds",
    );
  }
  return durationMs;
};

export class VoiceStore {
  private readonly db: Database;
  private readonly vault: VoiceVault;
  private readonly mutation = Semaphore.makeUnsafe(1);
  private readonly temporaryDirectory: string;

  public constructor(dbPath: string, dataDirectory: string) {
    this.db = openSqliteDatabase(dbPath);
    this.vault = new VoiceVault(join(dataDirectory, "speech", "vault"));
    this.temporaryDirectory = join(dataDirectory, "runtime", "speech", "tmp");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS speech_voice_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        consent_version TEXT NOT NULL,
        consented_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }

  public list(): VoiceProfile[] {
    return this.db
      .query<VoiceProfile, []>(
        "SELECT id, name, duration_ms, created_at FROM speech_voice_profiles ORDER BY created_at",
      )
      .all();
  }

  public get(id: string): VoiceProfile | null {
    return this.db
      .query<VoiceProfile, [string]>(
        "SELECT id, name, duration_ms, created_at FROM speech_voice_profiles WHERE id = ?",
      )
      .get(validId(id));
  }

  public create(input: {
    name: string;
    durationMs: number;
    consent: string;
    audio: Uint8Array;
  }): Promise<VoiceProfile> {
    return Effect.runPromise(
      this.mutation.withPermit(
        Effect.tryPromise({
          try: async () => {
            if (input.consent !== VOICE_CONSENT_VERSION) {
              throw new VoiceProfileError(
                400,
                "voice_consent_required",
                "Confirm that the recording is your voice before saving it",
              );
            }
            if (input.audio.length === 0) {
              throw new VoiceProfileError(400, "voice_audio_invalid", "Voice reference is empty");
            }
            const id = voiceId();
            const createdAt = new Date().toISOString();
            const profile = {
              id,
              name: validName(input.name),
              duration_ms: validDuration(input.durationMs),
              created_at: createdAt,
            } satisfies VoiceProfile;
            await this.vault.write(id, input.audio);
            try {
              this.db
                .query(
                  `INSERT INTO speech_voice_profiles
                   (id, name, duration_ms, consent_version, consented_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                )
                .run(id, profile.name, profile.duration_ms, input.consent, createdAt, createdAt);
            } catch (error) {
              await this.vault.delete(id);
              throw error;
            }
            return profile;
          },
          catch: (error) => error,
        }),
      ),
    );
  }

  public delete(id: string): Promise<boolean> {
    return Effect.runPromise(
      this.mutation.withPermit(
        Effect.tryPromise({
          try: async () => {
            const normalizedId = validId(id);
            const existing = this.get(normalizedId);
            if (!existing) return false;
            await this.vault.delete(normalizedId);
            return this.db.query("DELETE FROM speech_voice_profiles WHERE id = ?").run(normalizedId)
              .changes > 0;
          },
          catch: (error) => error,
        }),
      ),
    );
  }

  public withPlaintext<A>(id: string, use: (path: string) => Promise<A>): Promise<A> {
    const normalizedId = validId(id);
    if (!this.get(normalizedId)) {
      return Promise.reject(new VoiceProfileError(404, "voice_not_found", "Voice profile not found"));
    }
    return Effect.runPromise(
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: async () => {
            await mkdir(this.temporaryDirectory, { recursive: true, mode: 0o700 });
            const path = join(this.temporaryDirectory, `${randomUUID()}.wav`);
            await writeFile(path, await this.vault.read(normalizedId), { mode: 0o600 });
            return path;
          },
          catch: (error) => error,
        }),
        (path) => Effect.tryPromise({ try: () => use(path), catch: (error) => error }),
        (path) => Effect.promise(() => unlink(path).catch(() => undefined)),
      ),
    );
  }

  public consentRecord(id: string): Pick<VoiceProfileRow, "consent_version" | "consented_at"> | null {
    return this.db
      .query<Pick<VoiceProfileRow, "consent_version" | "consented_at">, [string]>(
        "SELECT consent_version, consented_at FROM speech_voice_profiles WHERE id = ?",
      )
      .get(validId(id));
  }
}
