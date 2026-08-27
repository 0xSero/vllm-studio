import { safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ChildProcess, Serializable } from "node:child_process";
import { Schema } from "effect";

const keyPattern = /^[a-z0-9][a-z0-9:_-]{0,127}$/;

const VaultRequestSchema = Schema.Struct({
  channel: Schema.Literal("local-studio:oauth-vault:request"),
  id: Schema.String,
  operation: Schema.Literals(["read", "write", "delete"]),
  key: Schema.String.check(Schema.isPattern(keyPattern)),
  value: Schema.optional(Schema.String.check(Schema.isMaxLength(1_000_000))),
});
type VaultRequest = typeof VaultRequestSchema.Type;

interface VaultSuccessResponse {
  channel: "local-studio:oauth-vault:response";
  id: string;
  ok: true;
  value?: string;
}

const VaultFileSchema = Schema.Record(Schema.String, Schema.Unknown);
const decodeVaultRequest = Schema.decodeUnknownSync(VaultRequestSchema);
const decodeVaultFile = Schema.decodeUnknownSync(Schema.fromJsonString(VaultFileSchema));
const isString = Schema.is(Schema.String);
let vaultAccess = Promise.resolve();

async function readVault(file: string): Promise<Record<string, string>> {
  if (!existsSync(file)) return {};
  const parsed = decodeVaultFile(await readFile(file, "utf8"));
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => keyPattern.test(entry[0]) && isString(entry[1]),
    ),
  );
}

async function writeVault(file: string, vault: Record<string, string>): Promise<void> {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(vault, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
}

function vaultOperation(file: string, request: VaultRequest): Promise<string | undefined> {
  const operation = vaultAccess.then(async () => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is unavailable");
    const vault = await readVault(file);
    if (request.operation === "read") {
      const encrypted = vault[request.key];
      if (!encrypted) return undefined;
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      if (decrypted.length > 1_000_000) throw new Error("OAuth vault value is too large");
      return decrypted;
    }
    if (request.operation === "write") {
      if (request.value === undefined) throw new Error("Vault value is required");
      vault[request.key] = safeStorage.encryptString(request.value).toString("base64");
    } else {
      delete vault[request.key];
    }
    await writeVault(file, vault);
    return undefined;
  });
  vaultAccess = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export function registerOAuthVault(child: ChildProcess, dataDir: string): void {
  const file = path.join(dataDir, "oauth-vault.json");
  child.on("message", (message: Serializable) => {
    let request: VaultRequest;
    try {
      request = decodeVaultRequest(message);
    } catch {
      return;
    }
    void vaultOperation(file, request)
      .then((value) => {
        if (child.connected) {
          const response: VaultSuccessResponse = {
            channel: "local-studio:oauth-vault:response",
            id: request.id,
            ok: true,
          };
          if (value !== undefined) response.value = value;
          child.send(response);
        }
      })
      .catch(() => {
        if (child.connected) {
          child.send({
            channel: "local-studio:oauth-vault:response",
            id: request.id,
            ok: false,
            error: "Secure OAuth storage failed",
          });
        }
      });
  });
}
