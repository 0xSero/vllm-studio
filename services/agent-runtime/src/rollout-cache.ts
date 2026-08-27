import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveDataDir } from "./data-dir";

const CACHE_SCHEMA = 1;

type Envelope<T> = {
  schema: number;
  size: number;
  mtimeMs: number;
  value: T;
};

function cacheRoot(): string {
  return path.join(resolveDataDir(), "rollout-cache");
}

function cacheFileFor(kind: string, filepath: string, extension = ".json"): string {
  const digest = createHash("sha256").update(path.resolve(filepath)).digest("hex").slice(0, 32);
  const readable = (path.basename(filepath).match(/^[\w.-]{0,40}/)?.[0] ?? "rollout").replace(
    /\.jsonl$/,
    "",
  );
  return path.join(cacheRoot(), kind, `${readable}.${digest}${extension}`);
}

export function rolloutCacheFilePath(kind: string, filepath: string, extension: string): string {
  return cacheFileFor(kind, filepath, extension);
}

function readEnvelope<T>(file: string, size?: number, mtimeMs?: number): T | undefined {
  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
  if (parsed?.schema !== CACHE_SCHEMA) return undefined;
  if (size !== undefined && parsed.size !== size) return undefined;
  if (mtimeMs !== undefined && parsed.mtimeMs !== mtimeMs) return undefined;
  return parsed.value;
}

const MAX_ENTRIES_PER_KIND = 512;

export function evictIfCrowded(directory: string, extension = ".json"): void {
  let names: string[];
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(extension));
  } catch {
    return;
  }
  if (names.length <= MAX_ENTRIES_PER_KIND) return;

  const byAge = names
    .map((name) => {
      const file = path.join(directory, name);
      try {
        return { file, atimeMs: statSync(file).atimeMs };
      } catch {
        return { file, atimeMs: 0 };
      }
    })
    .sort((a, b) => a.atimeMs - b.atimeMs);

  for (const { file } of byAge.slice(0, byAge.length - MAX_ENTRIES_PER_KIND)) {
    try {
      unlinkSync(file);
    } catch {}
  }
}

function writeEnvelope<T>(file: string, envelope: Envelope<T>): void {
  try {
    const directory = path.dirname(file);
    mkdirSync(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(envelope), "utf-8");
    renameSync(temporary, file);
    evictIfCrowded(directory);
  } catch {}
}

export type RolloutCache<T> = {
  read(filepath: string, stat: { size: number; mtimeMs: number }): T | undefined;
  readStale(filepath: string): T | undefined;
  write(filepath: string, stat: { size: number; mtimeMs: number }, value: T): void;
  forget(filepath: string): void;
};

export function rolloutCache<T, S>(
  kind: string,
  codec: { serialize: (value: T) => S; deserialize: (raw: S) => T },
): RolloutCache<T> {
  const decode = (raw: S): T | undefined => {
    try {
      return codec.deserialize(raw);
    } catch {
      return undefined;
    }
  };
  const read = (filepath: string, stat?: { size: number; mtimeMs: number }) => {
    const raw = readEnvelope<S>(cacheFileFor(kind, filepath), stat?.size, stat?.mtimeMs);
    return raw === undefined ? undefined : decode(raw);
  };
  return {
    read: (filepath, stat) => read(filepath, stat),
    readStale: (filepath) => read(filepath),
    write(filepath, stat, value) {
      writeEnvelope(cacheFileFor(kind, filepath), {
        schema: CACHE_SCHEMA,
        ...stat,
        value: codec.serialize(value),
      });
    },
    forget(filepath) {
      try {
        unlinkSync(cacheFileFor(kind, filepath));
      } catch {}
    },
  };
}

export async function readRolloutHead(filepath: string, bytes = 512): Promise<string> {
  const chunks: Buffer[] = [];
  const stream = createReadStream(filepath, { start: 0, end: bytes - 1 });
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

export async function scanCompleteRolloutLines(
  filepath: string,
  start: number,
  consume: (line: string) => void,
): Promise<number> {
  let consumedBytes = start;
  let pending = "";
  const stream = createReadStream(filepath, { start, encoding: "utf-8" });
  for await (const chunk of stream) {
    pending += chunk;
    let lineStart = 0;
    let newline = pending.indexOf("\n", lineStart);
    while (newline !== -1) {
      const line = pending.slice(lineStart, newline);
      consume(line);
      consumedBytes += Buffer.byteLength(line, "utf-8") + 1;
      lineStart = newline + 1;
      newline = pending.indexOf("\n", lineStart);
    }
    pending = pending.slice(lineStart);
  }
  return consumedBytes;
}

export function statRollout(filepath: string): { size: number; mtimeMs: number } | undefined {
  try {
    const { size, mtimeMs } = statSync(filepath);
    return { size, mtimeMs };
  } catch {
    return undefined;
  }
}
