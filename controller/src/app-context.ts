import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Context, Effect, Layer, Schema } from "effect";
import { createConfig, type Config } from "./config/env";
import { createLogger, resolveLogLevel, type Logger } from "./core/logger";
import { primaryLogPathFor } from "./core/log-files";
import { DownloadManager } from "./modules/engines/downloads/download-manager";
import { DownloadStore } from "./modules/engines/downloads/download-store";
import {
  createLaunchFailureBudget,
  type LaunchFailureBudget,
} from "./modules/engines/launch-failure-budget";
import { createComputeBridge, type ComputeBridge } from "./modules/compute/bridge";
import { makeCompute, type Compute } from "./modules/compute/service";
import { shutdownEngineJobs } from "./modules/engines/runtimes/engine-jobs";
import { shutdownRuntimeInfo } from "./modules/engines/runtimes/runtime-info";
import { RecipeStore } from "./modules/models/recipes/recipe-store";
import { SpeechService } from "./modules/speech/service";
import { EventManager } from "./modules/system/event-manager";
import { createGpuLeaseRegistry, type GpuLeaseRegistry } from "./modules/system/gpu-leases";
import { PeakMetricsStore, LifetimeMetricsStore } from "./modules/system/metrics-store";
import { getGpuInfo } from "./modules/system/platform/gpu";
import { ControllerRequestStore } from "./stores/controller-request-store";
import { ControllerSettingsStore } from "./stores/controller-settings-store";
import { InferenceRequestStore } from "./stores/inference-request-store";
import { RigStore } from "./stores/rig-store";
import { ScientificWorkbenchStore } from "./modules/workbench/store";
import { KubeRayGateway } from "./modules/workbench/kuberay-gateway";
import { NotebookGateway } from "./modules/workbench/notebook-gateway";
import { MachineEnrollmentService } from "./modules/machines/enrollment-service";
import { ProviderSecretStore } from "./services/provider-secret-store";

export interface AppContext {
  config: Config;
  logger: Logger;
  eventManager: EventManager;
  launchFailureBudget: LaunchFailureBudget;
  downloadManager: DownloadManager;
  compute: Compute;
  bridge: ComputeBridge;
  gpuLeaseRegistry: GpuLeaseRegistry;
  speechService: SpeechService;
  kubeRayGateway: KubeRayGateway | null;
  notebookGateway: NotebookGateway;
  machineEnrollmentService: MachineEnrollmentService;
  providerSecretStore: ProviderSecretStore;
  stores: {
    recipeStore: RecipeStore;
    downloadStore: DownloadStore;
    peakMetricsStore: PeakMetricsStore;
    lifetimeMetricsStore: LifetimeMetricsStore;
    inferenceRequestStore: InferenceRequestStore;
    controllerSettingsStore: ControllerSettingsStore;
    controllerRequestStore: ControllerRequestStore;
    rigStore: RigStore;
    scientificWorkbenchStore: ScientificWorkbenchStore;
  };
}

export class AppContextInitializationError extends Schema.TaggedErrorClass<AppContextInitializationError>()(
  "AppContextInitializationError",
  {
    operation: Schema.String,
    message: Schema.String,
    source: Schema.Unknown,
  },
) {}

export type ModelsDirectoryState = "exists" | "created" | "missing";

let modelsDirectoryState: ModelsDirectoryState = "missing";

export const getModelsDirectoryState = (): ModelsDirectoryState => modelsDirectoryState;

const initializationError = (operation: string, source: unknown): AppContextInitializationError =>
  new AppContextInitializationError({ operation, message: String(source), source });

const initialize = <A, E>(
  operation: string,
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, AppContextInitializationError> =>
  effect.pipe(Effect.mapError((source) => initializationError(operation, source)));

const initializeSync = <A>(
  operation: string,
  make: () => A,
): Effect.Effect<A, AppContextInitializationError> =>
  Effect.try({ try: make, catch: (source) => initializationError(operation, source) });

const releaseSafely = (
  operation: string,
  logger: Logger,
  effect: Effect.Effect<void, unknown>,
): Effect.Effect<void> =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => logger.error(`${operation} failed`, { error: String(error) })),
    ),
  );

const ensureModelsDirectory = (modelsDirectory: string): Effect.Effect<ModelsDirectoryState> => {
  if (existsSync(modelsDirectory)) return Effect.succeed("exists");
  return Effect.tryPromise({
    try: () => mkdir(modelsDirectory, { recursive: true }),
    catch: () => undefined,
  }).pipe(
    Effect.as("created" as const),
    Effect.catch(() => Effect.succeed("missing" as const)),
  );
};

export const makeAppContext = Effect.gen(function* () {
  const config = yield* initializeSync("config.load", createConfig);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(config.host.toLowerCase());
  const providerSecretStore = yield* initializeSync(
    "provider-secret-store.open",
    () =>
      new ProviderSecretStore(
        config.data_dir,
        !loopback ||
          (config.enterprise_auth !== undefined && config.enterprise_auth.mode !== "local"),
      ),
  );
  yield* initialize(
    "data-directory.create",
    Effect.tryPromise({
      try: () => mkdir(config.data_dir, { recursive: true }),
      catch: (source) => source,
    }),
  );
  const dbPath = resolve(config.db_path);
  const eventManager = new EventManager();
  const logger = yield* Effect.acquireRelease(
    initializeSync("logger.open", () =>
      createLogger(resolveLogLevel("info"), {
        filePath: primaryLogPathFor(config.data_dir, "controller"),
        onLine: (line) => eventManager.publishLogLineUnsafe("controller", line),
      }),
    ),
    (resource) => resource.shutdown(),
  );
  yield* Effect.acquireRelease(Effect.succeed(eventManager), (resource) =>
    releaseSafely("event-manager.shutdown", logger, resource.shutdown()),
  );

  modelsDirectoryState = yield* ensureModelsDirectory(config.models_dir);
  if (modelsDirectoryState === "missing") {
    logger.warn(
      `Models directory ${config.models_dir} does not exist and could not be created; set LOCAL_STUDIO_MODELS_DIR to a writable path`,
    );
  }

  const recipeStore = yield* Effect.acquireRelease(
    initialize("recipe-store.open", RecipeStore.open(dbPath)),
    (resource) => releaseSafely("recipe-store.close", logger, resource.close()),
  );
  const downloadStore = yield* Effect.acquireRelease(
    initialize("download-store.open", DownloadStore.make(dbPath)),
    (resource) => releaseSafely("download-store.close", logger, resource.close()),
  );
  const peakMetricsStore = yield* Effect.acquireRelease(
    initializeSync("peak-metrics-store.open", () => new PeakMetricsStore(dbPath)),
    (resource) => releaseSafely("peak-metrics-store.close", logger, resource.close()),
  );
  const lifetimeMetricsStore = yield* Effect.acquireRelease(
    initializeSync("lifetime-metrics-store.open", () => new LifetimeMetricsStore(dbPath)),
    (resource) => releaseSafely("lifetime-metrics-store.close", logger, resource.close()),
  );
  const inferenceRequestStore = yield* Effect.acquireRelease(
    initializeSync("inference-request-store.open", () => new InferenceRequestStore(dbPath)),
    (resource) => releaseSafely("inference-request-store.close", logger, resource.close()),
  );
  const controllerSettingsStore = yield* Effect.acquireRelease(
    initializeSync("controller-settings-store.open", () => new ControllerSettingsStore(dbPath)),
    (resource) => releaseSafely("controller-settings-store.close", logger, resource.close()),
  );
  const controllerRequestStore = yield* Effect.acquireRelease(
    initializeSync("controller-request-store.open", () => new ControllerRequestStore(dbPath)),
    (resource) => releaseSafely("controller-request-store.close", logger, resource.close()),
  );
  const rigStore = yield* Effect.acquireRelease(
    initializeSync("rig-store.open", () => new RigStore(dbPath)),
    (resource) => releaseSafely("rig-store.close", logger, resource.close()),
  );
  const scientificWorkbenchStore = yield* Effect.acquireRelease(
    initializeSync("scientific-workbench-store.open", () => new ScientificWorkbenchStore(dbPath)),
    (resource) => releaseSafely("scientific-workbench-store.close", logger, resource.close()),
  );
  const kubeRayGateway =
    config.kuberay_api_url && config.kuberay_token_file
      ? new KubeRayGateway({
          apiUrl: config.kuberay_api_url,
          tokenFile: config.kuberay_token_file,
          ...(config.kuberay_ca_file ? { caFile: config.kuberay_ca_file } : {}),
        })
      : null;
  yield* initialize(
    "scientific-workbench.notebook-root",
    Effect.tryPromise({
      try: () => mkdir(config.notebook_root, { recursive: true }),
      catch: (source) => source,
    }),
  );
  const sampleNotebook = resolve(config.notebook_root, "agent-collaboration.ipynb");
  if (!existsSync(sampleNotebook)) {
    const bundledSample = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../assets/notebooks/agent-collaboration.ipynb",
    );
    yield* initialize(
      "scientific-workbench.sample-notebook",
      Effect.tryPromise({
        try: () => copyFile(bundledSample, sampleNotebook),
        catch: (source) => source,
      }),
    );
  }
  const pythonSmolvmSample = resolve(
    config.notebook_root,
    "agent-collaboration-python-smolvm.ipynb",
  );
  if (!existsSync(pythonSmolvmSample)) {
    const bundledSample = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../assets/notebooks/agent-collaboration.ipynb",
    );
    yield* initialize(
      "scientific-workbench.python-smolvm-sample-notebook",
      Effect.tryPromise({
        try: () => copyFile(bundledSample, pythonSmolvmSample),
        catch: (source) => source,
      }),
    );
  }
  const nodeSampleNotebook = resolve(config.notebook_root, "agent-collaboration-node.ipynb");
  if (!existsSync(nodeSampleNotebook)) {
    const bundledNodeSample = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../assets/notebooks/agent-collaboration-node.ipynb",
    );
    yield* initialize(
      "scientific-workbench.node-sample-notebook",
      Effect.tryPromise({
        try: () => copyFile(bundledNodeSample, nodeSampleNotebook),
        catch: (source) => source,
      }),
    );
  }
  const notebookGateway = new NotebookGateway(
    config.notebook_root,
    config.notebook_python,
    undefined,
    config.notebook_smolvm,
    config.notebook_node_image,
    undefined,
    config.notebook_python_image,
  );
  const machineEnrollmentService = new MachineEnrollmentService(config.data_dir);
  yield* initialize(
    "lifetime-metrics-store.initialize",
    lifetimeMetricsStore.ensureFirstStartedEffect(),
  );

  const launchFailureBudget = createLaunchFailureBudget();
  const compute = yield* initializeSync("compute.open", () => makeCompute(config, eventManager));
  const bridge = createComputeBridge({
    config,
    compute: compute.service,
    store: compute.store,
    getRecipe: (recipeId) => recipeStore.get(recipeId),
  });
  const gpuLeaseRegistry = createGpuLeaseRegistry({
    store: compute.store,
    recordAlive: (record) =>
      compute.service.stateOf(record).pipe(Effect.map((state) => state !== "exited")),
  });
  const downloadManager = yield* initialize(
    "download-manager.open",
    DownloadManager.make(config, downloadStore, eventManager, logger),
  );
  yield* Effect.acquireRelease(Effect.void, () =>
    releaseSafely("runtime-info.shutdown", logger, shutdownRuntimeInfo()),
  );
  yield* Effect.acquireRelease(Effect.void, () =>
    releaseSafely("engine-jobs.shutdown", logger, shutdownEngineJobs()),
  );
  yield* Effect.acquireRelease(Effect.succeed(downloadManager), (resource) =>
    releaseSafely("download-manager.shutdown", logger, resource.shutdown()),
  );
  const speechService = yield* Effect.acquireRelease(
    initializeSync(
      "speech-service.open",
      () =>
        new SpeechService({
          dataDirectory: config.data_dir,
          databasePath: dbPath,
          engine: {
            getCurrentProcess: (): ReturnType<ComputeBridge["findInferenceProcess"]> =>
              bridge.findInferenceProcess(),
            getCurrentRecipe: (): ReturnType<ComputeBridge["getCurrentRecipe"]> =>
              bridge.getCurrentRecipe(),
          },
          gpuLeaseRegistry,
          gpuInfo: getGpuInfo,
        }),
    ),
    (resource) => releaseSafely("speech-service.shutdown", logger, resource.shutdown()),
  );

  return {
    config,
    logger,
    eventManager,
    launchFailureBudget,
    downloadManager,
    compute,
    bridge,
    gpuLeaseRegistry,
    speechService,
    kubeRayGateway,
    notebookGateway,
    machineEnrollmentService,
    providerSecretStore,
    stores: {
      recipeStore,
      downloadStore,
      peakMetricsStore,
      lifetimeMetricsStore,
      inferenceRequestStore,
      controllerSettingsStore,
      controllerRequestStore,
      rigStore,
      scientificWorkbenchStore,
    },
  } satisfies AppContext;
});

export class AppContextService extends Context.Service<AppContextService, AppContext>()(
  "local-studio/AppContext",
) {}

export const AppContextLive = Layer.effect(AppContextService, makeAppContext);
