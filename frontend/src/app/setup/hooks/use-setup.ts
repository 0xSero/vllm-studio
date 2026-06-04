"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import type {
  EngineBackend,
  EngineJob,
  ModelRecommendation,
  RuntimeTarget,
  StudioDiagnostics,
  StudioSettings,
} from "@/lib/types";
import { useDownloads } from "@/hooks/use-downloads";
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

  const refreshRuntimeState = useCallback(async () => {
    const [targetPayload, jobPayload] = await Promise.all([
      api.getRuntimeTargets().catch(() => ({ targets: [] })),
      api.getRuntimeJobs().catch(() => ({ jobs: [] })),
    ]);
    setRuntimeTargets(targetPayload.targets);
    setRuntimeJobs(jobPayload.jobs);
  }, []);

  const loadSetupData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [settingsRes, diagnosticsRes, recommendationsRes, targetPayload, jobPayload] =
        await Promise.all([
          api.getStudioSettings(),
          api.getStudioDiagnostics(),
          api.getModelRecommendations(),
          api.getRuntimeTargets().catch(() => ({ targets: [] })),
          api.getRuntimeJobs().catch(() => ({ jobs: [] })),
        ]);
      setSettings(settingsRes);
      setModelsDir(settingsRes.effective.models_dir);
      setDiagnostics(diagnosticsRes);
      setRecommendations(recommendationsRes.recommendations || []);
      setRuntimeTargets(targetPayload.targets);
      setRuntimeJobs(jobPayload.jobs);
      setMaxVram(recommendationsRes.max_vram_gb ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load setup data");
    } finally {
      setLoading(false);
    }
  }, []);

  const subscribeSetupData = useCallback(
    (_notify: () => void) => {
      void loadSetupData();
      return () => {};
    },
    [loadSetupData],
  );

  useSyncExternalStore(subscribeSetupData, getSetupSnapshot, getSetupSnapshot);

  const saveSettings = useCallback(async () => {
    if (!modelsDir.trim()) {
      setError("Models directory is required.");
      return;
    }
    setSavingSettings(true);
    try {
      const result = await api.updateStudioSettings({ models_dir: modelsDir.trim() });
      setSettings(result);
      setModelsDir(result.effective.models_dir);
      setHardwareConfirmed(false);
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setSavingSettings(false);
    }
  }, [modelsDir]);

  const finishRuntimeJob = useCallback(async (jobId: string): Promise<EngineJob> => {
    let finalJob = (await api.getRuntimeJob(jobId)).job;
    for (
      let attempt = 0;
      attempt < 120 && (finalJob.status === "queued" || finalJob.status === "running");
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      finalJob = (await api.getRuntimeJob(jobId)).job;
      setRuntimeJobs((current) => [
        finalJob,
        ...current.filter((candidate) => candidate.id !== finalJob.id),
      ]);
    }
    return finalJob;
  }, []);

  const runRuntimeJob = useCallback(
    async (payload: { backend: EngineBackend; targetId?: string; type: "install" | "update" }) => {
      setUpgrading(true);
      setError(null);
      try {
        const { job } = await api.createRuntimeJob(payload);
        setRuntimeJobs((current) => [
          job,
          ...current.filter((candidate) => candidate.id !== job.id),
        ]);
        await finishRuntimeJob(job.id);
        await refreshRuntimeState();
        const refreshed = await api.getStudioDiagnostics();
        setDiagnostics(refreshed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Runtime job failed");
      } finally {
        setUpgrading(false);
      }
    },
    [finishRuntimeJob, refreshRuntimeState],
  );

  const installRuntime = useCallback(
    async (backend: ManagedSetupBackend) => {
      await runRuntimeJob({ backend, type: "install" });
    },
    [runRuntimeJob],
  );

  const updateRuntimeTarget = useCallback(
    async (target: RuntimeTarget) => {
      await runRuntimeJob({
        backend: target.backend,
        targetId: target.id,
        type: target.installed ? "update" : "install",
      });
    },
    [runRuntimeJob],
  );

  const beginDownload = useCallback(
    async (modelId: string) => {
      if (!modelId) return;
      setSelectedModel(modelId);
      setLaunchError(null);
      setCreatedRecipeId(null);
      setBenchmarkResult(null);
      setBenchmarkError(null);
      try {
        await downloadsState.startDownload({ model_id: modelId });
        setStep(3);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start download");
      }
    },
    [downloadsState],
  );

  const submitManualModel = useCallback(async () => {
    const trimmed = manualModelId.trim();
    if (!trimmed) return;
    await beginDownload(trimmed);
  }, [manualModelId, beginDownload]);

  const continueFromHardware = useCallback(() => {
    if (!hardwareConfirmed) return;
    setStep(2);
  }, [hardwareConfirmed]);

  const configureAndLaunch = useCallback(async () => {
    if (!activeDownload || activeDownload.status !== "completed") {
      return;
    }

    setConfiguringRecipe(true);
    setLaunchError(null);
    setBenchmarkResult(null);
    setBenchmarkError(null);

    try {
      let recipeId = createdRecipeId;
      if (!recipeId) {
        const existing = await api.getRecipes().catch(() => ({ recipes: [] }));
        const recipe = buildStarterRecipe(activeDownload, existing.recipes);
        await api.createRecipe(recipe);
        recipeId = recipe.id;
        setCreatedRecipeId(recipe.id);
      }

      await api.launch(recipeId);
      const ready = await api.waitReady(300);
      if (!ready.ready) {
        throw new Error(ready.error || "The model did not become ready in time.");
      }

      localStorage.setItem("vllm-studio-setup-complete", "true");
      setStep(5);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Failed to configure and launch");
    } finally {
      setConfiguringRecipe(false);
    }
  }, [activeDownload, createdRecipeId]);

  const runSetupBenchmark = useCallback(async () => {
    setBenchmarking(true);
    setBenchmarkError(null);
    setBenchmarkResult(null);
    try {
      const result = await api.runBenchmark(1000, 100);
      if (result.error) {
        throw new Error(result.error);
      }
      if (!result.benchmark) {
        throw new Error("Benchmark returned no metrics.");
      }

      setBenchmarkResult({
        prompt_tokens: result.benchmark.prompt_tokens,
        completion_tokens: result.benchmark.completion_tokens,
        total_time_s: result.benchmark.total_time_s,
        generation_tps: result.benchmark.generation_tps,
      });
    } catch (err) {
      setBenchmarkError(err instanceof Error ? err.message : "Benchmark failed");
    } finally {
      setBenchmarking(false);
    }
  }, []);

  const openChat = useCallback(() => {
    localStorage.setItem("vllm-studio-setup-complete", "true");
    router.push("/chat?new=1");
  }, [router]);

  const openDashboard = useCallback(() => {
    localStorage.setItem("vllm-studio-setup-complete", "true");
    router.push("/");
  }, [router]);

  const skipSetup = useCallback(() => {
    localStorage.setItem("vllm-studio-setup-complete", "true");
    router.push("/");
  }, [router]);

  return {
    step,
    setStep,
    loading,
    error,
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
