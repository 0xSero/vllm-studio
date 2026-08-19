import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { delimiter, join, sep } from "node:path";
import { Effect, Fiber, Semaphore } from "effect";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import type { ProviderConfig } from "../../config/persisted-config";
import { runCommandAsyncEffect, type AsyncCommandResult } from "../../core/command";
import { redactLogLine } from "../../core/log-redaction";
import type { Logger } from "../../core/logger";
import { parseBooleanFlag } from "../../core/validation";
import { Event, type EventManager } from "../system/event-manager";
import type { ExclusiveLane, ResidentLane } from "../../services/lane-identity";
import { exclusiveLaneOf } from "../../services/lane-identity";

export type LaneSwitchState = "idle" | "running" | "ready" | "failed" | "restoring";

export type LaneProbeView = {
  ready: boolean;
  port: number;
  model_ids: string[];
};

export type LaneResidency = {
  resident_lane: ResidentLane;
  omlx: LaneProbeView;
  ds4: LaneProbeView;
};

export type ExclusiveModelRow = {
  id: string;
  lane: ExclusiveLane;
  active: boolean;
  max_model_len?: number;
};

export type LaneSwitchJobView = {
  id: string | null;
  state: LaneSwitchState;
  from_lane: ResidentLane | null;
  to_lane: ExclusiveLane | null;
  script: string | null;
  exit_code: number | null;
  message: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  idempotent?: boolean;
};

export type LaneStatus = {
  enabled: boolean;
  configured: boolean;
  resident_lane: ResidentLane;
  omlx: LaneProbeView;
  ds4: LaneProbeView;
  switch: LaneSwitchJobView;
};

export type LaneSwitchAcceptResult =
  | { readonly kind: "disabled" }
  | { readonly kind: "unconfigured" }
  | { readonly kind: "occupied"; readonly job: LaneSwitchJobView }
  | { readonly kind: "existing"; readonly job: LaneSwitchJobView }
  | { readonly kind: "ready"; readonly job: LaneSwitchJobView }
  | { readonly kind: "accepted"; readonly job: LaneSwitchJobView };

export type LaneSwitchEnvironmentConfig = {
  enabled: boolean;
  scriptsDirectory: string | null;
  omlxPort: number;
  ds4Port: number;
  lanePath: string | null;
};

export const DEFAULT_OMLX_PORT = 8830;
export const DEFAULT_DS4_PORT = 8001;
export const LANE_PROBE_TIMEOUT_MS = 2_000;
export const LANE_PROBE_CACHE_MS = 1_000;
export const LANE_SWITCH_TIMEOUT_MS = {
  ds4: 1_020_000,
  omlx: 360_000,
} as const;
export const LANE_SWITCH_SCRIPTS: Record<ExclusiveLane, string> = {
  ds4: "switch-to-ds4.sh",
  omlx: "switch-to-laguna.sh",
};
export const EXCLUSIVE_LANE_CATALOG: ReadonlyArray<{ id: string; lane: ExclusiveLane }> = [
  { id: "omlx/laguna-s-2.1", lane: "omlx" },
  { id: "omlx/laguna-xs-2.1", lane: "omlx" },
  { id: "omlx/qwen3.8-27b", lane: "omlx" },
  { id: "ds4/deepseek-v4-flash", lane: "ds4" },
];

const EXCLUSIVE_LANES: readonly ExclusiveLane[] = ["omlx", "ds4"];

type LaneProbeInternal = LaneProbeView & {
  maxModelLengthById: Record<string, number>;
};

type LaneResidencyInternal = {
  resident_lane: ResidentLane;
  omlx: LaneProbeInternal;
  ds4: LaneProbeInternal;
};

type MutableJob = {
  id: string;
  state: Exclude<LaneSwitchState, "idle">;
  from_lane: ResidentLane;
  to_lane: ExclusiveLane;
  script: string;
  exit_code: number | null;
  message: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type LaneSwitchServiceOptions = {
  logger: Logger;
  eventManager: EventManager;
  getProviders: () => readonly ProviderConfig[];
  config?: LaneSwitchEnvironmentConfig;
  now?: () => number;
  probeCacheMs?: number;
  probeTimeoutMs?: number;
};

const parsePort = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) return fallback;
  return value;
};

export const loadLaneSwitchConfig = (): LaneSwitchEnvironmentConfig => ({
  enabled: parseBooleanFlag(process.env["LOCAL_STUDIO_LANE_SWITCH"]),
  scriptsDirectory: process.env["LOCAL_STUDIO_LANE_SCRIPTS_DIR"]?.trim() || null,
  omlxPort: parsePort(process.env["LOCAL_STUDIO_OMLX_PORT"], DEFAULT_OMLX_PORT),
  ds4Port: parsePort(process.env["LOCAL_STUDIO_DS4_PORT"], DEFAULT_DS4_PORT),
  lanePath: process.env["LOCAL_STUDIO_LANE_PATH"]?.trim() || null,
});

export const idleSwitchView = (): LaneSwitchJobView => ({
  id: null,
  state: "idle",
  from_lane: null,
  to_lane: null,
  script: null,
  exit_code: null,
  message: null,
  error: null,
  started_at: null,
  finished_at: null,
});

const lastNonEmptyLine = (chunk: string): string | null => {
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? null;
};

const prefixExclusiveModelId = (lane: ExclusiveLane, rawId: string): string => {
  const trimmed = rawId.trim();
  return trimmed.includes("/") ? trimmed : `${lane}/${trimmed}`;
};

const residentActive = (residentLane: ResidentLane, lane: ExclusiveLane): boolean =>
  residentLane === lane || residentLane === "conflict";

export const exclusiveModelsFromResidency = (
  residency: LaneResidencyInternal,
): ExclusiveModelRow[] => {
  const seen = new Set<string>();
  const rows: ExclusiveModelRow[] = [];
  const maxLengthFor = (lane: ExclusiveLane, id: string): number | undefined => {
    const raw = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
    const table = residency[lane].maxModelLengthById;
    return table[id] ?? table[raw];
  };
  const push = (id: string, lane: ExclusiveLane): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const maxModelLength = maxLengthFor(lane, id);
    const row: ExclusiveModelRow = {
      id,
      lane,
      active: residentActive(residency.resident_lane, lane),
    };
    if (maxModelLength !== undefined) row.max_model_len = maxModelLength;
    rows.push(row);
  };
  for (const entry of EXCLUSIVE_LANE_CATALOG) {
    push(entry.id, entry.lane);
  }
  for (const lane of EXCLUSIVE_LANES) {
    for (const rawId of residency[lane].model_ids) {
      push(prefixExclusiveModelId(lane, rawId), lane);
    }
  }
  return rows;
};

const toProbeView = (probe: LaneProbeInternal): LaneProbeView => ({
  ready: probe.ready,
  port: probe.port,
  model_ids: probe.model_ids,
});

const toResidencyView = (residency: LaneResidencyInternal): LaneResidency => ({
  resident_lane: residency.resident_lane,
  omlx: toProbeView(residency.omlx),
  ds4: toProbeView(residency.ds4),
});

const emptyProbe = (port: number): LaneProbeInternal => ({
  ready: false,
  port,
  model_ids: [],
  maxModelLengthById: {},
});

const resolveAllowlistedScript = (scriptsDirectory: string, basename: string): string | null => {
  try {
    const root = realpathSync(scriptsDirectory);
    const resolved = realpathSync(join(root, basename));
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (!resolved.startsWith(prefix)) return null;
    if (!statSync(resolved).isFile()) return null;
    return resolved;
  } catch {
    return null;
  }
};

const jobView = (job: MutableJob, idempotent = false): LaneSwitchJobView => {
  const view: LaneSwitchJobView = {
    id: job.id,
    state: job.state,
    from_lane: job.from_lane,
    to_lane: job.to_lane,
    script: job.script,
    exit_code: job.exit_code,
    message: job.message,
    error: job.error,
    started_at: job.started_at,
    finished_at: job.finished_at,
  };
  if (idempotent) view.idempotent = true;
  return view;
};

const occupiedState = (state: LaneSwitchState): boolean =>
  state === "running" || state === "restoring";

const inverseLane = (lane: ExclusiveLane): ExclusiveLane => (lane === "omlx" ? "ds4" : "omlx");

const canRestoreFrom = (fromLane: ResidentLane): fromLane is ExclusiveLane =>
  fromLane === "omlx" || fromLane === "ds4";

export class LaneSwitchService {
  private readonly logger: Logger;
  private readonly eventManager: EventManager;
  private readonly getProviders: () => readonly ProviderConfig[];
  private readonly config: LaneSwitchEnvironmentConfig;
  private readonly now: () => number;
  private readonly probeCacheMs: number;
  private readonly probeTimeoutMs: number;
  private readonly acceptLock = Semaphore.makeUnsafe(1);
  private currentJob: MutableJob | null = null;
  private runAbort: AbortController | null = null;
  private fiber: Fiber.Fiber<void, never> | null = null;
  private shuttingDown = false;
  private lastProbe: { at: number; residency: LaneResidencyInternal } | null = null;
  private inFlight: Fiber.Fiber<LaneResidencyInternal, never> | null = null;

  public constructor(options: LaneSwitchServiceOptions) {
    this.logger = options.logger;
    this.eventManager = options.eventManager;
    this.getProviders = options.getProviders;
    this.config = options.config ?? loadLaneSwitchConfig();
    this.now = options.now ?? Date.now;
    this.probeCacheMs = options.probeCacheMs ?? LANE_PROBE_CACHE_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? LANE_PROBE_TIMEOUT_MS;
  }

  public get enabled(): boolean {
    return this.config.enabled;
  }

  public isConfigured(): boolean {
    return this.resolveScript("omlx") !== null && this.resolveScript("ds4") !== null;
  }

  public jobSnapshot(): LaneSwitchJobView {
    return this.currentJob ? jobView(this.currentJob) : idleSwitchView();
  }

  public getJob(id: string): LaneSwitchJobView | null {
    if (!this.currentJob || this.currentJob.id !== id) return null;
    return jobView(this.currentJob);
  }

  public shutdown(): Effect.Effect<void> {
    const service = this;
    return Effect.gen(function* () {
      service.shuttingDown = true;
      service.runAbort?.abort();
      const fiber = service.fiber;
      service.fiber = null;
      if (fiber) yield* Fiber.interrupt(fiber).pipe(Effect.asVoid);
    });
  }

  public accept(target: ExclusiveLane): Effect.Effect<LaneSwitchAcceptResult> {
    return this.acceptLock.withPermit(this.acceptExclusive(target));
  }

  public getStatus(): Effect.Effect<LaneStatus> {
    const service = this;
    return service.probeFresh().pipe(
      Effect.map((internal) => {
        const residency = toResidencyView(internal);
        return {
          enabled: service.config.enabled,
          configured: service.config.enabled && service.isConfigured(),
          resident_lane: residency.resident_lane,
          omlx: residency.omlx,
          ds4: residency.ds4,
          switch: service.jobSnapshot(),
        };
      }),
    );
  }

  public exclusiveModelRows(): Effect.Effect<ExclusiveModelRow[]> {
    return this.probeListing().pipe(Effect.map(exclusiveModelsFromResidency));
  }

  public findExclusiveModel(id: string): Effect.Effect<ExclusiveModelRow | null> {
    if (!exclusiveLaneOf(id)) return Effect.succeed(null);
    return this.exclusiveModelRows().pipe(
      Effect.map((rows) => rows.find((row) => row.id === id) ?? null),
    );
  }

  public probeFresh(): Effect.Effect<LaneResidencyInternal> {
    const service = this;
    return Effect.gen(function* () {
      const cached = service.lastProbe;
      if (cached && service.now() - cached.at < service.probeCacheMs) {
        return cached.residency;
      }
      return yield* service.loadResidency();
    });
  }

  public probeListing(): Effect.Effect<LaneResidencyInternal> {
    const service = this;
    return Effect.gen(function* () {
      const cached = service.lastProbe;
      if (cached) {
        if (service.now() - cached.at >= service.probeCacheMs) {
          yield* service.loadResidency().pipe(Effect.forkDetach({ startImmediately: true }));
        }
        return cached.residency;
      }
      return yield* service.loadResidency();
    });
  }

  public waitForCurrentRun(): Effect.Effect<void> {
    const fiber = this.fiber;
    return fiber ? Fiber.await(fiber).pipe(Effect.asVoid) : Effect.void;
  }

  private start(job: MutableJob): Effect.Effect<void> {
    const service = this;
    return Effect.gen(function* () {
      service.currentJob = job;
      service.runAbort = new AbortController();
      service.fiber = yield* service.execute(job).pipe(
        Effect.catch(() => Effect.void),
        Effect.forkDetach({ startImmediately: true }),
      );
    });
  }

  private acceptExclusive(target: ExclusiveLane): Effect.Effect<LaneSwitchAcceptResult> {
    const service = this;
    return Effect.gen(function* () {
      if (!service.config.enabled) return { kind: "disabled" as const };
      if (!service.isConfigured()) return { kind: "unconfigured" as const };
      const current = service.currentJob;
      if (current && occupiedState(current.state)) {
        if (current.to_lane === target) {
          return { kind: "existing" as const, job: jobView(current, true) };
        }
        return { kind: "occupied" as const, job: jobView(current) };
      }
      const residency = toResidencyView(yield* service.probeFresh());
      if (residency.resident_lane === target) {
        const ready: MutableJob = {
          id: current?.id ?? randomUUID(),
          state: "ready",
          from_lane: residency.resident_lane,
          to_lane: target,
          script: LANE_SWITCH_SCRIPTS[target],
          exit_code: null,
          message: null,
          error: null,
          started_at: new Date(service.now()).toISOString(),
          finished_at: new Date(service.now()).toISOString(),
        };
        service.currentJob = ready;
        return { kind: "ready" as const, job: jobView(ready, true) };
      }
      const job: MutableJob = {
        id: randomUUID(),
        state: "running",
        from_lane: residency.resident_lane,
        to_lane: target,
        script: LANE_SWITCH_SCRIPTS[target],
        exit_code: null,
        message: null,
        error: null,
        started_at: new Date(service.now()).toISOString(),
        finished_at: null,
      };
      yield* service.start(job);
      return { kind: "accepted" as const, job: jobView(job) };
    });
  }

  private resolveScript(target: ExclusiveLane): string | null {
    const scriptsDirectory = this.config.scriptsDirectory;
    if (!scriptsDirectory) return null;
    return resolveAllowlistedScript(scriptsDirectory, LANE_SWITCH_SCRIPTS[target]);
  }

  private childEnvironment(): NodeJS.ProcessEnv {
    const pathValue = process.env["PATH"] ?? "";
    const extra = this.config.lanePath;
    return {
      ...process.env,
      PATH: extra ? `${extra}${delimiter}${pathValue}` : pathValue,
      OMLX_PORT: String(this.config.omlxPort),
      DS4_PORT: String(this.config.ds4Port),
    };
  }

  private omlxApiKey(): string | null {
    const match = this.getProviders().find((provider) => provider.id.toLowerCase() === "omlx");
    const key = match?.api_key?.trim();
    return key ? key : null;
  }

  private logJob(job: MutableJob): void {
    const exit = job.exit_code === null ? "" : ` exit_code=${job.exit_code}`;
    const error = job.error ? ` error=${redactLogLine(job.error)}` : "";
    this.logger.info(
      `lane_switch from=${job.from_lane} to=${job.to_lane} script=${job.script} state=${job.state} id=${job.id}${exit}${error}`,
    );
  }

  private publishJob(job: MutableJob): Effect.Effect<void> {
    return this.eventManager.publish(new Event(CONTROLLER_EVENTS.LANE_SWITCH, jobView(job)));
  }

  private execute(job: MutableJob): Effect.Effect<void> {
    const service = this;
    return Effect.gen(function* () {
      service.logJob(job);
      yield* service.publishJob(job);
      const outcome = yield* service.runScript(job.to_lane, job);
      if (service.shuttingDown) return;
      const ready = yield* service.targetReady(job.to_lane);
      if (outcome.ok && ready) {
        job.state = "ready";
        job.exit_code = outcome.result.status;
        job.finished_at = new Date(service.now()).toISOString();
        service.logJob(job);
        yield* service.publishJob(job);
        return;
      }
      job.exit_code = outcome.result.status;
      job.error = outcome.error;
      if (canRestoreFrom(job.from_lane)) {
        job.state = "restoring";
        service.logJob(job);
        yield* service.publishJob(job);
        yield* service.runScript(inverseLane(job.to_lane), job);
      }
      job.state = "failed";
      job.finished_at = new Date(service.now()).toISOString();
      service.logJob(job);
      yield* service.publishJob(job);
    });
  }

  private runScript(
    target: ExclusiveLane,
    job: MutableJob,
  ): Effect.Effect<{ ok: boolean; result: AsyncCommandResult; error: string }> {
    const service = this;
    return Effect.gen(function* () {
      const scriptPath = service.resolveScript(target);
      if (!scriptPath) {
        const result: AsyncCommandResult = {
          status: null,
          stdout: "",
          stderr: "script not found",
          timedOut: false,
          signal: null,
        };
        return { ok: false, result, error: "script not found" };
      }
      const abort = service.runAbort;
      const result = yield* runCommandAsyncEffect("/bin/bash", [scriptPath], {
        timeoutMs: LANE_SWITCH_TIMEOUT_MS[target],
        ...(service.config.scriptsDirectory ? { cwd: service.config.scriptsDirectory } : {}),
        env: service.childEnvironment(),
        ...(abort ? { signal: abort.signal } : {}),
        onOutput: (chunk: string): void => {
          const line = lastNonEmptyLine(chunk);
          if (line) job.message = redactLogLine(line);
        },
      });
      if (result.timedOut) {
        return { ok: false, result, error: "timed out" };
      }
      if (result.status === null) {
        return {
          ok: false,
          result,
          error: redactLogLine(result.stderr || "spawn failed"),
        };
      }
      if (result.status !== 0) {
        return { ok: false, result, error: `exit ${result.status}` };
      }
      return { ok: true, result, error: "target lane is not ready" };
    });
  }

  private targetReady(target: ExclusiveLane): Effect.Effect<boolean> {
    const service = this;
    return Effect.gen(function* () {
      service.lastProbe = null;
      const residency = yield* service.probeFresh();
      return residency[target].ready;
    });
  }

  private loadResidency(): Effect.Effect<LaneResidencyInternal> {
    const service = this;
    return Effect.gen(function* () {
      if (service.inFlight) return yield* Fiber.join(service.inFlight);
      const fiber = yield* service.runProbe().pipe(
        Effect.tap((residency) =>
          Effect.sync(() => {
            service.lastProbe = { at: service.now(), residency };
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            service.inFlight = null;
          }),
        ),
        Effect.forkDetach({ startImmediately: true }),
      );
      service.inFlight = fiber;
      return yield* Fiber.join(fiber);
    });
  }

  private runProbe(): Effect.Effect<LaneResidencyInternal> {
    return Effect.all(
      [
        this.probePort(this.config.omlxPort, this.omlxApiKey()),
        this.probePort(this.config.ds4Port, null),
      ],
      { concurrency: 2 },
    ).pipe(
      Effect.map(([omlx, ds4]) => {
        const resident_lane: ResidentLane =
          omlx.ready && ds4.ready ? "conflict" : omlx.ready ? "omlx" : ds4.ready ? "ds4" : "none";
        return { resident_lane, omlx, ds4 };
      }),
    );
  }

  private probePort(port: number, apiKey: string | null): Effect.Effect<LaneProbeInternal> {
    const service = this;
    const url = `http://127.0.0.1:${port}/v1/models`;
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    return Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(service.probeTimeoutMs),
        }),
      catch: (source) => source,
    }).pipe(
      Effect.flatMap((response) => {
        const probe = emptyProbe(port);
        probe.ready = true;
        if (response.status >= 200 && response.status < 300) {
          return Effect.tryPromise({
            try: () => response.json(),
            catch: (source) => source,
          }).pipe(
            Effect.map((payload) => {
              service.applyModelsPayload(probe, payload);
              return probe;
            }),
            Effect.catch(() => Effect.succeed(probe)),
          );
        }
        return Effect.tryPromise({
          try: () => response.arrayBuffer(),
          catch: (source) => source,
        }).pipe(
          Effect.catch(() => Effect.void),
          Effect.as(probe),
        );
      }),
      Effect.catch(() => Effect.succeed(emptyProbe(port))),
    );
  }

  private applyModelsPayload(probe: LaneProbeInternal, payload: unknown): void {
    if (!payload || typeof payload !== "object" || !("data" in payload)) return;
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) return;
    for (const entry of data) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as { id?: unknown; max_model_len?: unknown };
      const id = typeof record.id === "string" ? record.id.trim() : "";
      if (!id) continue;
      probe.model_ids.push(id);
      if (typeof record.max_model_len === "number" && Number.isFinite(record.max_model_len)) {
        probe.maxModelLengthById[id] = record.max_model_len;
      }
    }
  }
}
