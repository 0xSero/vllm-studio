import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Schema } from "effect";

const ApiKeyCredentialSchema = Schema.Struct({
  type: Schema.Literal("api_key"),
  key: Schema.String,
});

type ApiKeyCredential = typeof ApiKeyCredentialSchema.Type;

export class ApiKeyCredentialStore {
  readonly #path: string;
  #loaded: Promise<ApiKeyCredential | null> | null = null;
  #writes: Promise<void> = Promise.resolve();

  public constructor(dataDirectory: string, filename: string) {
    this.#path = resolve(dataDirectory, "credentials", filename);
  }

  #load(): Promise<ApiKeyCredential | null> {
    if (!this.#loaded) {
      this.#loaded = readFile(this.#path, "utf8")
        .then((raw) => Schema.decodeUnknownSync(ApiKeyCredentialSchema)(JSON.parse(raw)))
        .catch(() => null);
    }
    return this.#loaded;
  }

  #enqueue<A>(operation: () => Promise<A>): Promise<A> {
    const result = this.#writes.then(operation, operation);
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #persist(credential: ApiKeyCredential): Promise<void> {
    const directory = dirname(this.#path);
    const temporary = `${this.#path}.tmp-${process.pid}-${randomUUID()}`;
    return mkdir(directory, { recursive: true, mode: 0o700 })
      .then(() => writeFile(temporary, JSON.stringify(credential, null, 2), { mode: 0o600 }))
      .then(() => rename(temporary, this.#path))
      .then(() =>
        Promise.all([
          chmod(directory, 0o700).catch(() => undefined),
          chmod(this.#path, 0o600).catch(() => undefined),
        ]).then(() => undefined),
      )
      .catch((error) =>
        unlink(temporary)
          .catch(() => undefined)
          .then(() => Promise.reject(error)),
      );
  }

  public read(): Promise<string | null> {
    return this.#writes.then(() => this.#load()).then((credential) => credential?.key ?? null);
  }

  public save(key: string): Promise<void> {
    const normalized = key.trim();
    if (!normalized) return Promise.reject(new Error("API key is required"));
    return this.#enqueue(() => {
      const credential = { type: "api_key" as const, key: normalized };
      return this.#persist(credential).then(() => {
        this.#loaded = Promise.resolve(credential);
      });
    });
  }

  public delete(): Promise<void> {
    return this.#enqueue(() =>
      unlink(this.#path)
        .catch((error: unknown) => {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
            return;
          throw error;
        })
        .then(() => {
          this.#loaded = Promise.resolve(null);
        }),
    );
  }
}
