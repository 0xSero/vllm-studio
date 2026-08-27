import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import {
  evictIfCrowded,
  readRolloutHead,
  rolloutCache,
  rolloutCacheFilePath,
  scanCompleteRolloutLines,
  statRollout,
} from "./rollout-cache";

const SIDECAR_KIND = "transcript";

const INERT_PREFIXES = ['{"type":"custom"', '{"type":"custom_message"'];
const InertEventSchema = Schema.Struct({ type: Schema.optional(Schema.String) });

function lineIsInert(line: string): boolean {
  for (const prefix of INERT_PREFIXES) {
    if (line.startsWith(prefix)) return true;
  }
  if (!line.includes('"custom')) return false;
  try {
    const type = Schema.decodeUnknownSync(InertEventSchema)(JSON.parse(line)).type;
    return type === "custom" || type === "custom_message";
  } catch {
    return false;
  }
}

type SidecarState = {
  sourceSize: number;
  sourceMtimeMs: number;
  scannedBytes: number;
  head: string;
};

const state = rolloutCache<SidecarState, SidecarState>("transcript-state", {
  serialize: (value) => value,
  deserialize: (value) => value,
});

async function appendFrom(source: string, sidecar: string, start: number): Promise<number> {
  let batch: string[] = [];
  const flush = () => {
    if (batch.length === 0) return;
    appendFileSync(sidecar, `${batch.join("\n")}\n`, "utf-8");
    batch = [];
  };
  const scannedBytes = await scanCompleteRolloutLines(source, start, (line) => {
    if (line && !lineIsInert(line)) batch.push(line);
    if (batch.length >= 2048) flush();
  });
  flush();
  return scannedBytes;
}

export type TranscriptSource = { filepath: string; size: number };

export async function transcriptSource(filepath: string): Promise<TranscriptSource> {
  const original = (): TranscriptSource => ({
    filepath,
    size: statRollout(filepath)?.size ?? 0,
  });

  const stat = statRollout(filepath);
  if (!stat) return original();

  try {
    const sidecar = rolloutCacheFilePath(SIDECAR_KIND, filepath, ".jsonl");
    const head = await readRolloutHead(filepath);
    const previous = state.readStale(filepath);

    const sidecarSize = (() => {
      try {
        return statSync(sidecar).size;
      } catch {
        return -1;
      }
    })();

    const resumable =
      previous !== undefined &&
      previous.head === head &&
      stat.size >= previous.scannedBytes &&
      previous.scannedBytes > 0 &&
      sidecarSize >= 0;

    if (resumable && previous.sourceSize === stat.size && previous.sourceMtimeMs === stat.mtimeMs) {
      return { filepath: sidecar, size: sidecarSize };
    }

    mkdirSync(path.dirname(sidecar), { recursive: true });
    if (!resumable) writeFileSync(sidecar, "", "utf-8");

    const scannedBytes = await appendFrom(filepath, sidecar, resumable ? previous.scannedBytes : 0);
    state.write(filepath, stat, {
      sourceSize: stat.size,
      sourceMtimeMs: stat.mtimeMs,
      scannedBytes,
      head,
    });
    evictIfCrowded(path.dirname(sidecar), ".jsonl");

    return { filepath: sidecar, size: statSync(sidecar).size };
  } catch {
    return original();
  }
}
