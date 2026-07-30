import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";

const KEY_BYTES = 32;
const KEY_ID_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const LEGACY_FORMAT_VERSION = 1;
const FORMAT_VERSION = 2;
const SECRET_REF_PATTERN =
  /^provider:[a-z0-9][a-z0-9_-]{0,63}:(api-key|client-secret|subscription-key)(?::[a-f\d]{32})?$/u;

export class ProviderSecretError extends Schema.TaggedErrorClass<ProviderSecretError>()(
  "ProviderSecretError",
  {
    operation: Schema.Literals(["configure", "read", "write", "delete"]),
    message: Schema.String,
    source: Schema.optional(Schema.Unknown),
  },
) {}

const secretError = (
  operation: ProviderSecretError["operation"],
  message: string,
  source?: unknown,
): ProviderSecretError =>
  new ProviderSecretError({
    operation,
    message,
    ...(source === undefined ? {} : { source }),
  });

const decodeKey = (value: string): Buffer => {
  const key = /^[a-f\d]{64}$/iu.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) throw new Error("Provider master key must encode 32 bytes");
  return key;
};

type ProviderMasterKey = {
  id: string;
  fingerprint: Buffer;
  value: Buffer;
};

const masterKey = (id: string, value: string | Buffer): ProviderMasterKey => {
  if (!/^[a-zA-Z0-9._-]{1,64}$/u.test(id)) {
    throw new Error("Provider master key id is invalid");
  }
  const key = typeof value === "string" ? decodeKey(value) : value;
  if (key.length !== KEY_BYTES) throw new Error("Provider master key must encode 32 bytes");
  return {
    id,
    fingerprint: createHash("sha256").update(id).digest().subarray(0, KEY_ID_BYTES),
    value: key,
  };
};

const previousMasterKeys = (): ProviderMasterKey[] => {
  const configured = process.env["LOCAL_STUDIO_PROVIDER_PREVIOUS_MASTER_KEYS"]?.trim();
  if (!configured) return [];
  const decoded: unknown = JSON.parse(configured);
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Previous provider master keys must be a JSON object");
  }
  return Object.entries(decoded).map(([id, value]) => {
    if (typeof value !== "string") throw new Error("Previous provider master key is invalid");
    return masterKey(id, value);
  });
};

const authenticatedData = (reference: string, fingerprint: Buffer): Buffer =>
  Buffer.concat([Buffer.from(reference), Buffer.from([0]), fingerprint]);

const assertSafeFile = (path: string): void => {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error("Provider secret file is unsafe");
  }
};

const atomicWrite = (path: string, value: Uint8Array): void => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(temporary, value, { mode: 0o600 });
    const temporaryHandle = openSync(temporary, "r");
    try {
      fsyncSync(temporaryHandle);
    } finally {
      closeSync(temporaryHandle);
    }
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    syncDirectory(dirname(path));
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
};

const syncDirectory = (path: string): void => {
  try {
    const handle = openSync(path, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  } catch (source) {
    const code = (source as NodeJS.ErrnoException).code;
    if (
      process.platform === "win32" &&
      ["EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(code ?? "")
    ) {
      return;
    }
    throw source;
  }
};

export const providerApiKeyReference = (providerId: string): string =>
  `provider:${providerId}:api-key`;

export const newProviderApiKeyReference = (providerId: string): string =>
  `${providerApiKeyReference(providerId)}:${randomUUID().replaceAll("-", "")}`;

export const newProviderClientSecretReference = (providerId: string): string =>
  `provider:${providerId}:client-secret:${randomUUID().replaceAll("-", "")}`;

export const providerSubscriptionKeyReference = (providerId: string): string =>
  `provider:${providerId}:subscription-key`;

export const newProviderSubscriptionKeyReference = (providerId: string): string =>
  `${providerSubscriptionKeyReference(providerId)}:${randomUUID().replaceAll("-", "")}`;

export const providerSecretReferenceMatches = (
  providerId: string,
  reference: string | undefined,
  kind: "api-key" | "client-secret" | "subscription-key",
): reference is string =>
  Boolean(
    reference &&
      new RegExp(
        `^provider:${providerId.replaceAll(/[$()*+.?[\\\]^{|}]/gu, "\\$&")}:${kind}(?::[a-f\\d]{32})?$`,
        "u",
      ).test(reference),
  );

export type ProviderSecretMutation = {
  ref: string;
  value: string | undefined;
};

export class ProviderSecretStore {
  readonly #directory: string;
  readonly #activeKey: ProviderMasterKey;
  readonly #keys: ReadonlyMap<string, ProviderMasterKey>;

  constructor(dataDirectory: string, requireExternalKey: boolean) {
    this.#directory = join(dataDirectory, "provider-secrets");
    const configured = process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"]?.trim();
    try {
      let activeKey: ProviderMasterKey;
      if (configured) {
        activeKey = masterKey(
          process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY_ID"]?.trim() || "active",
          configured,
        );
      } else {
        if (requireExternalKey) {
          throw new Error(
            "LOCAL_STUDIO_PROVIDER_MASTER_KEY is required for a shared or non-loopback controller",
          );
        }
        const keyPath = join(this.#directory, "local-master.key");
        mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
        if (!existsSync(keyPath)) {
          writeFileSync(keyPath, randomBytes(KEY_BYTES), { flag: "wx", mode: 0o600 });
        }
        assertSafeFile(keyPath);
        chmodSync(keyPath, 0o600);
        activeKey = masterKey("local", readFileSync(keyPath));
      }
      const keys = new Map<string, ProviderMasterKey>();
      for (const candidate of [activeKey, ...previousMasterKeys()]) {
        const fingerprint = candidate.fingerprint.toString("hex");
        if (keys.has(fingerprint)) throw new Error("Provider master key ids must be unique");
        keys.set(fingerprint, candidate);
      }
      this.#activeKey = activeKey;
      this.#keys = keys;
    } catch (source) {
      throw secretError("configure", "Provider secret storage is unavailable", source);
    }
  }

  #path(reference: string): string {
    if (!SECRET_REF_PATTERN.test(reference)) {
      throw secretError("configure", "Provider secret reference is invalid");
    }
    return join(this.#directory, `${createHash("sha256").update(reference).digest("hex")}.bin`);
  }

  writeSync(reference: string, value: string): void {
    try {
      if (!value || value.length > 32_768) throw new Error("Provider credential is invalid");
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", this.#activeKey.value, nonce);
      cipher.setAAD(authenticatedData(reference, this.#activeKey.fingerprint));
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      atomicWrite(
        this.#path(reference),
        Buffer.concat([
          Buffer.from([FORMAT_VERSION]),
          this.#activeKey.fingerprint,
          nonce,
          cipher.getAuthTag(),
          encrypted,
        ]),
      );
    } catch (source) {
      if (source instanceof ProviderSecretError) throw source;
      throw secretError("write", "Provider credential could not be stored", source);
    }
  }

  readSync(reference: string): string | undefined {
    try {
      const path = this.#path(reference);
      if (!existsSync(path)) return undefined;
      assertSafeFile(path);
      const bytes = readFileSync(path);
      const version = bytes[0];
      if (
        bytes.length <= 1 + NONCE_BYTES + TAG_BYTES ||
        (version !== LEGACY_FORMAT_VERSION && version !== FORMAT_VERSION)
      ) {
        throw new Error("Provider credential data is invalid");
      }
      const fingerprint =
        version === FORMAT_VERSION ? bytes.subarray(1, 1 + KEY_ID_BYTES) : undefined;
      const candidates = fingerprint
        ? [this.#keys.get(fingerprint.toString("hex"))].filter(
            (candidate): candidate is ProviderMasterKey => Boolean(candidate),
          )
        : [...this.#keys.values()];
      if (candidates.length === 0) throw new Error("Provider credential key is unavailable");
      const nonceStart = version === FORMAT_VERSION ? 1 + KEY_ID_BYTES : 1;
      const tagStart = nonceStart + NONCE_BYTES;
      const dataStart = tagStart + TAG_BYTES;
      let source: unknown;
      for (const candidate of candidates) {
        try {
          const decipher = createDecipheriv(
            "aes-256-gcm",
            candidate.value,
            bytes.subarray(nonceStart, tagStart),
          );
          decipher.setAAD(
            version === FORMAT_VERSION
              ? authenticatedData(reference, candidate.fingerprint)
              : Buffer.from(reference),
          );
          decipher.setAuthTag(bytes.subarray(tagStart, dataStart));
          const value = Buffer.concat([
            decipher.update(bytes.subarray(dataStart)),
            decipher.final(),
          ]).toString("utf8");
          if (
            version !== FORMAT_VERSION ||
            !candidate.fingerprint.equals(this.#activeKey.fingerprint)
          ) {
            this.writeSync(reference, value);
          }
          return value;
        } catch (cause) {
          source = cause;
        }
      }
      throw source ?? new Error("Provider credential could not be decrypted");
    } catch (source) {
      if (source instanceof ProviderSecretError) throw source;
      throw secretError("read", "Provider credential could not be read", source);
    }
  }

  removeSync(reference: string): void {
    try {
      const path = this.#path(reference);
      if (existsSync(path)) unlinkSync(path);
    } catch (source) {
      if (source instanceof ProviderSecretError) throw source;
      throw secretError("delete", "Provider credential could not be removed", source);
    }
  }

  mutateSync<T>(mutations: readonly ProviderSecretMutation[], persist: () => T): T {
    const normalized = new Map<string, string | undefined>();
    for (const mutation of mutations) normalized.set(mutation.ref, mutation.value);
    const snapshots = new Map<string, string | undefined>();
    for (const reference of normalized.keys()) {
      snapshots.set(reference, this.readSync(reference));
    }
    try {
      for (const [reference, value] of normalized) {
        if (value === undefined) this.removeSync(reference);
        else this.writeSync(reference, value);
      }
      return persist();
    } catch (source) {
      try {
        for (const [reference, value] of snapshots) {
          if (value === undefined) this.removeSync(reference);
          else this.writeSync(reference, value);
        }
      } catch (rollbackSource) {
        throw secretError("write", "Provider secret rollback failed", rollbackSource);
      }
      if (source instanceof ProviderSecretError) throw source;
      throw secretError("write", "Provider secret transaction failed", source);
    }
  }

  reconcileSync(activeReferences: ReadonlySet<string>): void {
    try {
      if (!existsSync(this.#directory)) return;
      const activeFiles = new Set(
        [...activeReferences].map(
          (reference) => `${createHash("sha256").update(reference).digest("hex")}.bin`,
        ),
      );
      for (const entry of readdirSync(this.#directory, { withFileTypes: true })) {
        if (
          entry.isFile() &&
          /^[a-f\d]{64}\.bin$/u.test(entry.name) &&
          !activeFiles.has(entry.name)
        ) {
          unlinkSync(join(this.#directory, entry.name));
        }
      }
    } catch (source) {
      throw secretError("delete", "Provider secret reconciliation failed", source);
    }
  }

  read(reference: string): Effect.Effect<string | undefined, ProviderSecretError> {
    return Effect.try({
      try: () => this.readSync(reference),
      catch: (source) =>
        source instanceof ProviderSecretError
          ? source
          : secretError("read", "Provider credential could not be read", source),
    });
  }
}
