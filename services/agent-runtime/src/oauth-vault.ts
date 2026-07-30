import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { resolveDataDir } from "./data-dir";

type VaultResponse = {
  channel: "local-studio:oauth-vault:response";
  id: string;
  ok: boolean;
  value?: string;
  error?: string;
};

type PendingRequest = {
  resolve: (value: string | undefined) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export interface OAuthVault {
  read(key: string): Effect.Effect<string | undefined, OAuthVaultError>;
  write(key: string, value: string): Effect.Effect<void, OAuthVaultError>;
  remove(key: string): Effect.Effect<void, OAuthVaultError>;
}

export class OAuthVaultError extends Error {}

const pending = new Map<string, PendingRequest>();
let listening = false;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;
let sharedAccess = Promise.resolve();

function isVaultResponse(value: unknown): value is VaultResponse {
  if (!value || typeof value !== "object") return false;
  const channel = Reflect.get(value, "channel");
  const id = Reflect.get(value, "id");
  const ok = Reflect.get(value, "ok");
  const responseValue = Reflect.get(value, "value");
  const error = Reflect.get(value, "error");
  return (
    channel === "local-studio:oauth-vault:response" &&
    typeof id === "string" &&
    typeof ok === "boolean" &&
    (responseValue === undefined || typeof responseValue === "string") &&
    (error === undefined || typeof error === "string")
  );
}

function listen(): void {
  if (listening) return;
  listening = true;
  process.on("message", (message: unknown) => {
    if (!isVaultResponse(message)) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.ok) request.resolve(message.value);
    else request.reject(new OAuthVaultError(message.error ?? "Secure OAuth storage failed"));
  });
}

function request(
  operation: "read" | "write" | "delete",
  key: string,
  value?: string,
): Promise<string | undefined> {
  listen();
  return new Promise((resolve, reject) => {
    if (!process.send || !process.connected) {
      reject(new OAuthVaultError("Secure OAuth storage requires the desktop app"));
      return;
    }
    const id = randomUUID();
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new OAuthVaultError("Secure OAuth storage timed out"));
    }, 10_000);
    pending.set(id, { resolve, reject, timeout });
    process.send(
      {
        channel: "local-studio:oauth-vault:request",
        id,
        operation,
        key,
        ...(value === undefined ? {} : { value }),
      },
      undefined,
      undefined,
      (error: Error | null) => {
        if (!error) return;
        const active = pending.get(id);
        if (!active) return;
        pending.delete(id);
        clearTimeout(active.timeout);
        active.reject(new OAuthVaultError("Secure OAuth storage request failed"));
      },
    );
  });
}

function vaultEffect<A>(operation: () => Promise<A>): Effect.Effect<A, OAuthVaultError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) =>
      error instanceof OAuthVaultError ? error : new OAuthVaultError("Secure OAuth storage failed"),
  });
}

const electronOAuthVault: OAuthVault = {
  read: (key) => vaultEffect(() => request("read", key)),
  write: (key, value) => vaultEffect(async () => void (await request("write", key, value))),
  remove: (key) => vaultEffect(async () => void (await request("delete", key))),
};

const sharedKey = (): Buffer | null => {
  const value = process.env["LOCAL_STUDIO_SHARED_SECRET_KEY"]?.trim();
  if (!value) return null;
  const key = /^[a-f\d]{64}$/iu.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) throw new OAuthVaultError("Shared secret key must encode 32 bytes");
  return key;
};

const sharedPath = (key: string): string =>
  path.join(
    resolveDataDir(),
    "shared-secrets",
    `${createHash("sha256").update(key).digest("hex")}.bin`,
  );

const sharedOperation = <A>(operation: () => Promise<A>): Promise<A> => {
  const result = sharedAccess.then(operation);
  sharedAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const sharedOAuthVault: OAuthVault = {
  read: (id) =>
    vaultEffect(() =>
      sharedOperation(async () => {
        const key = sharedKey();
        if (!key) throw new OAuthVaultError("Shared secret storage is unavailable");
        const file = sharedPath(id);
        if (!existsSync(file)) return undefined;
        const bytes = await readFile(file);
        if (bytes.length <= 1 + NONCE_BYTES + TAG_BYTES || bytes[0] !== FORMAT_VERSION) {
          throw new OAuthVaultError("Shared secret data is invalid");
        }
        const tagStart = 1 + NONCE_BYTES;
        const dataStart = tagStart + TAG_BYTES;
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, tagStart));
        decipher.setAAD(Buffer.from(id));
        decipher.setAuthTag(bytes.subarray(tagStart, dataStart));
        return Buffer.concat([
          decipher.update(bytes.subarray(dataStart)),
          decipher.final(),
        ]).toString("utf8");
      }),
    ),
  write: (id, value) =>
    vaultEffect(() =>
      sharedOperation(async () => {
        const key = sharedKey();
        if (!key) throw new OAuthVaultError("Shared secret storage is unavailable");
        const nonce = randomBytes(NONCE_BYTES);
        const cipher = createCipheriv("aes-256-gcm", key, nonce);
        cipher.setAAD(Buffer.from(id));
        const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
        const file = sharedPath(id);
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
        try {
          await writeFile(
            temporary,
            Buffer.concat([
              Buffer.from([FORMAT_VERSION]),
              nonce,
              cipher.getAuthTag(),
              encrypted,
            ]),
            { mode: 0o600 },
          );
          await rename(temporary, file);
          await chmod(file, 0o600);
        } catch (error) {
          await unlink(temporary).catch(() => undefined);
          throw error;
        }
      }),
    ),
  remove: (id) =>
    vaultEffect(() =>
      sharedOperation(async () => {
        const key = sharedKey();
        if (!key) throw new OAuthVaultError("Shared secret storage is unavailable");
        await unlink(sharedPath(id)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }),
    ),
};

const activeOAuthVault = (): OAuthVault =>
  process.env.LOCAL_STUDIO_DESKTOP === "1" && Boolean(process.send && process.connected)
    ? electronOAuthVault
    : sharedOAuthVault;

export const desktopOAuthVault: OAuthVault = {
  read: (key) => activeOAuthVault().read(key),
  write: (key, value) => activeOAuthVault().write(key, value),
  remove: (key) => activeOAuthVault().remove(key),
};

export const desktopOAuthVaultAvailable = (): boolean =>
  (process.env.LOCAL_STUDIO_DESKTOP === "1" && Boolean(process.send && process.connected)) ||
  sharedKey() !== null;
