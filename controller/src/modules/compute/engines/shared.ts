import type {
  ComputeEngineSpec,
  EngineSupport,
  HealthCheck,
  LaunchPlan,
  LaunchRequest,
  MetricMap,
  EngineRuntimeKind,
  ServingOptions,
} from "../contracts";

export const CONTAINER_MODEL_DIR = "/models";

export const health = (path: string, readyDeadlineMs: number, intervalMs = 2_000): HealthCheck => ({
  path,
  readyDeadlineMs,
  intervalMs,
});

export const unsupported = (reason: string): EngineSupport => ({ ok: false, reason });
export const supported = (...runtimes: EngineRuntimeKind[]): EngineSupport => ({
  ok: true,
  runtimes,
});

export const noMetrics: MetricMap = {
  requestsRunning: [],
  requestsWaiting: [],
  kvCacheUtilization: [],
  promptTokensTotal: [],
  generationTokensTotal: [],
};

export const prometheusMetrics = (prefix: string, kvName: string): MetricMap => ({
  requestsRunning: [`${prefix}:num_requests_running`],
  requestsWaiting: [`${prefix}:num_requests_waiting`],
  kvCacheUtilization: [`${prefix}:${kvName}`],
  promptTokensTotal: [`${prefix}:prompt_tokens_total`],
  generationTokensTotal: [`${prefix}:generation_tokens_total`],
});

export interface FlagSpec {
  readonly flag: string;
  readonly companion?: string;
}

export type TuningKey = keyof ServingOptions;
export type Spelling = Readonly<Partial<Record<TuningKey, FlagSpec>>>;

const TUNING_ORDER: readonly TuningKey[] = [
  "tensorParallel",
  "pipelineParallel",
  "maxContextLength",
  "memoryFraction",
  "maxConcurrentRequests",
  "kvCacheDtype",
  "dtype",
  "quantization",
  "trustRemoteCode",
  "toolCallParser",
  "reasoningParser",
];

const PARALLEL_KEYS = new Set<TuningKey>(["tensorParallel", "pipelineParallel"]);

const shouldEmit = (key: TuningKey, value: ServingOptions[TuningKey]): boolean => {
  if (value === null || value === undefined || value === false) return false;
  if (value === "auto") return false;
  if (typeof value === "number") return PARALLEL_KEYS.has(key) ? value > 1 : value > 0;
  if (typeof value === "string") return value.length > 0;
  return true;
};

export const tuningArguments = (options: ServingOptions, spelling: Spelling): string[] => {
  const args: string[] = [];
  for (const key of TUNING_ORDER) {
    const spec = spelling[key];
    const value = options[key];
    if (!spec || !shouldEmit(key, value)) continue;
    if (typeof value === "boolean") args.push(spec.flag);
    else args.push(spec.flag, String(value));
    if (spec.companion) args.push(spec.companion);
  }
  return args;
};

const flagKey = (token: string): string | null =>
  token.startsWith("--") ? (token.split("=")[0] ?? token).slice(2) : null;

export const mergeArguments = (base: readonly string[], extra: readonly string[]): string[] => {
  const overridden = new Set(extra.map(flagKey).filter((key): key is string => key !== null));
  const merged: string[] = [];
  for (let index = 0; index < base.length; index += 1) {
    const token = base[index] ?? "";
    const key = flagKey(token);
    if (key === null || !overridden.has(key)) {
      merged.push(token);
      continue;
    }
    const next = base[index + 1];
    if (next !== undefined && flagKey(next) === null && !token.includes("=")) index += 1;
  }
  return [...merged, ...extra];
};

export const modelReference = (request: LaunchRequest): string =>
  request.runtime === "docker" ? CONTAINER_MODEL_DIR : request.modelPath;

export const modelMounts = (request: LaunchRequest): LaunchPlan["mounts"] =>
  request.runtime === "docker"
    ? [{ from: request.modelPath, to: CONTAINER_MODEL_DIR, readOnly: true }]
    : [];

export const serveAddress = (request: LaunchRequest, listenPort: number): string[] => [
  "--host",
  request.runtime === "docker" ? "0.0.0.0" : "127.0.0.1",
  "--port",
  String(listenPort),
];

export const serverArguments = (
  request: LaunchRequest,
  spec: ServerArgumentSpec,
  listenPort: number,
): string[] => {
  const model = modelReference(request);
  const base = [
    ...(spec.subcommand ?? []),
    ...(spec.modelFlag === null ? [model] : [spec.modelFlag, model]),
    ...(spec.servedNameFlag ? [spec.servedNameFlag, request.servedModelName] : []),
    ...serveAddress(request, listenPort),
    ...tuningArguments(request.options, spec.spelling),
    ...(spec.defaults ?? []),
  ];
  return mergeArguments(base, request.extraArgs);
};

export type ServerArgumentSpec = {
  readonly subcommand?: readonly string[];
  readonly modelFlag: string | null;
  readonly servedNameFlag: string | null;
  readonly spelling: Spelling;
  readonly defaults?: readonly string[];
};

export const plan = (
  request: LaunchRequest,
  parts: {
    readonly args: readonly string[];
    readonly health: HealthCheck;
    readonly listenPort: number;
    readonly image?: string | null;
    readonly env?: Readonly<Record<string, string>>;
  },
): LaunchPlan => {
  const image = request.dockerImage ?? parts.image;
  return {
    kind: request.runtime,
    argv: request.runtime === "docker" ? [...parts.args] : [request.binary, ...parts.args],
    ...(request.runtime === "docker" && image ? { image } : {}),
    env: { ...request.env, ...(parts.env ?? {}) },
    ports: [{ container: parts.listenPort, host: request.port }],
    mounts: modelMounts(request),
    devices: request.devices,
    health: parts.health,
  };
};

type ServerEngineDefinition<Id extends ComputeEngineSpec["id"]> = Omit<
  ComputeEngineSpec,
  "id" | "health" | "plan"
> & {
  readonly id: Id;
  readonly healthPath: string;
  readonly readyDeadlineMs: number;
  readonly server: ServerArgumentSpec | ((request: LaunchRequest) => ServerArgumentSpec);
};

export const serverEngine = <Id extends ComputeEngineSpec["id"]>(
  definition: ServerEngineDefinition<Id>,
): ComputeEngineSpec & { readonly id: Id } => {
  const { healthPath, readyDeadlineMs, server, ...spec } = definition;
  const healthCheck = health(healthPath, readyDeadlineMs);
  return {
    ...spec,
    health: healthCheck,
    plan: (request): LaunchPlan => {
      const argumentsSpec = typeof server === "function" ? server(request) : server;
      return plan(request, {
        args: serverArguments(request, argumentsSpec, request.port),
        health: healthCheck,
        listenPort: request.port,
        ...(spec.image ? { image: spec.image(request.host) } : {}),
      });
    },
  };
};
