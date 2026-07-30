"use client";

import { Effect } from "effect";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  EngineBackend,
  EngineJob,
  RuntimeTarget,
  StarterPreset,
  StudioDiagnostics,
  StudioSettings,
} from "@/lib/types";
import { useDownloads } from "@/hooks/use-downloads";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  loadSecondarySetupDataEffect,
  loadSetupDataEffect,
  refreshRuntimeStateEffect,
  type SetupLoadSetters,
} from "./setup-load";
import {
  beginDownloadEffect,
  configureAndLaunchEffect,
  connectRemotePresetEffect,
  markSetupComplete,
  runRuntimeJobEffect,
  saveSettingsEffect,
} from "./setup-actions";
import { useSetupBenchmark } from "./use-setup-benchmark";
import { selectSetupDownload } from "./setup-downloads";
import { ggufFileOptions, manualDownloadPreset, type GgufFileOption } from "./setup-model-files";
import { loadSetupProgress, updateSetupProgress } from "./setup-progress";
import type { HuggingFaceModelCardPayload } from "@/lib/huggingface";
import type { ApimClientFields } from "./setup-view/step-model";

type ManagedSetupBackend = Extract<EngineBackend, "vllm" | "sglang" | "mlx">;

export function useSetup() {
  const router = useRouter();
  const [step, setStepState] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [modelsDir, setModelsDir] = useState("");
  const [diagnostics, setDiagnostics] = useState<StudioDiagnostics | null>(null);
  const [presets, setPresets] = useState<StarterPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<StarterPreset | null>(null);
  const [remoteApiKey, setRemoteApiKey] = useState("");
  const [remoteSubscriptionKey, setRemoteSubscriptionKey] = useState({ header: "", value: "" });
  const [connectingRemote, setConnectingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [runtimeTargets, setRuntimeTargets] = useState<RuntimeTarget[]>([]);
  const [runtimeJobs, setRuntimeJobs] = useState<EngineJob[]>([]);
  const [maxVram, setMaxVram] = useState(0);
  const [selectedModel, setSelectedModel] = useState("");
  const [manualModelId, setManualModelIdState] = useState("");
  const [manualGgufOptions, setManualGgufOptions] = useState<GgufFileOption[]>([]);
  const [manualGgufFile, setManualGgufFile] = useState("");
  const [resolvingManualModel, setResolvingManualModel] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [hardwareConfirmed, setHardwareConfirmedState] = useState(false);
  const [configuringRecipe, setConfiguringRecipe] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [createdRecipeId, setCreatedRecipeIdState] = useState<string | null>(null);

  useMountSubscription(() => {
    const progress = loadSetupProgress();
    setStepState(progress.step);
    setHardwareConfirmedState(progress.hardwareConfirmed);
    setSelectedModel(progress.selectedModel);
    setManualModelIdState(progress.manualModelId);
    setSelectedPreset(progress.selectedPreset);
    setCreatedRecipeIdState(progress.createdRecipeId);
  }, []);

  const setStep = useCallback((value: number) => {
    setStepState(value);
    updateSetupProgress({ step: value });
  }, []);

  const setManualModelId = useCallback((value: string) => {
    setManualModelIdState(value);
    setManualGgufOptions([]);
    setManualGgufFile("");
    updateSetupProgress({ manualModelId: value });
  }, []);

  const setHardwareConfirmed = useCallback((value: boolean) => {
    setHardwareConfirmedState(value);
    updateSetupProgress({ hardwareConfirmed: value });
  }, []);

  const setCreatedRecipeId = useCallback((value: string | null) => {
    setCreatedRecipeIdState(value);
    updateSetupProgress({ createdRecipeId: value });
  }, []);

  const { benchmarking, benchmarkResult, benchmarkError, runSetupBenchmark, resetBenchmark } =
    useSetupBenchmark();

  const [lifecycle] = useState(() => ({ abort: new AbortController() }));
  useMountSubscription(() => {
    lifecycle.abort = new AbortController();
    return () => lifecycle.abort.abort();
  }, [lifecycle]);

  const downloadsState = useDownloads(2000);

  const activeDownload = useMemo(
    () => selectSetupDownload(downloadsState.downloads, selectedModel, selectedPreset),
    [downloadsState.downloads, selectedModel, selectedPreset],
  );

  const refreshRuntimeState = useCallback(() => {
    return Effect.runPromise(refreshRuntimeStateEffect({ setRuntimeTargets, setRuntimeJobs }));
  }, []);

  const loadSecondarySetupData = useCallback(
    (initialWarnings: string[], loadSetters: SetupLoadSetters) => {
      return Effect.runPromise(loadSecondarySetupDataEffect(initialWarnings, loadSetters));
    },
    [],
  );

  const loadSetupData = useCallback(() => {
    const loadSetters: SetupLoadSetters = {
      setLoading,
      setError,
      setLoadWarning,
      setSettings,
      setModelsDir,
      setDiagnostics,
      setMaxVram,
      setRuntimeTargets,
      setRuntimeJobs,
      setPresets,
    };
    return Effect.runPromise(
      loadSetupDataEffect(loadSetters, (warnings) => loadSecondarySetupData(warnings, loadSetters)),
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
      saveSettingsEffect(modelsDir, {
        setSettings,
        setModelsDir,
        setHardwareConfirmed,
        setStep,
        setError,
        setSavingSettings,
      }),
    );
  }, [modelsDir]);

  const runRuntimeJob = useCallback(
    (payload: { backend: EngineBackend; targetId?: string; type: "install" | "update" }) => {
      setUpgrading(true);
      setError(null);
      return Effect.runPromise(
        runRuntimeJobEffect(payload, {
          setError,
          setRuntimeJobs,
          setDiagnostics,
          setUpgrading,
          refreshRuntimeState,
        }),
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
    (modelId: string, preset?: StarterPreset, allowPatterns?: string[]) => {
      if (!modelId) return Promise.resolve();
      setSelectedModel(modelId);
      setSelectedPreset(preset ?? null);
      updateSetupProgress({
        selectedModel: modelId,
        selectedPreset: preset ?? null,
        createdRecipeId: null,
      });
      setLaunchError(null);
      setCreatedRecipeId(null);
      resetBenchmark();
      const completedDownload = selectSetupDownload(
        downloadsState.downloads.filter((download) => download.status === "completed"),
        modelId,
        preset ?? null,
      );
      if (completedDownload) {
        setStep(3);
        return Promise.resolve();
      }
      return Effect.runPromise(
        beginDownloadEffect(modelId, preset, allowPatterns, {
          startDownload: downloadsState.startDownload,
          setStep,
          setError,
        }),
      );
    },
    [downloadsState, resetBenchmark, setCreatedRecipeId, setStep],
  );

  const beginVariantDownload = useCallback(
    (modelId: string, allowPatterns?: string[]) => beginDownload(modelId, undefined, allowPatterns),
    [beginDownload],
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
    (preset: StarterPreset, apimClientFields?: ApimClientFields) => {
      const remote = preset.remote;
      if (preset.kind !== "remote" || !remote) return Promise.resolve();
      const apiKey = remoteApiKey.trim();
      if (remote.authentication === "api_key" && !apiKey) {
        setRemoteError("An API key is required to connect.");
        return Promise.resolve();
      }
      if (
        remote.authentication === "apim_client" &&
        apimClientFields &&
        !apimClientFields.client_secret.trim()
      ) {
        setRemoteError("A client secret is required to connect.");
        return Promise.resolve();
      }
      setConnectingRemote(true);
      setRemoteError(null);
      const subscriptionKey =
        remoteSubscriptionKey.header.trim() && remoteSubscriptionKey.value.trim()
          ? {
              header: remoteSubscriptionKey.header.trim(),
              value: remoteSubscriptionKey.value.trim(),
            }
          : undefined;
      return Effect.runPromise(
        connectRemotePresetEffect(
          preset,
          remote,
          apiKey,
          subscriptionKey,
          {
            setRemoteError,
            setConnectingRemote,
            openAgentChat: () => router.push("/agent?new=1"),
          },
          apimClientFields,
        ),
      );
    },
    [remoteApiKey, remoteSubscriptionKey, router],
  );

  const submitManualModel = useCallback(async () => {
    const trimmed = manualModelId.trim();
    if (!trimmed || resolvingManualModel) return;
    setResolvingManualModel(true);
    setError(null);
    try {
      const signal = AbortSignal.any([lifecycle.abort.signal, AbortSignal.timeout(12_000)]);
      const response = await fetch(
        `/api/huggingface/model-card?modelId=${encodeURIComponent(trimmed)}`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json()) as HuggingFaceModelCardPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to inspect the model repository");
      const options = ggufFileOptions(payload);
      setManualGgufOptions(options);
      const selected =
        options.find((option) => option.value === manualGgufFile) ??
        (options.length === 1 ? options[0] : undefined);
      if (options.length > 1 && !selected) return;
      await beginDownload(trimmed, manualDownloadPreset(trimmed, selected));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "Failed to inspect the model repository");
      }
    } finally {
      setResolvingManualModel(false);
    }
  }, [beginDownload, lifecycle, manualGgufFile, manualModelId, resolvingManualModel]);
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
      configureAndLaunchEffect(
        { activeDownload, selectedPreset, createdRecipeId },
        { setRuntimeJobs, setCreatedRecipeId, setStep, setLaunchError, setConfiguringRecipe },
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

  const exitSetup = useCallback(() => {
    router.push("/");
  }, [router]);

  const completeSetup = useCallback(() => {
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
    presets,
    selectedPreset,
    beginPresetSetup,
    remoteApiKey,
    setRemoteApiKey,
    remoteSubscriptionKey,
    setRemoteSubscriptionKey,
    connectingRemote,
    remoteError,
    connectRemotePreset,
    runtimeTargets,
    runtimeJobs,
    maxVram,
    selectedModel,
    manualModelId,
    setManualModelId,
    manualGgufOptions,
    manualGgufFile,
    setManualGgufFile,
    resolvingManualModel,
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
    beginVariantDownload,
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
    exitSetup,
    completeSetup,
  };
}
