"use client";

import { Effect, Result } from "effect";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api/client";
import type {
  EngineBackend,
  EngineJob,
  ModelRecommendation,
  RuntimeTarget,
  StudioDiagnostics,
  StudioSettings,
} from "@/lib/types";
import { useDownloads } from "@/hooks/use-downloads";
import { describeFailedEngineJob, isTerminalEngineJob } from "@/features/settings/runtime-targets";
import { buildStarterRecipe } from "./setup-helpers";

type ManagedSetupBackend = Extract<EngineBackend, "vllm" | "sglang" | "mlx">;

interface SetupBenchmarkResult {
  prompt_tokens: number;
  completion_tokens: number;
  total_time_s: number;
  generation_tps: number;
}

export function useSetup() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [modelsDir, setModelsDir] = useState("");
  const [diagnostics, setDiagnostics] = useState<StudioDiagnostics | null>(null);
  const [recommendations, setRecommendations] = useState<ModelRecommendation[]>([]);
  const [runtimeTargets, setRuntimeTargets] = useState<RuntimeTarget[]>([]);
  const [runtimeJobs, setRuntimeJobs] = useState<EngineJob[]>([]);
  const [maxVram, setMaxVram] = useState(0);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [manualModelId, setManualModelId] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [hardwareConfirmed, setHardwareConfirmed] = useState(false);
  const [configuringRecipe, setConfiguringRecipe] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [createdRecipeId, setCreatedRecipeId] = useState<string | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<SetupBenchmarkResult | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const downloadsState = useDownloads(2000);

  const activeDownload = useMemo(() => {
    if (!selectedModel) return null;
    return downloadsState.downloads.find((download) => download.model_id === selectedModel) ?? null;
  }, [downloadsState.downloads, selectedModel]);

  const refreshRuntimeState = useCallback(() => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const [targetPayload, jobPayload] = yield* Effect.all([
          requestEffect(() => api.getRuntimeTargets()).pipe(
            Effect.catch(() => Effect.succeed({ targets: [] })),
          ),
          requestEffect(() => api.getRuntimeJobs()).pipe(
            Effect.catch(() => Effect.succeed({ jobs: [] })),
          ),
        ] as const);
        setRuntimeTargets(targetPayload.targets);
        setRuntimeJobs(jobPayload.jobs);
      }),
    );
  }, []);

  const loadSecondarySetupData = useCallback((initialWarnings: string[]) => {
    return Effect.runPromise(
      Effect.gen(function* () {
        const warnings = [...initialWarnings];
        const [recommendationsResult, targetResult, jobResult] = yield* Effect.all([
          Effect.result(
            withSetupTimeoutEffect(api.getModelRecommendations(), "model recommendations"),
          ),
          Effect.result(withSetupTimeoutEffect(api.getRuntimeTargets(), "runtime targets")),
          Effect.result(withSetupTimeoutEffect(api.getRuntimeJobs(), "runtime jobs")),
        ] as const);

        if (Result.isSuccess(recommendationsResult)) {
          setRecommendations(recommendationsResult.success.recommendations || []);
          setMaxVram(recommendationsResult.success.max_vram_gb ?? 0);
        } else {
          setRecommendations([]);
          setMaxVram(0);
          warnings.push(
            `model recommendations: ${setupErrorMessage(recommendationsResult.failure)}`,
          );
        }

        if (Result.isSuccess(targetResult)) {
          setRuntimeTargets(targetResult.success.targets);
        } else {
          setRuntimeTargets([]);
          warnings.push(`runtime targets: ${setupErrorMessage(targetResult.failure)}`);
        }

        if (Result.isSuccess(jobResult)) {
          setRuntimeJobs(jobResult.success.jobs);
        } else {
          setRuntimeJobs([]);
          warnings.push(`runtime jobs: ${setupErrorMessage(jobResult.failure)}`);
        }

        setLoadWarning(formatLoadWarning(warnings));
      }),
    );
  }, []);

  const loadSetupData = useCallback(() => {
    return Effect.runPromise(
      Effect.gen(function* () {
        setLoading(true);
        setError(null);
        setLoadWarning(null);
        const warnings: string[] = [];
        const [settingsResult, diagnosticsResult] = yield* Effect.all([
          Effect.result(withSetupTimeoutEffect(api.getStudioSettings(), "settings")),
          Effect.result(
            withSetupTimeoutEffect(api.getStudioDiagnostics(), "controller diagnostics"),
          ),
        ] as const);

        if (Result.isSuccess(settingsResult)) {
          setSettings(settingsResult.success);
          setModelsDir(settingsResult.success.effective.models_dir);
        } else {
          setSettings(null);
          warnings.push(`settings: ${setupErrorMessage(settingsResult.failure)}`);
        }

        if (Result.isSuccess(diagnosticsResult)) {
          setDiagnostics(diagnosticsResult.success);
          if (Result.isFailure(settingsResult)) {
            setModelsDir(diagnosticsResult.success.config.models_dir || "");
          }
        } else {
          setDiagnostics(null);
          warnings.push(`controller diagnostics: ${setupErrorMessage(diagnosticsResult.failure)}`);
        }

        if (Result.isFailure(settingsResult) && Result.isFailure(diagnosticsResult)) {
          setError(CONTROLLER_UNREACHABLE_MESSAGE);
          return;
        }

        setRecommendations([]);
        setMaxVram(0);
        setRuntimeTargets([]);
        setRuntimeJobs([]);
        setLoadWarning(formatLoadWarning(warnings));

        void loadSecondarySetupData(warnings);
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            setLoading(false);
          }),
        ),
      ),
    );
  }, [loadSecondarySetupData]);

  const subscribeSetupData = useCallback(
    (_notify: () => void) => {
      void loadSetupData();
      return () => {};
    },
    [loadSetupData],
  );

  useSyncExternalStore(subscribeSetupData, getSetupSnapshot, getSetupSnapshot);

  const saveSettings = useCallback(() => {
    if (!modelsDir.trim()) {
      setError("Models directory is required.");
      return Promise.resolve();
    }
    setSavingSettings(true);
    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* requestEffect(() =>
          api.updateStudioSettings({ models_dir: modelsDir.trim() }),
        );
        setSettings(result);
        setModelsDir(result.effective.models_dir);
        setHardwareConfirmed(false);
        setStep(1);
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() =>
            setError(err instanceof Error ? err.message : "Failed to update settings"),
          ),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setSavingSettings(false);
          }),
        ),
      ),
    );
  }, [modelsDir]);

  const finishRuntimeJob = useCallback((jobId: string): Promise<EngineJob> => {
    return Effect.runPromise(finishRuntimeJobEffect(jobId, setRuntimeJobs));
  }, []);

  const runRuntimeJob = useCallback(
    (payload: { backend: EngineBackend; targetId?: string; type: "install" | "update" }) => {
      setUpgrading(true);
      setError(null);
      return Effect.runPromise(
        Effect.gen(function* () {
          const { job } = yield* requestEffect(() => api.createRuntimeJob(payload));
          setRuntimeJobs((current) => [
            job,
            ...current.filter((candidate) => candidate.id !== job.id),
          ]);
          const finalJob = yield* requestEffect(() => finishRuntimeJob(job.id));
          if (finalJob.status === "error") {
            setError(describeFailedEngineJob(finalJob));
          }
          const refreshed = yield* requestEffect(() => api.getStudioDiagnostics());
          setDiagnostics(refreshed);
        }).pipe(
          Effect.catch((err) =>
            Effect.sync(() => setError(err instanceof Error ? err.message : "Runtime job failed")),
          ),
          Effect.ensuring(
            Effect.gen(function* () {
              yield* requestEffect(() => refreshRuntimeState()).pipe(
                Effect.catch(() => Effect.void),
              );
              setUpgrading(false);
            }),
          ),
        ),
      );
    },
    [finishRuntimeJob, refreshRuntimeState],
  );

  const installRuntime = useCallback(
    (backend: ManagedSetupBackend) => runRuntimeJob({ backend, type: "install" }),
    [runRuntimeJob],
  );

  const updateRuntimeTarget = useCallback(
    (target: RuntimeTarget) =>
      runRuntimeJob({
        backend: target.backend,
        targetId: target.id,
        type: target.installed ? "update" : "install",
      }),
    [runRuntimeJob],
  );

  const beginDownload = useCallback(
    (modelId: string) => {
      if (!modelId) return Promise.resolve();
      setSelectedModel(modelId);
      setLaunchError(null);
      setCreatedRecipeId(null);
      setBenchmarkResult(null);
      setBenchmarkError(null);
      return Effect.runPromise(
        requestEffect(() => downloadsState.startDownload({ model_id: modelId })).pipe(
          Effect.map(() => setStep(3)),
          Effect.catch((err) =>
            Effect.sync(() =>
              setError(err instanceof Error ? err.message : "Failed to start download"),
            ),
          ),
        ),
      );
    },
    [downloadsState],
  );

  const submitManualModel = useCallback(() => {
    const trimmed = manualModelId.trim();
    if (!trimmed) return Promise.resolve();
    return beginDownload(trimmed);
  }, [manualModelId, beginDownload]);
  const continueFromHardware = useCallback(() => {
    if (!hardwareConfirmed) return;
    setStep(2);
  }, [hardwareConfirmed]);

  const configureAndLaunch = useCallback(() => {
    if (!activeDownload || activeDownload.status !== "completed") {
      return Promise.resolve();
    }

    setConfiguringRecipe(true);
    setLaunchError(null);
    setBenchmarkResult(null);
    setBenchmarkError(null);

    return Effect.runPromise(
      Effect.gen(function* () {
        let recipeId = createdRecipeId;
        if (!recipeId) {
          const existing = yield* requestEffect(() => api.getRecipes()).pipe(
            Effect.catch(() => Effect.succeed({ recipes: [] })),
          );
          const recipe = buildStarterRecipe(activeDownload, existing.recipes);
          yield* requestEffect(() => api.createRecipe(recipe));
          recipeId = recipe.id;
          setCreatedRecipeId(recipe.id);
        }

        yield* requestEffect(() => api.launch(recipeId));
        const ready = yield* requestEffect(() => api.waitReady(300));
        if (!ready.ready) {
          return yield* Effect.fail(
            new Error(ready.error || "The model did not become ready in time."),
          );
        }

        localStorage.setItem("local-studio-setup-complete", "true");
        setStep(5);
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() =>
            setLaunchError(err instanceof Error ? err.message : "Failed to configure and launch"),
          ),
        ),
        Effect.ensuring(Effect.sync(() => setConfiguringRecipe(false))),
      ),
    );
  }, [activeDownload, createdRecipeId]);

  const runSetupBenchmark = useCallback(() => {
    setBenchmarking(true);
    setBenchmarkError(null);
    setBenchmarkResult(null);
    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* requestEffect(() => api.runBenchmark(1000, 100));
        if (result.error) {
          return yield* Effect.fail(new Error(result.error));
        }
        if (!result.benchmark) {
          return yield* Effect.fail(new Error("Benchmark returned no metrics."));
        }

        setBenchmarkResult({
          prompt_tokens: result.benchmark.prompt_tokens,
          completion_tokens: result.benchmark.completion_tokens,
          total_time_s: result.benchmark.total_time_s,
          generation_tps: result.benchmark.generation_tps,
        });
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() =>
            setBenchmarkError(err instanceof Error ? err.message : "Benchmark failed"),
          ),
        ),
        Effect.ensuring(Effect.sync(() => setBenchmarking(false))),
      ),
    );
  }, []);

  const openChat = useCallback(() => {
    localStorage.setItem("local-studio-setup-complete", "true");
    router.push("/chat?new=1");
  }, [router]);

  const openDashboard = useCallback(() => {
    localStorage.setItem("local-studio-setup-complete", "true");
    router.push("/");
  }, [router]);

  const skipSetup = useCallback(() => {
    localStorage.setItem("local-studio-setup-complete", "true");
    router.push("/");
  }, [router]);

  return {
    step,
    setStep,
    loading,
    error,
    loadWarning,
    settings,
    modelsDir,
    setModelsDir,
    diagnostics,
    recommendations,
    runtimeTargets,
    runtimeJobs,
    maxVram,
    selectedModel,
    manualModelId,
    setManualModelId,
    savingSettings,
    upgrading,
    hardwareConfirmed,
    setHardwareConfirmed,
    downloads: downloadsState.downloads,
    activeDownload,
    pauseDownload: downloadsState.pauseDownload,
    resumeDownload: downloadsState.resumeDownload,
    cancelDownload: downloadsState.cancelDownload,
    saveSettings,
    installRuntime,
    updateRuntimeTarget,
    beginDownload,
    submitManualModel,
    continueFromHardware,
    configuringRecipe,
    launchError,
    createdRecipeId,
    configureAndLaunch,
    benchmarking,
    benchmarkResult,
    benchmarkError,
    runSetupBenchmark,
    openChat,
    openDashboard,
    skipSetup,
  };
}

const getSetupSnapshot = (): number => 0;

// Server-side installs can legitimately run for ~30 minutes; poll fast at
// first, then back off, and only give up well past the server install timeout.
const RUNTIME_JOB_POLL_CEILING_MS = 35 * 60_000;
const RUNTIME_JOB_FAST_POLL_WINDOW_MS = 60_000;
const RUNTIME_JOB_FAST_POLL_MS = 1_000;
const RUNTIME_JOB_SLOW_POLL_MS = 3_000;

const CONTROLLER_UNREACHABLE_MESSAGE =
  "The controller is unreachable, so setup cannot start. Start it with " +
  "`cd controller && bun src/main.ts` and reload this page.";

const requestEffect = <T>(load: () => Promise<T>): Effect.Effect<T, unknown> =>
  Effect.tryPromise({ try: load, catch: (error) => error });

function finishRuntimeJobEffect(
  jobId: string,
  setRuntimeJobs: (updater: (current: EngineJob[]) => EngineJob[]) => void,
): Effect.Effect<EngineJob, unknown> {
  return Effect.gen(function* () {
    const startedAt = Date.now();
    let job = yield* fetchRuntimeJobEffect(jobId);
    while (!isTerminalEngineJob(job)) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= RUNTIME_JOB_POLL_CEILING_MS) {
        return yield* Effect.fail(
          new Error(
            `The ${job.backend} ${job.type} is still running on the controller after ` +
              `${Math.round(RUNTIME_JOB_POLL_CEILING_MS / 60_000)} minutes. It keeps running ` +
              "server-side — watch it under Settings → Engines or in the controller logs, then " +
              "reload this page once it finishes.",
          ),
        );
      }
      const intervalMs =
        elapsedMs < RUNTIME_JOB_FAST_POLL_WINDOW_MS
          ? RUNTIME_JOB_FAST_POLL_MS
          : RUNTIME_JOB_SLOW_POLL_MS;
      yield* Effect.sleep(intervalMs);
      const next = yield* fetchRuntimeJobEffect(jobId);
      job = next;
      setRuntimeJobs((current) => [
        next,
        ...current.filter((candidate) => candidate.id !== next.id),
      ]);
    }
    return job;
  });
}

function fetchRuntimeJob(jobId: string): Promise<EngineJob> {
  return Effect.runPromise(fetchRuntimeJobEffect(jobId));
}

function fetchRuntimeJobEffect(jobId: string): Effect.Effect<EngineJob, unknown> {
  return requestEffect(() => api.getRuntimeJob(jobId)).pipe(
    Effect.map((payload) => payload.job),
    Effect.catch((err) => {
      if (isMissingRuntimeJobError(err)) {
        return Effect.fail(
          new Error("The controller restarted and lost this install job. Re-run the install."),
        );
      }
      return Effect.fail(err);
    }),
  );
}

function isMissingRuntimeJobError(err: unknown): boolean {
  return err instanceof Error && (err as Error & { status?: number }).status === 404;
}

function withSetupTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 8_000): Promise<T> {
  return Effect.runPromise(withSetupTimeoutEffect(promise, label, timeoutMs));
}

function withSetupTimeoutEffect<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 8_000,
): Effect.Effect<T, Error> {
  return requestEffect(() => promise).pipe(
    Effect.timeout(timeoutMs),
    Effect.catch(() => Effect.fail(new Error(`${label} timed out`))),
  );
}

function formatLoadWarning(warnings: string[]): string | null {
  return warnings.length ? `Some setup data could not load: ${warnings.join("; ")}` : null;
}

function setupErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "unavailable";
}
