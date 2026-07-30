import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { resolveDataDir } from "./data-dir";
import { desktopOAuthVault } from "./oauth-vault";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT_VERSION = 1;
let access = Promise.resolve();

const decodeKey = (value: string): Buffer => {
  const key = /^[a-f\d]{64}$/iu.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES) throw new Error("Controller credential key must encode 32 bytes");
  return key;
};

const directory = (): string => path.join(resolveDataDir(), "controller-credentials");

const assertSafeFile = async (file: string): Promise<void> => {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error("Controller credential file is unsafe");
  }
};

const syncDirectory = async (value: string): Promise<void> => {
  try {
    const handle = await open(value, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
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

const key = async (): Promise<Buffer> => {
  const configured =
    process.env["LOCAL_STUDIO_CONTROLLER_CREDENTIAL_KEY"]?.trim() ||
    process.env["LOCAL_STUDIO_SHARED_SECRET_KEY"]?.trim();
  if (configured) return decodeKey(configured);
  if (
    process.env.NODE_ENV === "production" &&
    process.env.LOCAL_STUDIO_DESKTOP !== "1" &&
    process.env.LOCAL_STUDIO_DESKTOP !== "true"
  ) {
    throw new Error("LOCAL_STUDIO_CONTROLLER_CREDENTIAL_KEY is required for shared deployments");
  }
  const file = path.join(directory(), "local-master.key");
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  if (!existsSync(file)) {
    await writeFile(file, randomBytes(KEY_BYTES), { flag: "wx", mode: 0o600 });
  }
  await assertSafeFile(file);
  await chmod(file, 0o600);
  const value = await readFile(file);
  if (value.length !== KEY_BYTES) throw new Error("Local controller credential key is invalid");
  return value;
};

export const controllerCredentialReference = (backendUrl: string): string =>
  `controller:${createHash("sha256").update(backendUrl).digest("hex")}`;

const filePath = (backendUrl: string): string =>
  path.join(
    directory(),
    `${createHash("sha256").update(controllerCredentialReference(backendUrl)).digest("hex")}.bin`,
  );

const nativeStorage = (): boolean =>
  process.env.LOCAL_STUDIO_DESKTOP === "1" && Boolean(process.send && process.connected);

export type ControllerCredentialStorageKind =
  | "native-keyring"
  | "deployment-encrypted"
  | "local-encrypted"
  | "unavailable";

export type ControllerCredentialStorageStatus = {
  kind: ControllerCredentialStorageKind;
  durable: boolean;
  detail: string;
};

export const controllerCredentialStorageStatus = (): ControllerCredentialStorageStatus => {
  if (nativeStorage()) {
    return {
      kind: "native-keyring",
      durable: true,
      detail: "Controller credentials are protected by the operating system credential store.",
    };
  }
  if (process.env["LOCAL_STUDIO_CONTROLLER_CREDENTIAL_KEY"]?.trim()) {
    return {
      kind: "deployment-encrypted",
      durable: true,
      detail: "Controller credentials are encrypted with a deployment-owned key.",
    };
  }
  if (process.env["LOCAL_STUDIO_SHARED_SECRET_KEY"]?.trim()) {
    return {
      kind: "deployment-encrypted",
      durable: true,
      detail: "Controller credentials are encrypted with the shared deployment key.",
    };
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.LOCAL_STUDIO_DESKTOP !== "1" &&
    process.env.LOCAL_STUDIO_DESKTOP !== "true"
  ) {
    return {
      kind: "unavailable",
      durable: false,
      detail: "A deployment-owned controller credential key is required.",
    };
  }
  return {
    kind: "local-encrypted",
    durable: true,
    detail: "Controller credentials are encrypted for this local workstation.",
  };
};

const serialized = <A>(operation: () => Promise<A>): Promise<A> => {
  const result = access.then(operation);
  access = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const readFileCredential = async (backendUrl: string): Promise<string> => {
  const file = filePath(backendUrl);
  if (!existsSync(file)) return "";
  await assertSafeFile(file);
  const bytes = await readFile(file);
  if (bytes.length <= 1 + NONCE_BYTES + TAG_BYTES || bytes[0] !== FORMAT_VERSION) {
    throw new Error("Controller credential data is invalid");
  }
  const keyBytes = await key();
  const tagStart = 1 + NONCE_BYTES;
  const dataStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv("aes-256-gcm", keyBytes, bytes.subarray(1, tagStart));
  decipher.setAAD(Buffer.from(controllerCredentialReference(backendUrl)));
  decipher.setAuthTag(bytes.subarray(tagStart, dataStart));
  return Buffer.concat([decipher.update(bytes.subarray(dataStart)), decipher.final()]).toString(
    "utf8",
  );
};

const removeFileCredential = async (backendUrl: string): Promise<void> => {
  const file = filePath(backendUrl);
  let removed = false;
  await unlink(file)
    .then(() => {
      removed = true;
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  if (removed) await syncDirectory(path.dirname(file));
};

const writeFileCredential = async (backendUrl: string, credential: string): Promise<void> => {
  const file = filePath(backendUrl);
  if (!credential) {
    await removeFileCredential(backendUrl);
    return;
  }
  if (credential.length > 32_768) throw new Error("Controller credential is invalid");
  const keyBytes = await key();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, nonce);
  cipher.setAAD(Buffer.from(controllerCredentialReference(backendUrl)));
  const encrypted = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(
      temporary,
      Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, cipher.getAuthTag(), encrypted]),
      { mode: 0o600 },
    );
    const temporaryHandle = await open(temporary, "r");
    try {
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await rename(temporary, file);
    await chmod(file, 0o600);
    await syncDirectory(path.dirname(file));
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

export const readControllerCredential = (backendUrl: string): Promise<string> =>
  serialized(async () => {
    if (!nativeStorage()) return readFileCredential(backendUrl);
    const reference = controllerCredentialReference(backendUrl);
    const nativeValue = await Effect.runPromise(desktopOAuthVault.read(reference));
    if (nativeValue !== undefined) {
      await removeFileCredential(backendUrl);
      return nativeValue;
    }
    const legacyValue = await readFileCredential(backendUrl);
    if (!legacyValue) return "";
    await Effect.runPromise(desktopOAuthVault.write(reference, legacyValue));
    await removeFileCredential(backendUrl);
    return legacyValue;
  });

export const writeControllerCredential = (backendUrl: string, credential: string): Promise<void> =>
  serialized(async () => {
    if (!nativeStorage()) {
      await writeFileCredential(backendUrl, credential);
      return;
    }
    const reference = controllerCredentialReference(backendUrl);
    if (credential) {
      if (credential.length > 32_768) throw new Error("Controller credential is invalid");
      await Effect.runPromise(desktopOAuthVault.write(reference, credential));
      await removeFileCredential(backendUrl);
    } else {
      await removeFileCredential(backendUrl);
      await Effect.runPromise(desktopOAuthVault.remove(reference));
    }
  });
