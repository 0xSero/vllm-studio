import { Schema } from "effect";
import { exclusiveLaneOf } from "../../../shared/agent/lane-identity";
import { getApiSettings } from "./settings-service";

const LANE_STATUS_TTL_MS = 1_000;
const LANE_STATUS_TIMEOUT_MS = 3_000;

export type ExclusiveLaneReadyCode =
  | "lane_switch_in_progress"
  | "lane_not_resident"
  | "lane_status_unavailable";

export class ExclusiveLaneNotReadyError extends Error {
  readonly status = 503;
  readonly code: ExclusiveLaneReadyCode;

  constructor(code: ExclusiveLaneReadyCode) {
    super(code);
    this.name = "ExclusiveLaneNotReadyError";
    this.code = code;
  }
}

const LaneStatusSchema = Schema.Struct({
  enabled: Schema.Boolean,
  resident_lane: Schema.String,
  switch: Schema.optional(
    Schema.Struct({
      state: Schema.optional(Schema.String),
    }),
  ),
});

type LaneStatusSnapshot = {
  enabled: boolean;
  residentLane: string;
  switchState: string | null;
};

let lastEnabled: boolean | null = null;
let cache: { at: number; snapshot: LaneStatusSnapshot } | null = null;
let inflight: Promise<LaneStatusSnapshot | null> | null = null;

export function resetExclusiveLaneReadyState(options?: { retainLastEnabled?: boolean }): void {
  if (!options?.retainLastEnabled) lastEnabled = null;
  cache = null;
  inflight = null;
}

function parseLaneStatus(value: unknown): LaneStatusSnapshot | null {
  try {
    const decoded = Schema.decodeUnknownSync(LaneStatusSchema)(value);
    return {
      enabled: decoded.enabled,
      residentLane: decoded.resident_lane,
      switchState: decoded.switch?.state ?? null,
    };
  } catch {
    return null;
  }
}

function observeEnabled(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const enabled = (value as { enabled?: unknown }).enabled;
  if (typeof enabled === "boolean") lastEnabled = enabled;
}

async function loadLaneStatus(): Promise<LaneStatusSnapshot | null> {
  const now = Date.now();
  if (cache && now - cache.at < LANE_STATUS_TTL_MS) return cache.snapshot;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const settings = await getApiSettings();
      const base = settings.backendUrl.trim().replace(/\/+$/, "");
      const headers: HeadersInit = { Accept: "application/json" };
      if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
      const response = await fetch(`${base}/studio/lanes`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(LANE_STATUS_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return null;
      }
      observeEnabled(body);
      const snapshot = parseLaneStatus(body);
      if (!snapshot) return null;
      cache = { at: Date.now(), snapshot };
      return snapshot;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function assertExclusiveLaneReady(modelId: string): Promise<void> {
  const requested = exclusiveLaneOf(modelId);
  if (!requested) return;

  const snapshot = await loadLaneStatus();
  if (!snapshot) {
    if (lastEnabled === true) {
      throw new ExclusiveLaneNotReadyError("lane_status_unavailable");
    }
    return;
  }
  if (!snapshot.enabled) return;
  if (snapshot.switchState === "running" || snapshot.switchState === "restoring") {
    throw new ExclusiveLaneNotReadyError("lane_switch_in_progress");
  }
  if (snapshot.residentLane !== requested) {
    throw new ExclusiveLaneNotReadyError("lane_not_resident");
  }
}
