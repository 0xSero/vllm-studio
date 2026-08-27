import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";

type VaultRequest = {
  channel: "local-studio:oauth-vault:request";
  id: string;
  operation: "read" | "write" | "delete";
  key: string;
  value?: string;
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

const VaultResponseSchema = Schema.Struct({
  channel: Schema.Literal("local-studio:oauth-vault:response"),
  id: Schema.String,
  ok: Schema.Boolean,
  value: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});

const decodeVaultResponse = Schema.decodeUnknownOption(VaultResponseSchema);

function listen(): void {
  if (listening) return;
  listening = true;
  process.on("message", (message) => {
    const response = decodeVaultResponse(message);
    if (response._tag === "None") return;
    const request = pending.get(response.value.id);
    if (!request) return;
    pending.delete(response.value.id);
    clearTimeout(request.timeout);
    if (response.value.ok) request.resolve(response.value.value);
    else request.reject(new OAuthVaultError(response.value.error ?? "Secure OAuth storage failed"));
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
    const payload: VaultRequest = {
      channel: "local-studio:oauth-vault:request",
      id,
      operation,
      key,
    };
    if (value !== undefined) payload.value = value;
    process.send(payload, undefined, undefined, (error: Error | null) => {
      if (!error) return;
      const active = pending.get(id);
      if (!active) return;
      pending.delete(id);
      clearTimeout(active.timeout);
      active.reject(new OAuthVaultError("Secure OAuth storage request failed"));
    });
  });
}

function vaultEffect<A>(operation: () => Promise<A>): Effect.Effect<A, OAuthVaultError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) =>
      error instanceof OAuthVaultError ? error : new OAuthVaultError("Secure OAuth storage failed"),
  });
}

export const desktopOAuthVault: OAuthVault = {
  read: (key) => vaultEffect(() => request("read", key)),
  write: (key, value) => vaultEffect(async () => void (await request("write", key, value))),
  remove: (key) => vaultEffect(async () => void (await request("delete", key))),
};
