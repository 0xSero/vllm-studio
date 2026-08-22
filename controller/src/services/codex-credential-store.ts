import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from "@earendil-works/pi-ai";
import { Schema } from "effect";

const OAuthCredentialSchema = Schema.Struct({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: Schema.Number,
  accountId: Schema.optional(Schema.String),
});

const CredentialsSchema = Schema.Record(Schema.String, OAuthCredentialSchema);

type StoredCredentials = Record<string, OAuthCredential>;

export class CodexCredentialStore implements CredentialStore {
  readonly #path: string;
  #loaded: Promise<StoredCredentials> | null = null;
  #writes: Promise<void> = Promise.resolve();

  public constructor(dataDirectory: string) {
    this.#path = resolve(dataDirectory, "credentials", "openai-codex.json");
  }

  #load(): Promise<StoredCredentials> {
    if (!this.#loaded) {
      this.#loaded = readFile(this.#path, "utf8")
        .then((raw) => Schema.decodeUnknownSync(CredentialsSchema)(JSON.parse(raw)))
        .catch(() => ({}));
    }
    return this.#loaded;
  }

  #persist(credentials: StoredCredentials): Promise<void> {
    const directory = dirname(this.#path);
    return mkdir(directory, { recursive: true, mode: 0o700 }).then(() => {
      const temporary = `${this.#path}.tmp-${process.pid}-${randomUUID()}`;
      return writeFile(temporary, JSON.stringify(credentials, null, 2), { mode: 0o600 })
        .then(() => rename(temporary, this.#path))
        .then(() =>
          Promise.all([
            chmod(directory, 0o700).catch(() => undefined),
            chmod(this.#path, 0o600).catch(() => undefined),
          ]).then(() => undefined),
        );
    });
  }

  #enqueue<A>(operation: () => Promise<A>): Promise<A> {
    const result = this.#writes.then(operation, operation);
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  public read(providerId: string): Promise<Credential | undefined> {
    return this.#writes.then(() => this.#load()).then((credentials) => credentials[providerId]);
  }

  public list(): Promise<readonly CredentialInfo[]> {
    return this.#writes
      .then(() => this.#load())
      .then((credentials) =>
        Object.entries(credentials).map(([providerId, credential]) => ({
          providerId,
          type: credential.type,
        })),
      );
  }

  public modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.#enqueue(() =>
      this.#load().then((credentials) => {
        const current = credentials[providerId];
        return update(current).then((next) => {
          if (!next) return current;
          if (next.type !== "oauth") throw new Error("Codex credentials must use OAuth");
          credentials[providerId] = next;
          return this.#persist(credentials).then(() => next);
        });
      }),
    );
  }

  public delete(providerId: string): Promise<void> {
    return this.#enqueue(() =>
      this.#load().then((credentials) => {
        if (!(providerId in credentials)) return;
        delete credentials[providerId];
        return this.#persist(credentials);
      }),
    );
  }
}
