"use client";

import { Effect, Result } from "effect";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api/client";
import type {
  EngineBackend,
  EngineJob,
  ModelRecommendation,
  RuntimeTarget,
  StarterPreset,
  StudioDiagnostics,
  StudioSettings,
} from "@/lib/types";
import { useDownloads } from "@/hooks/use-downloads";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { isManagedServeRuntimeTarget } from "@/lib/serve-runtime";
import { describeFailedEngineJob } from "@/features/settings/runtime-targets";
import { buildStarterRecipe } from "./setup-helpers";
import {
  CONTROLLER_UNREACHABLE_MESSAGE,
  finishRuntimeJobEffect,
  formatLoadWarning,
  requestEffect,
  setupErrorMessage,
  withSetupTimeoutEffect,
} from "./use-setup-effects";
import { useSetupBenchmark } from "./use-setup-benchmark";

type ManagedSetupBackend = Extract<EngineBackend, "vllm" | "sglang" | "mlx">;

const markSetupComplete = (): void => {
  try {
    localStorage.setItem("local-studio-setup-complete", "true");
  } catch {}
};

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
  const [presets, setPresets] = useState<StarterPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<StarterPreset | null>(null);
  const [remoteApiKey, setRemoteApiKey] = useState("");
  const [connectingRemote, setConnectingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
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

  const { benchmarking, benchmarkResult, benchmarkError, runSetupBenchmark, resetBenchmark } =
    useSetupBenchmark();

  const [lifecycle] = useState(() => ({ abort: new AbortController() }));
  useMountSubscription(() => {
    lifecycle.abort = new AbortController();
    return () => lifecycle.abort.abort();
  }, [lifecycle]);

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
        const [recommendationsResult, presetsResult, targetResult, jobResult] = yield* Effect.all([
          Effect.result(
            withSetupTimeoutEffect(api.getModelRecommendations(), "model recommendations"),
          ),
          Effect.result(withSetupTimeoutEffect(api.getStarterPresets(), "starter presets")),
          Effect.result(withSetupTimeoutEffect(api.getRuntimeTargets(), "runtime targets")),
          Effect.result(withSetupTimeoutEffect(api.getRuntimeJobs(), "runtime jobs")),
        ] as const);

        if (Result.isSuccess(presetsResult)) {
          setPresets(presetsResult.success.presets || []);
        } else setPresets([]);

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

  useMountSubscription(() => {
    void loadSetupData();
  }, [loadSetupData]);

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
          const finalJob = yield* finishRuntimeJobEffect(job.id, setRuntimeJobs);
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
        { signal: lifecycle.abort.signal },
      ).catch(() => undefined);
    },
    [lifecycle, refreshRuntimeState],
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
    (modelId: string, preset?: StarterPreset) => {
      if (!modelId) return Promise.resolve();
      setSelectedModel(modelId);
      setSelectedPreset(preset ?? null);
      setLaunchError(null);
      setCreatedRecipeId(null);
      resetBenchmark();
      return Effect.runPromise(
        requestEffect(() =>
          downloadsState.startDownload({
            model_id: modelId,
            ...(preset?.allow_patterns?.length ? { allow_patterns: preset.allow_patterns } : {}),
          }),
        ).pipe(
          Effect.map(() => setStep(3)),
          Effect.catch((err) =>
            Effect.sync(() =>
              setError(err instanceof Error ? err.message : "Failed to start download"),
            ),
          ),
        ),
      );
    },
    [downloadsState, resetBenchmark],
  );

  const beginPresetSetup = useCallback(
    (preset: StarterPreset) => {
      if (preset.kind === "download" && preset.model_id) {
        return beginDownload(preset.model_id, preset);
      }
      return Promise.resolve();
    },
    [beginDownload],
  );

  const connectRemotePreset = useCallback(
    (preset: StarterPreset) => {
      const remote = preset.remote;
      if (preset.kind !== "remote" || !remote) return Promise.resolve();
      const apiKey = remoteApiKey.trim();
      if (!apiKey) {
        setRemoteError("An API key is required to connect.");
        return Promise.resolve();
      }
      setConnectingRemote(true);
      setRemoteError(null);
      return Effect.runPromise(
        Effect.gen(function* () {
          const existing = yield* requestEffect(() => api.getProviders()).pipe(
            Effect.catch(() => Effect.succeed({ providers: [] })),
          );
          const alreadyThere = existing.providers.some((provider) => provider.id === preset.id);
          if (alreadyThere) {
            yield* requestEffect(() =>
              api.updateProvider(preset.id, { api_key: apiKey, enabled: true }),
            );
          } else {
            yield* requestEffect(() =>
              api.createProvider({
                id: preset.id,
                name: preset.name,
                base_url: remote.base_url,
                api_key: apiKey,
              }),
            );
          }
          markSetupComplete();
          router.push("/agent?new=1");
        }).pipe(
          Effect.catch((err) =>
            Effect.sync(() =>
              setRemoteError(err instanceof Error ? err.message : "Failed to connect provider"),
            ),
          ),
          Effect.ensuring(Effect.sync(() => setConnectingRemote(false))),
        ),
      );
    },
    [remoteApiKey, router],
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
    resetBenchmark();

    return Effect.runPromise(
      Effect.gen(function* () {
        const backend = selectedPreset?.backend ?? "vllm";
        const targetPayload = yield* requestEffect(() => api.getRuntimeTargets()).pipe(
          Effect.catch(() => Effect.succeed({ targets: [] satisfies RuntimeTarget[] })),
        );
        const runtimeInstalled = targetPayload.targets.some((target) =>
          backend === "llamacpp"
            ? target.backend === backend && target.installed
            : isManagedServeRuntimeTarget(backend, target) && target.installed,
        );
        if (!runtimeInstalled) {
          const { job } = yield* requestEffect(() =>
            api.createRuntimeJob({ backend, type: "install" }),
          );
          setRuntimeJobs((current) => [
            job,
            ...current.filter((candidate) => candidate.id !== job.id),
          ]);
          const finalJob = yield* finishRuntimeJobEffect(job.id, setRuntimeJobs);
          if (finalJob.status === "error") {
            return yield* Effect.fail(new Error(describeFailedEngineJob(finalJob)));
          }
        }

        let recipeId = createdRecipeId;
        if (!recipeId) {
          const existing = yield* requestEffect(() => api.getRecipes()).pipe(
            Effect.catch(() => Effect.succeed({ recipes: [] })),
          );
          const recipe = buildStarterRecipe(activeDownload, existing.recipes, selectedPreset);
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

        markSetupComplete();
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
  }, [activeDownload, createdRecipeId, resetBenchmark, selectedPreset, setRuntimeJobs]);

  const openChat = useCallback(() => {
    markSetupComplete();
    router.push("/agent?new=1");
  }, [router]);

  const openDashboard = useCallback(() => {
    markSetupComplete();
    router.push("/");
  }, [router]);

  const skipSetup = useCallback(() => {
    markSetupComplete();
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
    presets,
    selectedPreset,
    beginPresetSetup,
    remoteApiKey,
    setRemoteApiKey,
    connectingRemote,
    remoteError,
    connectRemotePreset,
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
