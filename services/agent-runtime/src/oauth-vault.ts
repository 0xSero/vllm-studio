import { randomUUID } from "node:crypto";
import { Effect } from "effect";

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

export const desktopOAuthVault: OAuthVault = {
  read: (key) => vaultEffect(() => request("read", key)),
  write: (key, value) => vaultEffect(async () => void (await request("write", key, value))),
  remove: (key) => vaultEffect(async () => void (await request("delete", key))),
};
