import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Effect, Schedule, Schema } from "effect";
import type { KittylitterPairingResult } from "../interfaces";

const execFileAsync = promisify(execFile);

const PAIR_RETRIES = 2;
const PAIR_RETRY_DELAY_MS = 5_000;

const executablePath = (): string => {
  const configured = process.env.KITTYLITTER_BIN?.trim();
  const userHome = homedir();
  const candidates = [
    configured && path.isAbsolute(configured) ? configured : undefined,
    path.join(
      userHome,
      "Library",
      "Application Support",
      "com.sigkitten.kittylitter",
      "bin",
      "kittylitter",
    ),
    path.join(userHome, ".local", "bin", "kittylitter"),
    "/opt/homebrew/bin/kittylitter",
    "/usr/local/bin/kittylitter",
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? "kittylitter";
};

const PairingPayloadSchema = Schema.Struct({
  v: Schema.Int,
  node_id: Schema.NonEmptyString,
  token: Schema.NonEmptyString,
  host_name: Schema.optional(Schema.NonEmptyString),
  relay: Schema.optional(Schema.NullOr(Schema.String)),
});

const ErrorWithCodeSchema = Schema.Struct({ code: Schema.String });
const isErrorWithCode = Schema.is(ErrorWithCodeSchema);

export const normalizeKittylitterPairingJson = (input: string): string => {
  const decoded: unknown = JSON.parse(input);
  const value = Schema.decodeUnknownOption(PairingPayloadSchema)(decoded);
  if (value._tag === "None") throw new Error("invalid pairing payload");
  return JSON.stringify(value.value);
};

export const getKittylitterPairingJson = async (options?: {
  retries?: number;
  retryDelayMs?: number;
}): Promise<KittylitterPairingResult> => {
  const retries = options?.retries ?? PAIR_RETRIES;
  const retryDelayMs = options?.retryDelayMs ?? PAIR_RETRY_DELAY_MS;
  const pairAttempt = Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync(executablePath(), ["pair"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 30_000,
      });
      return normalizeKittylitterPairingJson(String(stdout).trim());
    },
    catch: (error) => (isErrorWithCode(error) ? error.code : "unknown"),
  });
  return Effect.runPromise(
    pairAttempt.pipe(
      Effect.retry(Schedule.both(Schedule.spaced(retryDelayMs), Schedule.recurs(retries))),
      Effect.map((pairingJson): KittylitterPairingResult => ({ ok: true, pairingJson })),
      Effect.catch((code) =>
        Effect.succeed<KittylitterPairingResult>({
          ok: false,
          error: `KittyLitter is unavailable (${code}). Start the controller and try again.`,
        }),
      ),
    ),
  );
};
