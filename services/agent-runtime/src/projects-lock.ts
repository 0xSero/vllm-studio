import path from "node:path";
import { Effect } from "effect";
import lockfile from "proper-lockfile";
import { ensureOwnerDirectory, ownerFileExists } from "./owner-files";

function transactionError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function withProjectsFileTransaction<T>(filePath: string, operation: () => T): Promise<T> {
  const canonicalFile = path.resolve(filePath);
  return Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => {
          ensureOwnerDirectory(path.dirname(canonicalFile));
          ownerFileExists(canonicalFile);
          return lockfile.lock(canonicalFile, {
            realpath: false,
            stale: 10_000,
            retries: {
              retries: 79,
              factor: 1,
              minTimeout: 25,
              maxTimeout: 25,
              randomize: false,
            },
          });
        },
        catch: transactionError,
      }),
      () =>
        Effect.try({
          try: () => {
            ensureOwnerDirectory(`${canonicalFile}.lock`);
            return operation();
          },
          catch: transactionError,
        }),
      (release) => Effect.promise(() => release()),
    ),
  );
}
