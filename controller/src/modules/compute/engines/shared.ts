import type {
  EngineSupport,
  HealthCheck,
  LaunchPlan,
  LaunchRequest,
  MetricMap,
  EngineRuntimeKind,
  ServingOptions,
} from "../contracts";

/** Model directory inside a container. Every image mounts the model at the same path, so
 *  the argv is identical whether a plan runs as a process or a container. */
export const CONTAINER_MODEL_DIR = "/models";

export const health = (path: string, readyDeadlineMs: number, intervalMs = 2_000): HealthCheck => ({
  path,
  readyDeadlineMs,
  intervalMs,
});

export const unsupported = (reason: string): EngineSupport => ({ ok: false, reason });
export const supported = (...runtimes: EngineRuntimeKind[]): EngineSupport => ({ ok: true, runtimes });

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


/**
 * How one engine spells one canonical knob. `null` in a spelling table means the engine
 * has no equivalent, and the knob is dropped rather than guessed at.
 *
 * This table plus `tuningArguments` is what collapses the two structurally identical 40-line
 * argument builders (vllm-spec.ts:107-148 and sglang-spec.ts:46-92) into data.
 */
export interface FlagSpec {
  readonly flag: string;
  /** Emitted alongside the flag when the knob is set — vLLM's tool parser needs
   *  `--enable-auto-tool-choice` next to it, SGLang's does not. */
  readonly companion?: string;
}

export type TuningKey = keyof ServingOptions;
export type Spelling = Readonly<Partial<Record<TuningKey, FlagSpec>>>;

/** Fixed emission order, so two engines with the same knobs produce comparable argv. */
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

const shouldEmit = (key: TuningKey, options: ServingOptions): boolean => {
  switch (key) {
    case "tensorParallel":
    case "pipelineParallel":
      return options[key] > 1;
    case "maxContextLength":
    case "memoryFraction":
    case "maxConcurrentRequests":
      return options[key] > 0;
    case "trustRemoteCode":
      return options[key];
    case "kvCacheDtype":
    case "dtype":
    case "quantization":
    case "toolCallParser":
    case "reasoningParser": {
      const value = options[key];
      return value !== null && value !== "" && value !== "auto";
    }
  }
};

export const tuningArguments = (options: ServingOptions, spelling: Spelling): string[] => {
  const args: string[] = [];
  for (const key of TUNING_ORDER) {
    const spec = spelling[key];
    const value = options[key];
    if (!spec || !shouldEmit(key, options)) continue;
    if (key === "trustRemoteCode") args.push(spec.flag);
    else args.push(spec.flag, String(value));
    if (spec.companion) args.push(spec.companion);
  }
  return args;
};

/** The flag key a token represents, or null when it is a value rather than a flag. */
const flagKey = (token: string): string | null =>
  token.startsWith("--") ? (token.split("=")[0] ?? token).slice(2) : null;

/**
 * Append recipe overrides so they always win: any base flag the user also supplied is
 * dropped first. Without this, both spellings reach the engine and which one applies is
 * left to argparse.
 */
export const mergeArguments = (base: readonly string[], extra: readonly string[]): string[] => {
  const overridden = new Set(
    extra.map(flagKey).filter((key): key is string => key !== null),
  );
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

/** Containers listen on all interfaces so the published port reaches them; processes bind
 *  loopback, because the controller proxies them and nothing else should connect. */
export const serveAddress = (request: LaunchRequest, listenPort: number): string[] => [
  "--host",
  request.runtime === "docker" ? "0.0.0.0" : "127.0.0.1",
  "--port",
  String(listenPort),
];

export const serverArguments = (
  request: LaunchRequest,
  spec: {
    readonly subcommand?: readonly string[];
    readonly modelFlag: string | null;
    readonly servedNameFlag: string | null;
    readonly spelling: Spelling;
    readonly defaults?: readonly string[];
  },
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
  const launchPlan: LaunchPlan = {
    kind: request.runtime,
    argv: request.runtime === "docker" ? [...parts.args] : [request.binary, ...parts.args],
    env: { ...request.env, ...parts.env },
    ports: [{ container: parts.listenPort, host: request.port }],
    mounts: modelMounts(request),
    devices: request.devices,
    health: parts.health,
  };
  if (request.runtime === "docker" && image) {
    return { ...launchPlan, image };
  }
  return launchPlan;
};
