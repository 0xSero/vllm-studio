import {
  FEDERATION_HOP_HEADER,
  WorkerModelListSchema,
  type WorkerModel,
  type WorkerStatus,
} from "@local-studio/contracts/federation";
import { RigsPayloadSchema, type RigNode } from "@local-studio/contracts/rigs";
import { Effect, Schema } from "effect";
import type { Logger } from "../../core/logger";
import type { RigNodeCredentialStore } from "../../stores/rig-node-credential-store";
import type { RigStore } from "../../stores/rig-store";

export interface WorkerTarget {
  id: string;
  name: string;
  address: string;
  apiKey: string;
}

export class WorkerRequestError extends Schema.TaggedErrorClass<WorkerRequestError>()(
  "WorkerRequestError",
  {
    workerId: Schema.String,
    message: Schema.String,
    source: Schema.optional(Schema.Unknown),
  },
) {}

const normalizedAddress = (address: string): string => {
  const candidate = address.trim();
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Worker address must use HTTP or HTTPS");
  }
  return url.origin;
};

const workerNodes = (rigStore: RigStore): RigNode[] => {
  const seen = new Set<string>();
  const nodes: RigNode[] = [];
  for (const rig of rigStore.list()) {
    for (const node of rig.nodes) {
      if (node.role !== "worker" || !node.address || seen.has(node.id)) continue;
      seen.add(node.id);
      nodes.push(node);
    }
  }
  return nodes;
};

export class WorkerPool {
  private readonly activeStreams = new Map<string, number>();

  public constructor(
    private readonly rigStore: RigStore,
    private readonly credentialStore: RigNodeCredentialStore,
    private readonly logger: Logger,
  ) {}

  public targets(): Effect.Effect<WorkerTarget[], WorkerRequestError> {
    return Effect.try({
      try: () =>
        workerNodes(this.rigStore).map((node) => ({
          id: node.id,
          name: node.name,
          address: normalizedAddress(node.address ?? ""),
          apiKey: this.credentialStore.get(node.id),
        })),
      catch: (source) =>
        new WorkerRequestError({
          workerId: "configuration",
          message: `Invalid Worker configuration: ${String(source)}`,
          source,
        }),
    });
  }

  public target(workerId: string): Effect.Effect<WorkerTarget | null, WorkerRequestError> {
    return this.targets().pipe(
      Effect.map((targets) => targets.find((target) => target.id === workerId) ?? null),
    );
  }

  public fetch(
    target: WorkerTarget,
    path: string,
    init: RequestInit = {},
    timeoutMs = 30_000,
  ): Effect.Effect<Response, WorkerRequestError> {
    const headers = new Headers(init.headers);
    headers.delete("authorization");
    headers.delete("x-api-key");
    headers.delete("host");
    headers.delete("content-length");
    headers.set(FEDERATION_HOP_HEADER, "head");
    if (target.apiKey) headers.set("authorization", `Bearer ${target.apiKey}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const requestSignal = init.signal;
    return Effect.tryPromise({
      try: (effectSignal) =>
        fetch(`${target.address}${path}`, {
          ...init,
          headers,
          signal: requestSignal
            ? AbortSignal.any([requestSignal, effectSignal, controller.signal])
            : AbortSignal.any([effectSignal, controller.signal]),
        }),
      catch: (source) =>
        new WorkerRequestError({
          workerId: target.id,
          message: `Worker ${target.name} is unavailable`,
          source,
        }),
    }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timeout))));
  }

  public statuses(includeHardware = false): Effect.Effect<WorkerStatus[]> {
    return this.targets().pipe(
      Effect.flatMap((targets) =>
        Effect.forEach(targets, (target) => this.probe(target, includeHardware), {
          concurrency: "unbounded",
        }),
      ),
      Effect.catch((error) => {
        this.logger.warn("Could not load Worker configuration", { error: String(error) });
        return Effect.succeed([]);
      }),
    );
  }

  public selectServing(
    model: string,
    excluded = new Set<string>(),
  ): Effect.Effect<WorkerTarget | null> {
    return Effect.all([this.targets(), this.statuses()]).pipe(
      Effect.map(([targets, statuses]) => {
        const serving = statuses
          .filter(
            (status) =>
              status.healthy &&
              !excluded.has(status.id) &&
              status.models.some((entry) => entry.id === model && entry.active === true),
          )
          .sort(
            (left, right) =>
              left.active_streams - right.active_streams || left.name.localeCompare(right.name),
          );
        const selected = serving[0];
        return selected ? (targets.find((target) => target.id === selected.id) ?? null) : null;
      }),
      Effect.catch(() => Effect.succeed(null)),
    );
  }

  public acquire(workerId: string): void {
    this.activeStreams.set(workerId, (this.activeStreams.get(workerId) ?? 0) + 1);
  }

  public release(workerId: string): void {
    const next = Math.max(0, (this.activeStreams.get(workerId) ?? 1) - 1);
    if (next === 0) this.activeStreams.delete(workerId);
    else this.activeStreams.set(workerId, next);
  }

  private probe(target: WorkerTarget, includeHardware: boolean): Effect.Effect<WorkerStatus> {
    const checkedAt = new Date().toISOString();
    const models = this.fetch(target, "/v1/models", { method: "GET" }, 3_000).pipe(
      Effect.flatMap((response) =>
        response.ok
          ? Effect.tryPromise({
              try: () => response.json(),
              catch: (source) =>
                new WorkerRequestError({
                  workerId: target.id,
                  message: `Worker ${target.name} returned invalid model data`,
                  source,
                }),
            }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(WorkerModelListSchema)))
          : Effect.fail(
              new WorkerRequestError({
                workerId: target.id,
                message: `Worker ${target.name} returned HTTP ${response.status}`,
              }),
            ),
      ),
    );
    const hardware = includeHardware
      ? this.fetch(target, "/studio/rigs", { method: "GET" }, 3_000).pipe(
          Effect.flatMap((response) =>
            response.ok
              ? Effect.tryPromise({
                  try: () => response.json(),
                  catch: (source) =>
                    new WorkerRequestError({
                      workerId: target.id,
                      message: `Worker ${target.name} returned invalid hardware data`,
                      source,
                    }),
                }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(RigsPayloadSchema)))
              : Effect.fail(
                  new WorkerRequestError({
                    workerId: target.id,
                    message: `Worker ${target.name} returned HTTP ${response.status}`,
                  }),
                ),
          ),
          Effect.map(
            (payload) =>
              payload.rigs
                .flatMap((rig) => rig.nodes)
                .find((node) => node.id === payload.local_node_id) ?? null,
          ),
          Effect.catch(() => Effect.succeed(null)),
        )
      : Effect.succeed(null);
    return Effect.all({ models, hardware }, { concurrency: "unbounded" }).pipe(
      Effect.map(({ models: payload, hardware: node }) => ({
        id: target.id,
        name: target.name,
        address: target.address,
        healthy: true,
        active_streams: this.activeStreams.get(target.id) ?? 0,
        models: [...payload.data] as WorkerModel[],
        hardware: node,
        checked_at: checkedAt,
        error: null,
      })),
      Effect.catch((error) =>
        Effect.succeed({
          id: target.id,
          name: target.name,
          address: target.address,
          healthy: false,
          active_streams: this.activeStreams.get(target.id) ?? 0,
          models: [],
          hardware: null,
          checked_at: checkedAt,
          error: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
  }
}
