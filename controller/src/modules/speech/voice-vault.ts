import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;

const hasErrorCode = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const configuredKey = (): Buffer | null => {
  const value = process.env["LOCAL_STUDIO_VOICE_MASTER_KEY"]?.trim();
  if (!value) return null;
  const key = /^[a-f\d]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) throw new Error("LOCAL_STUDIO_VOICE_MASTER_KEY must encode 32 bytes");
  return key;
};

const loadOrCreateKey = async (path: string): Promise<Buffer> => {
  const configured = configuredKey();
  if (configured) return configured;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, randomBytes(KEY_BYTES), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!hasErrorCode(error) || error.code !== "EEXIST") throw error;
  }
  await chmod(path, 0o600);
  const key = await readFile(path);
  if (key.length !== KEY_BYTES) throw new Error("Voice vault key is invalid");
  return key;
};

const encryptedBytes = (plaintext: Uint8Array, key: Buffer, id: string): Buffer => {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, cipher.getAuthTag(), ciphertext]);
};

const decryptedBytes = (encrypted: Uint8Array, key: Buffer, id: string): Buffer => {
  const bytes = Buffer.from(encrypted);
  if (bytes.length <= 1 + NONCE_BYTES + TAG_BYTES || bytes[0] !== FORMAT_VERSION) {
    throw new Error("Voice profile data is invalid");
  }
  const nonceStart = 1;
  const tagStart = nonceStart + NONCE_BYTES;
  const dataStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(nonceStart, tagStart));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(bytes.subarray(tagStart, dataStart));
  return Buffer.concat([decipher.update(bytes.subarray(dataStart)), decipher.final()]);
};

const writeAtomic = async (path: string, bytes: Uint8Array): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = join(dirname(path), `.${randomBytes(12).toString("hex")}.tmp`);
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
};

export class VoiceVault {
  public constructor(private readonly directory: string) {}

  private keyPath(): string {
    return join(this.directory, "master.key");
  }

  private blobPath(id: string): string {
    return join(this.directory, "profiles", `${id}.bin`);
  }

  public async write(id: string, plaintext: Uint8Array): Promise<void> {
    const key = await loadOrCreateKey(this.keyPath());
    await writeAtomic(this.blobPath(id), encryptedBytes(plaintext, key, id));
  }

  public async read(id: string): Promise<Buffer> {
    const [key, encrypted] = await Promise.all([
      loadOrCreateKey(this.keyPath()),
      readFile(this.blobPath(id)),
    ]);
    return decryptedBytes(encrypted, key, id);
  }

  public async delete(id: string): Promise<void> {
    await unlink(this.blobPath(id)).catch((error: unknown) => {
      if (!hasErrorCode(error) || error.code !== "ENOENT") throw error;
    });
  }
}
