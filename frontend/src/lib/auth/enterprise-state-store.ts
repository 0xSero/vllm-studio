import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import lockfile from "proper-lockfile";
import {
  acquireRedisStateLease,
  assertRedisStateStoreConfiguration,
  transactRedisState,
} from "@/lib/auth/enterprise-state-redis";

type StateKind =
  | "flow"
  | "logout"
  | "logout_replay"
  | "msal"
  | "session"
  | "session_alias"
  | "session_sid"
  | "session_subject";

type StateRecord = {
  payload: string;
  expires_at: number;
  envelope?: 2 | 3;
  key_id?: string;
};

type StateDocument = {
  version: 1;
  records: Record<string, StateRecord>;
};

type StateOperation<Value> = {
  value: Value;
  write: boolean;
};

export type EnterpriseStateTransaction = {
  delete: <Value>(kind: StateKind, id: string) => Value | null;
  entries: <Value>(kind: StateKind) => Array<[string, Value]>;
  get: <Value>(kind: StateKind, id: string) => Value | null;
  put: (kind: StateKind, id: string, value: unknown, expiresAt: number) => void;
};

type EnterpriseSessionKey = {
  id: string;
  secret: Buffer;
};

const sessionKeyring = (): EnterpriseSessionKey[] => {
  const serialized = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS?.trim();
  const fallback = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY?.trim();
  if (serialized && fallback) {
    throw new Error("Configure either the enterprise session keyring or the compatibility key");
  }
  let entries: unknown;
  if (serialized) {
    try {
      entries = JSON.parse(serialized) as unknown;
    } catch {
      throw new Error("LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS must be valid JSON");
    }
  } else if (fallback) {
    entries = [{ id: "default", key: fallback }];
  } else {
    throw new Error("An enterprise session encryption key is required for OIDC sessions");
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 8) {
    throw new Error("Enterprise session keyring must contain between one and eight keys");
  }
  const keys = entries.map((entry): EnterpriseSessionKey => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Enterprise session keyring entry is invalid");
    }
    const id = (entry as { id?: unknown }).id;
    const key = (entry as { key?: unknown }).key;
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(id) ||
      typeof key !== "string"
    ) {
      throw new Error("Enterprise session keyring entry is invalid");
    }
    const secret = Buffer.from(key, "utf8");
    if (secret.byteLength < 32) {
      throw new Error("Enterprise session encryption keys must contain at least 32 bytes");
    }
    return { id, secret };
  });
  if (new Set(keys.map(({ id }) => id)).size !== keys.length) {
    throw new Error("Enterprise session key identifiers must be unique");
  }
  if (new Set(keys.map(({ secret }) => secret.toString("base64"))).size !== keys.length) {
    throw new Error("Enterprise session encryption keys must be unique");
  }
  return keys;
};

export const assertEnterpriseStateEncryptionKey = (): void => {
  sessionKeyring();
};

type EnterpriseStateStoreKind = "posix" | "redis";

const stateStoreKind = (): EnterpriseStateStoreKind => {
  const configured = process.env.LOCAL_STUDIO_ENTERPRISE_STATE_STORE?.trim() || "posix";
  if (configured !== "posix" && configured !== "redis") {
    throw new Error("Enterprise state store must be posix or redis");
  }
  return configured;
};

export const assertEnterpriseStateStoreConfiguration = (): void => {
  if (stateStoreKind() === "redis") {
    assertRedisStateStoreConfiguration();
  }
};

const legacyEncryptionKey = (secret: Buffer): Buffer =>
  createHash("sha256").update(secret).digest();

const encryptionKey = (secret: Buffer): Buffer =>
  Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      Buffer.alloc(0),
      Buffer.from("local-studio.enterprise-state/v2", "utf8"),
      32,
    ),
  );

const createPrivateFile = (path: string, contents = ""): void => {
  try {
    writeFileSync(path, contents, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error("Enterprise state path is not a regular file");
  }
  chmodSync(path, 0o600);
};

const statePath = (): string => {
  const dataDir = resolve(
    process.env.LOCAL_STUDIO_DATA_DIR?.trim() || resolve(process.cwd(), "data"),
  );
  const path = resolve(dataDir, "enterprise-sessions.json");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  createPrivateFile(path, '{"version":1,"records":{}}\n');
  return path;
};

const leasePath = (scope: string): string => {
  const path = statePath();
  const digest = createHash("sha256").update(scope, "utf8").digest("hex");
  const lease = resolve(dirname(path), `.enterprise-state-${digest}.lease`);
  createPrivateFile(lease);
  return lease;
};

const binding = (key: string, expiresAt: number, keyId?: string): Buffer =>
  Buffer.from(`${key}\u0000${expiresAt}${keyId ? `\u0000${keyId}` : ""}`, "utf8");

const encrypt = (value: unknown, key: string, expiresAt: number): StateRecord => {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt > 8_640_000_000_000_000) {
    throw new Error("Enterprise state expiry is invalid");
  }
  const primary = sessionKeyring()[0]!;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(primary.secret), nonce);
  cipher.setAAD(binding(key, expiresAt, primary.id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    payload: [nonce, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString("base64url"))
      .join("."),
    expires_at: expiresAt,
    envelope: 3,
    key_id: primary.id,
  };
};

const decrypt = <Value>(record: StateRecord, key: string): Value => {
  const parts = record.payload.split(".");
  if (parts.length !== 3) throw new Error("Enterprise state record is malformed");
  const keyring = sessionKeyring();
  const candidates =
    record.envelope === 3 ? keyring.filter(({ id }) => id === record.key_id) : keyring;
  if (candidates.length === 0) throw new Error("Enterprise state record key is unavailable");
  for (const candidate of candidates) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        record.envelope === undefined
          ? legacyEncryptionKey(candidate.secret)
          : encryptionKey(candidate.secret),
        Buffer.from(parts[0]!, "base64url"),
      );
      if (record.envelope !== undefined) {
        decipher.setAAD(
          binding(key, record.expires_at, record.envelope === 3 ? candidate.id : undefined),
        );
      }
      decipher.setAuthTag(Buffer.from(parts[1]!, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(parts[2]!, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ) as Value;
    } catch {}
  }
  throw new Error("Enterprise state record could not be decrypted");
};

const readState = (path: string): StateDocument => {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<StateDocument>;
  const recordsValid =
    value.records &&
    typeof value.records === "object" &&
    Object.values(value.records).every(
      (record) =>
        record &&
        typeof record === "object" &&
        typeof record.payload === "string" &&
        Number.isFinite(record.expires_at) &&
        (record.envelope === undefined ||
          record.envelope === 2 ||
          (record.envelope === 3 && typeof record.key_id === "string" && record.key_id.length > 0)),
    );
  if (value.version !== 1 || !recordsValid) {
    throw new Error("Enterprise state file is invalid");
  }
  return value as StateDocument;
};

const writeState = (path: string, state: StateDocument): void => {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
    const temporaryHandle = openSync(temporary, "r");
    try {
      fsyncSync(temporaryHandle);
    } finally {
      closeSync(temporaryHandle);
    }
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    const directoryHandle = openSync(dirname(path), "r");
    try {
      fsyncSync(directoryHandle);
    } finally {
      closeSync(directoryHandle);
    }
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
};

const recordKey = (kind: StateKind, id: string): string => `${kind}:${id}`;

const acquireLock = (path: string): (() => void) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return lockfile.lockSync(path, { realpath: false });
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ELOCKED" ||
        attempt === 39
      ) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  throw new Error("Enterprise state lock could not be acquired");
};

const withPosixState = <Value>(
  operation: (state: StateDocument) => StateOperation<Value>,
): Value => {
  const path = statePath();
  const release = acquireLock(path);
  try {
    const state = readState(path);
    const now = Date.now();
    let pruned = false;
    for (const [key, record] of Object.entries(state.records)) {
      if (record.expires_at <= now) {
        delete state.records[key];
        pruned = true;
      }
    }
    const result = operation(state);
    if (pruned || result.write) writeState(path, state);
    return result.value;
  } finally {
    release();
  }
};

const parseState = (serialized: string | null): StateDocument => {
  if (serialized === null) return { version: 1, records: {} };
  const value = JSON.parse(serialized) as Partial<StateDocument>;
  const recordsValid =
    value.records &&
    typeof value.records === "object" &&
    Object.values(value.records).every(
      (record) =>
        record &&
        typeof record === "object" &&
        typeof record.payload === "string" &&
        Number.isFinite(record.expires_at) &&
        (record.envelope === undefined ||
          record.envelope === 2 ||
          (record.envelope === 3 && typeof record.key_id === "string" && record.key_id.length > 0)),
    );
  if (value.version !== 1 || !recordsValid) throw new Error("Enterprise Redis state is invalid");
  return value as StateDocument;
};

const pruneState = (state: StateDocument): boolean => {
  const now = Date.now();
  let pruned = false;
  for (const [key, record] of Object.entries(state.records)) {
    if (record.expires_at <= now) {
      delete state.records[key];
      pruned = true;
    }
  }
  return pruned;
};

const redisTransaction = <Value>(
  operation: (transaction: EnterpriseStateTransaction) => Value,
): Promise<Value> =>
  transactRedisState((serialized) => {
    const state = parseState(serialized);
    const pruned = pruneState(state);
    const result = applyTransaction(state, operation);
    const expirations = Object.values(state.records).map((record) => record.expires_at);
    return {
      expiresAt: expirations.length === 0 ? undefined : Math.max(...expirations),
      serialized: expirations.length === 0 ? null : JSON.stringify(state),
      value: result.value,
      write: pruned || result.write,
    };
  });

const transactionFor = async <Value>(
  operation: (transaction: EnterpriseStateTransaction) => Value,
): Promise<Value> => {
  if (stateStoreKind() === "redis") return redisTransaction(operation);
  return withPosixState((state) => {
    pruneState(state);
    return applyTransaction(state, operation);
  });
};

export const putEnterpriseState = async (
  kind: StateKind,
  id: string,
  value: unknown,
  expiresAt: number,
): Promise<void> => {
  await transactionFor((transaction) => transaction.put(kind, id, value, expiresAt));
};

export const getEnterpriseState = <Value>(kind: StateKind, id: string): Promise<Value | null> =>
  transactionFor((transaction) => transaction.get<Value>(kind, id));

export const takeEnterpriseState = <Value>(kind: StateKind, id: string): Promise<Value | null> =>
  transactionFor((transaction) => transaction.delete<Value>(kind, id));

const applyTransaction = <Value>(
  state: StateDocument,
  operation: (transaction: EnterpriseStateTransaction) => Value,
): StateOperation<Value> => {
  let write = false;
  const transaction: EnterpriseStateTransaction = {
    delete: <Entry>(kind: StateKind, id: string): Entry | null => {
      const key = recordKey(kind, id);
      const record = state.records[key];
      if (record) {
        delete state.records[key];
        write = true;
      }
      return record ? decrypt<Entry>(record, key) : null;
    },
    entries: <Entry>(kind: StateKind): Array<[string, Entry]> =>
      Object.entries(state.records)
        .filter(([key]) => key.startsWith(`${kind}:`))
        .map(([key, record]) => [key.slice(kind.length + 1), decrypt<Entry>(record, key)]),
    get: <Entry>(kind: StateKind, id: string): Entry | null => {
      const key = recordKey(kind, id);
      const record = state.records[key];
      if (!record) return null;
      const value = decrypt<Entry>(record, key);
      const primaryKeyId = sessionKeyring()[0]!.id;
      if (record.envelope !== 3 || record.key_id !== primaryKeyId) {
        state.records[key] = encrypt(value, key, record.expires_at);
        write = true;
      }
      return value;
    },
    put: (kind: StateKind, id: string, value: unknown, expiresAt: number): void => {
      const key = recordKey(kind, id);
      state.records[key] = encrypt(value, key, expiresAt);
      write = true;
    },
  };
  return { value: operation(transaction), write };
};

export const transactEnterpriseState = <Value>(
  operation: (transaction: EnterpriseStateTransaction) => Value,
): Promise<Value> => transactionFor(operation);

const acquirePosixLease = (scope: string): Promise<() => Promise<void>> =>
  lockfile.lock(leasePath(scope), {
    realpath: false,
    stale: 30_000,
    update: 5_000,
    retries: {
      retries: 160,
      factor: 1.2,
      minTimeout: 25,
      maxTimeout: 250,
      randomize: true,
    },
  });

export const acquireEnterpriseStateLease = (scope: string): Promise<() => Promise<void>> =>
  stateStoreKind() === "redis" ? acquireRedisStateLease(scope) : acquirePosixLease(scope);

export const withEnterpriseStateLease = async <Value>(
  scope: string,
  operation: () => Promise<Value>,
): Promise<Value> => {
  const release = await acquireEnterpriseStateLease(scope);
  try {
    return await operation();
  } finally {
    await release();
  }
};
