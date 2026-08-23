import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { createConfig, type Config } from "./config/env";
import { savePersistedConfig } from "./config/persisted-config";
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
import { EventManager } from "./modules/system/event-manager";
import { PeakMetricsStore, LifetimeMetricsStore } from "./modules/system/metrics-store";
import { ControllerRequestStore } from "./stores/controller-request-store";
import { ControllerSettingsStore } from "./stores/controller-settings-store";
import { InferenceRequestStore } from "./stores/inference-request-store";
import { RigStore } from "./stores/rig-store";
import { CodexProviderService } from "./services/codex-provider";
import { CursorProviderService } from "./services/cursor-provider";
import { HeadProviderService } from "./services/head-provider";
import { OpenRouterProviderService } from "./services/openrouter-provider";
import { RigNodeCredentialStore } from "./stores/rig-node-credential-store";
import { WorkerPool } from "./modules/federation/worker-pool";
import { SessionMetadataStore } from "./stores/session-metadata-store";

export interface AppContext {
  config: Config;
  logger: Logger;
  eventManager: EventManager;
  launchFailureBudget: LaunchFailureBudget;
  workerPool: WorkerPool;
  downloadManager: DownloadManager;
  compute: Compute;
  bridge: ComputeBridge;
  headProviders: HeadProviderService;
  stores: {
    recipeStore: RecipeStore;
    downloadStore: DownloadStore;
    peakMetricsStore: PeakMetricsStore;
    lifetimeMetricsStore: LifetimeMetricsStore;
    inferenceRequestStore: InferenceRequestStore;
    controllerSettingsStore: ControllerSettingsStore;
    controllerRequestStore: ControllerRequestStore;
    rigStore: RigStore;
    rigNodeCredentialStore: RigNodeCredentialStore;
    sessionMetadataStore: SessionMetadataStore;
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
    initializeSync(
      "inference-request-store.open",
      () => new InferenceRequestStore(dbPath, config.controller_mode),
    ),
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
  const rigNodeCredentialStore = yield* Effect.acquireRelease(
    initializeSync("rig-node-credential-store.open", () => new RigNodeCredentialStore(dbPath)),
    (resource) => releaseSafely("rig-node-credential-store.close", logger, resource.close()),
  );
  const sessionMetadataStore = yield* Effect.acquireRelease(
    initializeSync("session-metadata-store.open", () => new SessionMetadataStore(dbPath)),
    (resource) => releaseSafely("session-metadata-store.close", logger, resource.close()),
  );
  const workerPool = new WorkerPool(rigStore, rigNodeCredentialStore, logger);
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
  const openrouterProvider = new OpenRouterProviderService(config.data_dir);
  const legacyOpenRouter = config.providers.find(
    (provider) => provider.id.toLowerCase() === "openrouter",
  );
  if (legacyOpenRouter) {
    if (legacyOpenRouter.api_key.trim()) {
      yield* initialize(
        "openrouter-credentials.migrate",
        Effect.tryPromise({
          try: () => openrouterProvider.migrateApiKey(legacyOpenRouter.api_key),
          catch: (source) => source,
        }),
      );
    }
    config.providers = config.providers.filter(
      (provider) => provider.id.toLowerCase() !== "openrouter",
    );
    yield* initializeSync("openrouter-provider-config.remove", () =>
      savePersistedConfig(config.data_dir, { providers: config.providers }),
    );
  }
  const cursorProvider = yield* Effect.tryPromise({
    try: () => CursorProviderService.open(config.data_dir),
    catch: (source) => source,
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("Cursor provider initialization failed", { error: String(error) });
        return null;
      }),
    ),
  );
  const headProviders = yield* Effect.acquireRelease(
    initializeSync(
      "head-providers.open",
      () =>
        new HeadProviderService([
          new CodexProviderService(config.data_dir),
          openrouterProvider,
          ...(cursorProvider ? [cursorProvider] : []),
        ]),
    ),
    (resource) => Effect.sync(() => resource.shutdown()),
  );
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

  return {
    config,
    logger,
    eventManager,
    launchFailureBudget,
    workerPool,
    downloadManager,
    compute,
    bridge,
    headProviders,
    stores: {
      recipeStore,
      downloadStore,
      peakMetricsStore,
      lifetimeMetricsStore,
      inferenceRequestStore,
      controllerSettingsStore,
      controllerRequestStore,
      rigStore,
      rigNodeCredentialStore,
      sessionMetadataStore,
    },
  } satisfies AppContext;
});

export class AppContextService extends Context.Service<AppContextService, AppContext>()(
  "local-studio/AppContext",
) {}

export const AppContextLive = Layer.effect(AppContextService, makeAppContext);
